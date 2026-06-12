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
        drawCueStick(ctx, cueBallData.body.position, aimState);
        drawPowerMeter(ctx, aimState.power);
      }
    },
    [aimState, getCueBall]
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

  const drawPowerMeter = (ctx: CanvasRenderingContext2D, power: number) => {
    const barX = TABLE_CONFIG.x + TABLE_CONFIG.width + 20;
    const barY = TABLE_CONFIG.y + TABLE_CONFIG.height * 0.2;
    const barH = TABLE_CONFIG.height * 0.6;
    const barW = 16;

    // Track
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 8);
    ctx.fill();

    // Fill
    const fillH = barH * power;
    const powerGrad = ctx.createLinearGradient(0, barY + barH, 0, barY);
    powerGrad.addColorStop(0, "#22c55e");
    powerGrad.addColorStop(0.6, "#eab308");
    powerGrad.addColorStop(1, "#ef4444");

    ctx.fillStyle = powerGrad;
    ctx.beginPath();
    ctx.roundRect(barX, barY + barH - fillH, barW, fillH, 8);
    ctx.fill();

    // Label
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PWR", barX + barW / 2, barY + barH + 18);
    ctx.fillText(`${Math.round(power * 100)}%`, barX + barW / 2, barY - 8);
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
          const power = Math.min(dist / 150, 1);
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
        setAimState((prev) => ({ ...prev, isDragging: true, power: 0 }));
      }
    },
    [gameState.winner, isMultiplayer, gameState.currentPlayer, myPlayerIndex]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const wasDragging = aimState.isDragging;
      setAimState((prev) => ({ ...prev, isDragging: false }));

      // In multiplayer, check if it's our turn
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

      if (wasDragging && aimState.power > 0.02 && !gameState.ballInHand) {
        handleShoot();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aimState, isMultiplayer, gameState.currentPlayer, myPlayerIndex, handleShoot, gameState.ballInHand]
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

  const handleShoot = useCallback(() => {
    if (gameStateRef.current.isRunning) return;
    if (gameState.winner) return;
    const cueBallData = getCueBall();
    if (!cueBallData || cueBallData.isPocketed) return;

    // In multiplayer, check if it's our turn
    if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

    if (isMultiplayer && onEmitShot) {
      onEmitShot({
        angle: aimState.angle,
        power: aimState.power > 0 ? aimState.power : 0.3,
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

    shootCueBall(cueBallData.body, aimState.angle, aimState.power > 0 ? aimState.power : 0.3);
    setAimState((prev) => ({ ...prev, power: 0, isDragging: false }));
    setGameState((prev) => ({ ...prev, isSimulating: true, foulMessage: "" }));
  }, [aimState, getCueBall, gameState.winner, isMultiplayer, myPlayerIndex, gameState.currentPlayer, onEmitShot]);

  const placeCueBall = useCallback((x: number, y: number) => {
    const cueBallData = getCueBall();
    if (!cueBallData) return;
    cueBallData.isPocketed = false;
    Matter.Body.setPosition(cueBallData.body, { x, y });
    Matter.Body.setVelocity(cueBallData.body, { x: 0, y: 0 });
    setGameState((prev) => ({ ...prev, ballInHand: false, foulMessage: "" }));
  }, [getCueBall]);

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
    }));
  }, [isMultiplayer, gameOver]);

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
