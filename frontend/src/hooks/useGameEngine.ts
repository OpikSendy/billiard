"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Matter from "matter-js";
import { createPhysicsEngine, startEngine, stopEngine, allBallsStopped, PhysicsEngine } from "@/lib/physics/engine";
import { createTableWalls, getTablePockets, checkPocketed, TableConfig, Pocket } from "@/lib/physics/table";
import { createCueBall, createRackedBalls, shootCueBall, BallData, BALL_RADIUS } from "@/lib/physics/balls";
import { getLowestBall, evaluateTurn, resetTurnState, getFoulMessage, GameState, TurnResult } from "@/lib/game/rules";
import { GameStateInfo, ShotData, BallPos, FoulData, TurnResult as SocketTurnResult } from "@/hooks/useSocket";

export interface AimState {
  angle: number;       // radians
  power: number;       // 0..1
  isDragging: boolean;
}

export interface GameHookState {
  isSimulating: boolean;
  currentPlayer: 1 | 2;
  scores: { p1: number; p2: number };
  foulMessage: string;
  winner: string | null;
  lowestBall: number | null;
  pocketedBalls: number[];
  ballInHand: boolean;
  consecutiveFouls?: { 1: number; 2: number };
  pushOutAvailable?: boolean;
  isPushOutActive?: boolean;
  pushOutResolvePending?: boolean;
}

export interface UseGameEngineProps {
  isMultiplayer?: boolean;
  myPlayerIndex?: 1 | 2 | null;
  socketGameState?: GameStateInfo | null;
  lastOpponentShot?: (ShotData & { shooterIndex: 1 | 2 }) | null;
  lastTurnResult?: {
    gameState: GameStateInfo;
    turnResult: SocketTurnResult;
    authPositions: BallPos[];
    desynced: boolean;
  } | null;
  gameOver?: { winner: string; gameState: GameStateInfo } | null;
  opponentLeft?: boolean;
  onEmitShot?: (shot: ShotData) => void;
  onEmitSyncResult?: (positions: BallPos[], foulData: FoulData) => void;
  onClearOpponentShot?: () => void;
  onClearTurnResult?: () => void;
}

export interface UseGameEngineReturn {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  aimState: AimState;
  gameState: GameHookState;
  handleMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleMouseUp: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  handleShoot: () => void;
  resetGame: () => void;
  placeCueBall: (x: number, y: number) => void;
}

// Table layout constants
export const TABLE_CONFIG: TableConfig = {
  x: 60,
  y: 40,
  width: 720,
  height: 380,
};

const CUE_BALL_START = {
  x: TABLE_CONFIG.x + TABLE_CONFIG.width * 0.25,
  y: TABLE_CONFIG.y + TABLE_CONFIG.height / 2,
};

const RACK_START = {
  x: TABLE_CONFIG.x + TABLE_CONFIG.width * 0.65,
  y: TABLE_CONFIG.y + TABLE_CONFIG.height / 2,
};

export function useGameEngine(props: UseGameEngineProps = {}): UseGameEngineReturn {
  const {
    isMultiplayer = false,
    myPlayerIndex = null,
    socketGameState = null,
    lastOpponentShot = null,
    lastTurnResult = null,
    gameOver = null,
    opponentLeft = false,
    onEmitShot,
    onEmitSyncResult,
    onClearOpponentShot,
    onClearTurnResult,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const physicsRef = useRef<PhysicsEngine | null>(null);
  const ballsRef = useRef<BallData[]>([]);
  const pocketsRef = useRef<Pocket[]>([]);
  const animFrameRef = useRef<number>(0);

  // Turn-tracking refs (not React state — updated per physics frame)
  const gameStateRef = useRef<GameState>({
    balls: [],
    activeBalls: [],
    cueBallPocketed: false,
    firstHitBall: null,
    pocketedThisTurn: [],
    railContactMade: false,
    isRunning: false,
  });

  const [aimState, setAimState] = useState<AimState>({
    angle: 0,
    power: 0,
    isDragging: false,
  });

  const [gameState, setGameState] = useState<GameHookState>({
    isSimulating: false,
    currentPlayer: 1,
    scores: { p1: 0, p2: 0 },
    foulMessage: "",
    winner: null,
    lowestBall: null,
    pocketedBalls: [],
    ballInHand: false,
    consecutiveFouls: { 1: 0, 2: 0 },
    pushOutAvailable: false,
    isPushOutActive: false,
    pushOutResolvePending: false,
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const getCueBall = useCallback((): BallData | undefined => {
    return ballsRef.current.find((b) => b.number === 0);
  }, []);

  const getCanvasPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  // ─── Game Initialization ──────────────────────────────────────────────────

  const initGame = useCallback(() => {
    if (!canvasRef.current) return;

    // Cleanup previous
    if (physicsRef.current) {
      stopEngine(physicsRef.current);
      cancelAnimationFrame(animFrameRef.current);
    }

    const physics = createPhysicsEngine();
    physicsRef.current = physics;

    // Create table walls
    const walls = createTableWalls(TABLE_CONFIG);
    Matter.World.add(physics.world, walls);

    // Create pockets
    pocketsRef.current = getTablePockets(TABLE_CONFIG);

    // Create balls
    const cueBall = createCueBall(CUE_BALL_START.x, CUE_BALL_START.y);
    const rackedBalls = createRackedBalls(RACK_START.x, RACK_START.y);
    ballsRef.current = [cueBall, ...rackedBalls];

    Matter.World.add(
      physics.world,
      ballsRef.current.map((b) => b.body)
    );

    // Register collision events
    Matter.Events.on(physics.engine, "collisionStart", (event) => {
      event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;

        // Detect cue ball first hit
        const isCueBall = (b: Matter.Body) => b.label === "ball-0";
        const isBall = (b: Matter.Body) => b.label.startsWith("ball-");
        const isWall = (b: Matter.Body) => b.label.startsWith("wall");

        if (isCueBall(bodyA) && isBall(bodyB) && !isCueBall(bodyB)) {
          if (gameStateRef.current.firstHitBall === null) {
            const num = parseInt(bodyB.label.split("-")[1]);
            gameStateRef.current.firstHitBall = num;
          }
        } else if (isCueBall(bodyB) && isBall(bodyA) && !isCueBall(bodyA)) {
          if (gameStateRef.current.firstHitBall === null) {
            const num = parseInt(bodyA.label.split("-")[1]);
            gameStateRef.current.firstHitBall = num;
          }
        }

        // Detect rail contact (any ball hits wall after shot)
        if ((isBall(bodyA) && isWall(bodyB)) || (isBall(bodyB) && isWall(bodyA))) {
          if (gameStateRef.current.isRunning) {
            gameStateRef.current.railContactMade = true;
          }
        }
      });
    });

    // Reset game state ref
    gameStateRef.current = {
      balls: ballsRef.current,
      activeBalls: ballsRef.current.filter((b) => !b.isPocketed),
      cueBallPocketed: false,
      firstHitBall: null,
      pocketedThisTurn: [],
      railContactMade: false,
      isRunning: false,
    };

    setGameState({
      isSimulating: false,
      currentPlayer: 1,
      scores: { p1: 0, p2: 0 },
      foulMessage: "",
      winner: null,
      lowestBall: getLowestBall(ballsRef.current),
      pocketedBalls: [],
      ballInHand: false,
      consecutiveFouls: { 1: 0, 2: 0 },
      pushOutAvailable: false,
      isPushOutActive: false,
      pushOutResolvePending: false,
    });

    startEngine(physics);
    startRenderLoop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Render Loop ──────────────────────────────────────────────────────────

  const startRenderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      drawScene(ctx, canvas.width, canvas.height);
      checkPockets();

      // Check if simulation ended
      if (gameStateRef.current.isRunning) {
        const activeBodies = ballsRef.current
          .filter((b) => !b.isPocketed)
          .map((b) => b.body);
        if (allBallsStopped(activeBodies)) {
          endTurn();
        }
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Canvas Drawing ───────────────────────────────────────────────────────

  const drawScene = useCallback(
    (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
      // Background
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, cw, ch);

      drawTable(ctx);
      drawPockets(ctx);
      drawBalls(ctx);

      const cueBallData = getCueBall();
      if (cueBallData && !cueBallData.isPocketed && !gameStateRef.current.isRunning) {
        const isMyTurn = !isMultiplayer || (gameState.currentPlayer === myPlayerIndex);
        if (isMyTurn) {
          // 1. Calculate and Draw Trajectory Guide lines
          const trajectory = calculateTrajectory(
            cueBallData.body.position.x,
            cueBallData.body.position.y,
            aimState.angle,
            ballsRef.current
          );

          ctx.save();
          
          // Draw path from cue ball to hit point or wall
          ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(cueBallData.body.position.x, cueBallData.body.position.y);
          ctx.lineTo(trajectory.endPoint.x, trajectory.endPoint.y);
          ctx.stroke();
          ctx.setLineDash([]);

          if (trajectory.hitPoint && trajectory.targetDeflection && trajectory.cueDeflection) {
            // Draw ghost ball at hit point (collision moment)
            ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(trajectory.hitPoint.x, trajectory.hitPoint.y, BALL_RADIUS, 0, Math.PI * 2);
            ctx.stroke();

            // Draw target ball deflection line (Yellow arrow)
            const lineLength = 55;
            ctx.strokeStyle = "#fbbf24"; // yellow-400
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(trajectory.targetBallPos!.x, trajectory.targetBallPos!.y);
            ctx.lineTo(
              trajectory.targetBallPos!.x + trajectory.targetDeflection.x * lineLength,
              trajectory.targetBallPos!.y + trajectory.targetDeflection.y * lineLength
            );
            ctx.stroke();

            // Draw target ball arrowhead
            drawArrowhead(
              ctx,
              trajectory.targetBallPos!.x + trajectory.targetDeflection.x * lineLength,
              trajectory.targetBallPos!.y + trajectory.targetDeflection.y * lineLength,
              Math.atan2(trajectory.targetDeflection.y, trajectory.targetDeflection.x),
              "#fbbf24"
            );

            // Draw cue ball deflection line (White tangent)
            ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(trajectory.hitPoint.x, trajectory.hitPoint.y);
            ctx.lineTo(
              trajectory.hitPoint.x + trajectory.cueDeflection.x * (lineLength * 0.7),
              trajectory.hitPoint.y + trajectory.cueDeflection.y * (lineLength * 0.7)
            );
            ctx.stroke();

            // Draw cue ball arrowhead
            drawArrowhead(
              ctx,
              trajectory.hitPoint.x + trajectory.cueDeflection.x * (lineLength * 0.7),
              trajectory.hitPoint.y + trajectory.cueDeflection.y * (lineLength * 0.7),
              Math.atan2(trajectory.cueDeflection.y, trajectory.cueDeflection.x),
              "rgba(255, 255, 255, 0.8)"
            );
          }
          
          ctx.restore();

          // 2. Draw Cue Stick
          drawCueStick(ctx, cueBallData.body.position, aimState);

          // 3. Draw Curved Power Meter Gauge around Cue Ball
          drawPowerMeter(ctx, cueBallData.body.position.x, cueBallData.body.position.y, aimState.power);
        }
      }
    },
    [aimState, getCueBall, isMultiplayer, myPlayerIndex, gameState.currentPlayer]
  );

  const drawTable = (ctx: CanvasRenderingContext2D) => {
    const { x, y, width, height } = TABLE_CONFIG;

    // Outer frame (wood)
    ctx.fillStyle = "#7C4A1A";
    ctx.beginPath();
    ctx.roundRect(x - 30, y - 30, width + 60, height + 60, 10);
    ctx.fill();

    // Rail cushions
    ctx.fillStyle = "#15803d";
    ctx.beginPath();
    ctx.roundRect(x - 18, y - 18, width + 36, height + 36, 6);
    ctx.fill();

    // Felt (playing surface)
    const feltGrad = ctx.createLinearGradient(x, y, x + width, y + height);
    feltGrad.addColorStop(0, "#166534");
    feltGrad.addColorStop(0.5, "#15803d");
    feltGrad.addColorStop(1, "#166534");
    ctx.fillStyle = feltGrad;
    ctx.fillRect(x, y, width, height);

    // Center line (subtle)
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(x + width / 2, y);
    ctx.lineTo(x + width / 2, y + height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Head string (baulk line)
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + width * 0.25, y);
    ctx.lineTo(x + width * 0.25, y + height);
    ctx.stroke();
  };

  const drawPockets = (ctx: CanvasRenderingContext2D) => {
    pocketsRef.current.forEach((pocket) => {
      // Shadow glow
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 12;

      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, pocket.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;

      // Inner ring highlight
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pocket.x, pocket.y, pocket.radius - 2, 0, Math.PI * 2);
      ctx.stroke();
    });
  };

  const drawBalls = (ctx: CanvasRenderingContext2D) => {
    ballsRef.current.forEach((ballData) => {
      if (ballData.isPocketed) return;
      const { body, number } = ballData;
      const { x, y } = body.position;

      ctx.save();

      // Ball shadow
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      // Ball body
      const colors: Record<number, string> = {
        0: "#FFFFFF", 1: "#F5C518", 2: "#1A56DB", 3: "#E02424",
        4: "#7E3AF2", 5: "#FF7700", 6: "#16A34A", 7: "#92400E",
        8: "#1F2937", 9: "#F5C518",
      };

      const isStripe = number === 9;

      if (isStripe) {
        // White base
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        // Stripe band
        ctx.fillStyle = colors[number] ?? "#888";
        ctx.beginPath();
        ctx.arc(x, y, BALL_RADIUS, Math.PI * 0.25, Math.PI * 0.75);
        ctx.arc(x, y, BALL_RADIUS, Math.PI * 1.25, Math.PI * 1.75);
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(
          x - BALL_RADIUS * 0.3, y - BALL_RADIUS * 0.3, BALL_RADIUS * 0.1,
          x, y, BALL_RADIUS
        );
        grad.addColorStop(0, lightenColor(colors[number] ?? "#888", 40));
        grad.addColorStop(1, colors[number] ?? "#888");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Ball number
      if (number > 0) {
        ctx.fillStyle = isStripe ? "#000" : getTextColor(number);
        ctx.font = `bold ${BALL_RADIUS * 0.95}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (isStripe) {
          // White circle behind number for stripes
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(x, y, BALL_RADIUS * 0.48, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
        }

        ctx.fillText(String(number), x, y + 0.5);
      }

      ctx.restore();
    });
  };

  const drawCueStick = (
    ctx: CanvasRenderingContext2D,
    ballPos: Matter.Vector,
    aim: AimState
  ) => {
    const { angle, power } = aim;
    const pullBack = 20 + power * 50; // cue stick pulled back with power
    const tipDist = BALL_RADIUS + 4 + pullBack;
    const stickLength = 200;

    const tipX = ballPos.x - Math.cos(angle) * tipDist;
    const tipY = ballPos.y - Math.sin(angle) * tipDist;
    const tailX = tipX - Math.cos(angle) * stickLength;
    const tailY = tipY - Math.sin(angle) * stickLength;

    // Cue stick gradient
    const stickGrad = ctx.createLinearGradient(tipX, tipY, tailX, tailY);
    stickGrad.addColorStop(0, "#F5DEB3");   // tip (light wood)
    stickGrad.addColorStop(0.3, "#D2691E"); // shaft
    stickGrad.addColorStop(1, "#4A2C0A");   // butt (dark)

    ctx.save();
    ctx.strokeStyle = stickGrad;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";

    // Glow for active aim
    ctx.shadowColor = "rgba(255, 200, 50, 0.4)";
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.restore();

    // Aim trajectory dotted line
    const dashLen = 80;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(ballPos.x + Math.cos(angle) * BALL_RADIUS, ballPos.y + Math.sin(angle) * BALL_RADIUS);
    ctx.lineTo(ballPos.x + Math.cos(angle) * (BALL_RADIUS + dashLen), ballPos.y + Math.sin(angle) * (BALL_RADIUS + dashLen));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  };

  const drawPowerMeter = (
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    power: number
  ) => {
    const radius = 45;

    ctx.save();
    
    // Draw background track arc
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(bx, by, radius, Math.PI * 0.5, Math.PI * 1.65, false);
    ctx.stroke();

    // Create gradient
    const pGrad = ctx.createLinearGradient(bx - radius, by + radius, bx - radius, by - radius);
    pGrad.addColorStop(0, "#3b82f6");    // Blue
    pGrad.addColorStop(0.35, "#06b6d4"); // Cyan
    pGrad.addColorStop(0.65, "#eab308"); // Yellow
    pGrad.addColorStop(0.85, "#ef4444"); // Red

    // Active power fill arc
    const endAngle = Math.PI * 0.5 + power * (Math.PI * 1.15);
    ctx.strokeStyle = pGrad;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    
    // Glow effect
    ctx.shadowColor = power > 0.75 ? "#f87171" : power > 0.35 ? "#38bdf8" : "#60a5fa";
    ctx.shadowBlur = 10;
    
    ctx.beginPath();
    ctx.arc(bx, by, radius, Math.PI * 0.5, endAngle, false);
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Draw percentage labels
    ctx.font = "bold 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const drawLabel = (val: string, angleOffset: number, color: string) => {
      const lx = bx + (radius + 14) * Math.cos(angleOffset);
      const ly = by + (radius + 14) * Math.sin(angleOffset);
      ctx.fillStyle = color;
      ctx.fillText(val, lx, ly);
    };

    drawLabel("0%", Math.PI * 0.5, "rgba(255, 255, 255, 0.4)");
    drawLabel("35%", Math.PI * 0.85, "#22d3ee");
    drawLabel("65%", Math.PI * 1.25, "#fbbf24");
    drawLabel("75%", Math.PI * 1.65, "#f87171");

    ctx.restore();
  };

  // ─── Pocket Check (per frame) ─────────────────────────────────────────────

  const checkPockets = useCallback(() => {
    const pockets = pocketsRef.current;
    ballsRef.current.forEach((ballData) => {
      if (ballData.isPocketed) return;
      const pocketIdx = checkPocketed(ballData.body, pockets);
      if (pocketIdx !== -1) {
        ballData.isPocketed = true;

        if (ballData.number === 0) {
          // Cue ball scratch
          gameStateRef.current.cueBallPocketed = true;
          Matter.Body.setPosition(ballData.body, { x: -1000, y: -1000 });
          Matter.Body.setVelocity(ballData.body, { x: 0, y: 0 });
        } else {
          gameStateRef.current.pocketedThisTurn.push(ballData.number);
          Matter.Body.setPosition(ballData.body, { x: -2000, y: -1000 });
          Matter.Body.setVelocity(ballData.body, { x: 0, y: 0 });
        }
      }
    });
  }, []);

  // ─── End Turn Logic ───────────────────────────────────────────────────────

  const endTurn = useCallback(() => {
    if (!gameStateRef.current.isRunning) return;
    gameStateRef.current.isRunning = false;

    if (isMultiplayer) {
      // In multiplayer: collect final positions and emit for consensus validation
      const positions: BallPos[] = ballsRef.current.map((b) => ({
        number: b.number,
        x: b.body.position.x,
        y: b.body.position.y,
        isPocketed: b.isPocketed,
      }));

      const foulData: FoulData = {
        cueBallPocketed: gameStateRef.current.cueBallPocketed,
        firstHitBall: gameStateRef.current.firstHitBall,
        railContactMade: gameStateRef.current.railContactMade,
        pocketedThisTurn: [...gameStateRef.current.pocketedThisTurn],
        foul: null,
      };

      if (onEmitSyncResult) {
        onEmitSyncResult(positions, foulData);
      }
      return;
    }

    const result: TurnResult = evaluateTurn(gameStateRef.current);

    setGameState((prev) => {
      const newPocketed = [
        ...prev.pocketedBalls,
        ...result.ballsPocketed.filter((n) => n !== 0),
      ];

      let winner = prev.winner;
      if (result.won) {
        winner = `Player ${prev.currentPlayer}`;
      }

      const nextPlayer: 1 | 2 = result.switchTurn
        ? prev.currentPlayer === 1 ? 2 : 1
        : prev.currentPlayer;

      const newState: GameHookState = {
        ...prev,
        isSimulating: false,
        currentPlayer: nextPlayer,
        foulMessage: result.foul ? getFoulMessage(result.foul) : "",
        winner,
        pocketedBalls: newPocketed,
        ballInHand: result.foul === "scratch" || result.foul === "wrong_ball",
        lowestBall: getLowestBall(ballsRef.current),
      };

      return newState;
    });

    // Handle cue ball respawn after scratch
    if (result.foul === "scratch") {
      const cueBall = getCueBall();
      if (cueBall) {
        cueBall.isPocketed = false;
        Matter.Body.setPosition(cueBall.body, CUE_BALL_START);
        Matter.Body.setVelocity(cueBall.body, { x: 0, y: 0 });
      }
    }

    // Reset turn tracking
    Object.assign(gameStateRef.current, resetTurnState(gameStateRef.current));
    gameStateRef.current.activeBalls = ballsRef.current.filter(
      (b) => !b.isPocketed
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCueBall, isMultiplayer, onEmitSyncResult]);

  // ─── Mouse / Input Handlers ───────────────────────────────────────────────

  const placeCueBall = useCallback((x: number, y: number) => {
    const cueBallData = getCueBall();
    if (!cueBallData) return;
    cueBallData.isPocketed = false;
    Matter.Body.setPosition(cueBallData.body, { x, y });
    Matter.Body.setVelocity(cueBallData.body, { x: 0, y: 0 });
    setGameState((prev) => ({ ...prev, ballInHand: false, foulMessage: "" }));
  }, [getCueBall]);

  const handleShoot = useCallback(() => {
    if (gameStateRef.current.isRunning) return;
    if (gameState.winner) return;
    const cueBallData = getCueBall();
    if (!cueBallData || cueBallData.isPocketed) return;

    // In multiplayer, check if it's our turn
    if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

    const shotPower = aimState.power > 0.01 ? aimState.power : 0.1;

    if (isMultiplayer && onEmitShot) {
      onEmitShot({
        angle: aimState.angle,
        power: shotPower,
        cueBallPos: {
          x: cueBallData.body.position.x,
          y: cueBallData.body.position.y,
        },
      });
    }

    Object.assign(gameStateRef.current, {
      firstHitBall: null,
      railContactMade: false,
      pocketedThisTurn: [],
      cueBallPocketed: false,
      isRunning: true,
    });

    shootCueBall(cueBallData.body, aimState.angle, shotPower);
    setAimState((prev) => ({ ...prev, power: 0, isDragging: false }));
    setGameState((prev) => ({ ...prev, isSimulating: true, foulMessage: "" }));
  }, [aimState, getCueBall, gameState.winner, isMultiplayer, myPlayerIndex, gameState.currentPlayer, onEmitShot]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (gameStateRef.current.isRunning) return;
      if (gameState.winner) return;

      // In multiplayer, check if it's our turn
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

      const cueBallData = getCueBall();
      if (!cueBallData || cueBallData.isPocketed) return;

      const pos = getCanvasPos(e);
      const bx = cueBallData.body.position.x;
      const by = cueBallData.body.position.y;
      const angle = Math.atan2(pos.y - by, pos.x - bx);

      setAimState((prev) => {
        if (prev.isDragging) {
          // Power based on drag distance from ball
          const dist = Math.sqrt((pos.x - bx) ** 2 + (pos.y - by) ** 2);
          const power = Math.max(0, Math.min(1, (dist - 30) / 150));
          return { ...prev, angle, power };
        }
        return { ...prev, angle };
      });
    },
    [getCueBall, getCanvasPos, gameState.winner, isMultiplayer, gameState.currentPlayer, myPlayerIndex]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (gameStateRef.current.isRunning || gameState.winner) return;

      // In multiplayer, check if it's our turn
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

      if (e.button === 0) {
        setAimState((prev) => ({ ...prev, isDragging: true }));
      }
    },
    [gameState.winner, isMultiplayer, gameState.currentPlayer, myPlayerIndex]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      setAimState((prev) => ({ ...prev, isDragging: false }));
    },
    []
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!gameState.ballInHand) return;

      // In multiplayer, check if it's our turn
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

      const pos = getCanvasPos(e);
      const { x, y, width, height } = TABLE_CONFIG;
      // Clamp within table bounds
      const cx = Math.max(x + BALL_RADIUS + 5, Math.min(x + width - BALL_RADIUS - 5, pos.x));
      const cy = Math.max(y + BALL_RADIUS + 5, Math.min(y + height - BALL_RADIUS - 5, pos.y));
      placeCueBall(cx, cy);
    },
    [gameState.ballInHand, getCanvasPos, isMultiplayer, gameState.currentPlayer, myPlayerIndex, placeCueBall]
  );

  const resetGame = useCallback(() => {
    initGame();
  }, [initGame]);

  // ─── Multiplayer Socket Effects ───────────────────────────────────────────

  // Sync initial game state from socket when it becomes available
  useEffect(() => {
    if (!isMultiplayer || !socketGameState) return;

    setGameState((prev) => ({
      ...prev,
      currentPlayer: socketGameState.currentPlayerIndex,
      pocketedBalls: socketGameState.pocketedBalls,
      ballInHand: socketGameState.currentPlayerIndex === myPlayerIndex ? socketGameState.ballInHand : false,
      winner: socketGameState.winner,
      consecutiveFouls: socketGameState.consecutiveFouls,
      pushOutAvailable: socketGameState.pushOutAvailable,
      isPushOutActive: socketGameState.isPushOutActive,
      pushOutResolvePending: socketGameState.pushOutResolvePending,
    }));
  }, [isMultiplayer, socketGameState, myPlayerIndex]);

  // React to opponent's shot from server
  useEffect(() => {
    if (!isMultiplayer || !lastOpponentShot) return;
    if (lastOpponentShot.shooterIndex === myPlayerIndex) {
      if (onClearOpponentShot) {
        onClearOpponentShot();
      }
      return;
    }

    const cueBallData = getCueBall();
    if (!cueBallData) return;

    Object.assign(gameStateRef.current, {
      firstHitBall: null,
      railContactMade: false,
      pocketedThisTurn: [],
      cueBallPocketed: false,
      isRunning: true,
    });

    // Sync cue ball placement chosen by opponent
    cueBallData.isPocketed = false;
    Matter.Body.setPosition(cueBallData.body, lastOpponentShot.cueBallPos);
    Matter.Body.setVelocity(cueBallData.body, { x: 0, y: 0 });

    shootCueBall(cueBallData.body, lastOpponentShot.angle, lastOpponentShot.power);

    setGameState((prev) => ({
      ...prev,
      isSimulating: true,
      foulMessage: "",
    }));

    if (onClearOpponentShot) {
      onClearOpponentShot();
    }
  }, [isMultiplayer, lastOpponentShot, myPlayerIndex, getCueBall, onClearOpponentShot]);

  // React to turn result from server (authoritative sync)
  useEffect(() => {
    if (!isMultiplayer || !lastTurnResult) return;

    const { gameState: nextSocketState, turnResult, authPositions } = lastTurnResult;

    // Sync positions
    ballsRef.current.forEach((ball) => {
      const authBall = authPositions.find((b) => b.number === ball.number);
      if (authBall) {
        ball.isPocketed = authBall.isPocketed;
        
        Matter.Body.setVelocity(ball.body, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(ball.body, 0);

        if (authBall.isPocketed) {
          if (ball.number === 0) {
            Matter.Body.setPosition(ball.body, { x: -1000, y: -1000 });
          } else {
            Matter.Body.setPosition(ball.body, { x: -2000, y: -1000 });
          }
        } else {
          Matter.Body.setPosition(ball.body, { x: authBall.x, y: authBall.y });
        }
      }
    });

    // Spawn cue ball if scratch and it is our turn
    if (turnResult.foul === "scratch") {
      const cueBall = getCueBall();
      if (cueBall) {
        if (nextSocketState.currentPlayerIndex === myPlayerIndex && nextSocketState.ballInHand) {
          cueBall.isPocketed = false;
          Matter.Body.setPosition(cueBall.body, CUE_BALL_START);
          Matter.Body.setVelocity(cueBall.body, { x: 0, y: 0 });
        }
      }
    }

    setGameState((prev) => ({
      ...prev,
      isSimulating: false,
      currentPlayer: nextSocketState.currentPlayerIndex,
      foulMessage: turnResult.foul ? getFoulMessage(turnResult.foul as any) : "",
      winner: nextSocketState.winner,
      pocketedBalls: nextSocketState.pocketedBalls,
      ballInHand: nextSocketState.currentPlayerIndex === myPlayerIndex ? nextSocketState.ballInHand : false,
      lowestBall: getLowestBall(ballsRef.current),
      consecutiveFouls: nextSocketState.consecutiveFouls,
      pushOutAvailable: nextSocketState.pushOutAvailable,
      isPushOutActive: nextSocketState.isPushOutActive,
      pushOutResolvePending: nextSocketState.pushOutResolvePending,
    }));

    Object.assign(gameStateRef.current, resetTurnState(gameStateRef.current));
    gameStateRef.current.activeBalls = ballsRef.current.filter((b) => !b.isPocketed);
    gameStateRef.current.isRunning = false;

    if (onClearTurnResult) {
      onClearTurnResult();
    }
  }, [isMultiplayer, lastTurnResult, myPlayerIndex, getCueBall, onClearTurnResult]);

  // React to game over from server
  useEffect(() => {
    if (!isMultiplayer || !gameOver) return;

    setGameState((prev) => ({
      ...prev,
      isSimulating: false,
      winner: gameOver.winner,
      pocketedBalls: gameOver.gameState.pocketedBalls,
      consecutiveFouls: gameOver.gameState.consecutiveFouls,
      pushOutAvailable: false,
      isPushOutActive: false,
      pushOutResolvePending: false,
    }));
  }, [isMultiplayer, gameOver]);

  // Listen to wheel events on the canvas to set power
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheelEvent = (e: WheelEvent) => {
      if (gameStateRef.current.isRunning || gameState.winner) return;
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      setAimState((prev) => ({
        ...prev,
        power: Math.max(0, Math.min(1, prev.power + delta)),
      }));
    };

    canvas.addEventListener("wheel", handleWheelEvent, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheelEvent);
    };
  }, [isMultiplayer, gameState.currentPlayer, myPlayerIndex, gameState.winner]);

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    initGame();
    return () => {
      if (physicsRef.current) stopEngine(physicsRef.current);
      cancelAnimationFrame(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    canvasRef,
    aimState,
    gameState,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleCanvasClick,
    handleShoot,
    resetGame,
    placeCueBall,
  };
}

// ─── Color Utilities ────────────────────────────────────────────────────────

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}

function getTextColor(ballNumber: number): string {
  const darkBalls = [2, 4, 6, 7, 8];
  return darkBalls.includes(ballNumber) ? "#ffffff" : "#000000";
}

// ─── Trajectory Calculations ───────────────────────────────────────────────

interface TrajectoryResult {
  endPoint: { x: number; y: number };
  hitPoint: { x: number; y: number } | null;
  targetBallPos: { x: number; y: number } | null;
  targetDeflection: { x: number; y: number } | null;
  cueDeflection: { x: number; y: number } | null;
}

function calculateTrajectory(
  cx: number,
  cy: number,
  angle: number,
  balls: BallData[]
): TrajectoryResult {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  
  let closestT = Infinity;
  let closestBall: BallData | null = null;
  
  const R = BALL_RADIUS;
  
  balls.forEach((ball) => {
    if (ball.number === 0 || ball.isPocketed) return;
    
    const bx = ball.body.position.x;
    const by = ball.body.position.y;
    
    const vx = cx - bx;
    const vy = cy - by;
    
    // Quadratic equation: t^2 + 2(v . d) t + (v^2 - 4R^2) = 0
    const bCoeff = 2 * (vx * dx + vy * dy);
    const cCoeff = (vx * vx + vy * vy) - 4 * R * R;
    
    const discriminant = bCoeff * bCoeff - 4 * cCoeff;
    if (discriminant >= 0) {
      const t1 = (-bCoeff - Math.sqrt(discriminant)) / 2;
      const t2 = (-bCoeff + Math.sqrt(discriminant)) / 2;
      
      const t = t1 > 0 ? t1 : (t2 > 0 ? t2 : -1);
      if (t > 0 && t < closestT) {
        closestT = t;
        closestBall = ball;
      }
    }
  });
  
  const xMin = TABLE_CONFIG.x + R;
  const xMax = TABLE_CONFIG.x + TABLE_CONFIG.width - R;
  const yMin = TABLE_CONFIG.y + R;
  const yMax = TABLE_CONFIG.y + TABLE_CONFIG.height - R;
  
  let wallT = Infinity;
  if (dx < 0) wallT = Math.min(wallT, (xMin - cx) / dx);
  if (dx > 0) wallT = Math.min(wallT, (xMax - cx) / dx);
  if (dy < 0) wallT = Math.min(wallT, (yMin - cy) / dy);
  if (dy > 0) wallT = Math.min(wallT, (yMax - cy) / dy);
  
  if (closestT < wallT && closestBall) {
    const hitX = cx + closestT * dx;
    const hitY = cy + closestT * dy;
    
    const targetX = (closestBall as BallData).body.position.x;
    const targetY = (closestBall as BallData).body.position.y;
    
    // normal vector from cue ball center at hit to target ball center
    const nx = targetX - hitX;
    const ny = targetY - hitY;
    const nDist = Math.sqrt(nx * nx + ny * ny);
    const normalX = nDist > 0 ? nx / nDist : dx;
    const normalY = nDist > 0 ? ny / nDist : dy;
    
    // target ball deflection direction
    const targetDeflectX = normalX;
    const targetDeflectY = normalY;
    
    // cue ball deflection direction: d - (d . n) n
    const dot = dx * normalX + dy * normalY;
    const cueDeflectX = dx - dot * normalX;
    const cueDeflectY = dy - dot * normalY;
    const cueDeflectDist = Math.sqrt(cueDeflectX * cueDeflectX + cueDeflectY * cueDeflectY);
    
    return {
      endPoint: { x: hitX, y: hitY },
      hitPoint: { x: hitX, y: hitY },
      targetBallPos: { x: targetX, y: targetY },
      targetDeflection: {
        x: targetDeflectX,
        y: targetDeflectY,
      },
      cueDeflection: cueDeflectDist > 0 ? {
        x: cueDeflectX / cueDeflectDist,
        y: cueDeflectY / cueDeflectDist,
      } : { x: -normalY, y: normalX },
    };
  } else {
    const endX = cx + wallT * dx;
    const endY = cy + wallT * dy;
    return {
      endPoint: { x: endX, y: endY },
      hitPoint: null,
      targetBallPos: null,
      targetDeflection: null,
      cueDeflection: null,
    };
  }
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string
) {
  const size = 6;
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.6);
  ctx.lineTo(-size, size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
