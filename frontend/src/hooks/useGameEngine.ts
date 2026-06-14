"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import Matter from "matter-js";
import { createPhysicsEngine, startEngine, stopEngine, allBallsStopped, PhysicsEngine } from "@/lib/physics/engine";
import { createTableWalls, getTablePockets, checkPocketed, createTablePockets, TableConfig, Pocket } from "@/lib/physics/table";
import { createCueBall, createRackedBalls, shootCueBall, BallData, BALL_RADIUS } from "@/lib/physics/balls";
import { getLowestBall, evaluateTurn, resetTurnState, getFoulMessage, GameState, TurnResult } from "@/lib/game/rules";
import { GameStateInfo, ShotData, BallPos, FoulData, TurnResult as SocketTurnResult } from "@/hooks/useSocket";
import { soundManager } from "@/lib/audio/soundManager";

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
  turnNumber: number; // local turn tracking
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
  handleShoot: (powerOverride?: number) => void;
  resetGame: () => void;
  placeCueBall: (x: number, y: number) => void;
  setPower: (power: number) => void;
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

/**
 * Validates whether the cue ball can be placed at (cx, cy).
 * Blocks placement if coordinates overlap with cushion borders, active target balls, or pocket holes.
 */
function validateCueBallPlacement(
  cx: number,
  cy: number,
  balls: BallData[],
  pockets: Pocket[]
): boolean {
  const { x, y, width, height } = TABLE_CONFIG;

  // 1. Table cushion boundary check (keep ball fully inside cushion boundaries)
  if (
    cx < x + BALL_RADIUS ||
    cx > x + width - BALL_RADIUS ||
    cy < y + BALL_RADIUS ||
    cy > y + height - BALL_RADIUS
  ) {
    return false;
  }

  // 2. Overlap with existing balls check (minimum separation is 2 * radius)
  for (const ball of balls) {
    if (ball.number === 0 || ball.isPocketed) continue;
    const dx = cx - ball.body.position.x;
    const dy = cy - ball.body.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < BALL_RADIUS * 2) {
      return false;
    }
  }

  // 3. Overlap with pocket holes check (prevent placing directly inside a pocket sensor area)
  for (const pocket of pockets) {
    const dx = cx - pocket.x;
    const dy = cy - pocket.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < pocket.radius + BALL_RADIUS) {
      return false;
    }
  }

  return true;
}

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

  // High-frequency aiming refs to prevent stale closure issues in the render loop
  const currentAngleRef = useRef<number>(0);
  const currentPowerRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const firstBallHitThisTurnRef = useRef<number | null>(null);

  // New refs for click-to-shoot and angle locking
  const lockedAngleRef = useRef<number | null>(null);
  const isReadyToFireRef = useRef<boolean>(false);

  // Keep latest rendering/game callbacks in refs to avoid stale closures in requestAnimationFrame
  const drawSceneRef = useRef<any>(null);
  const checkPocketsRef = useRef<any>(null);
  const endTurnRef = useRef<any>(null);

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

  const breakCushionHitBallsRef = useRef<Set<number>>(new Set());
  const [placementPos, setPlacementPos] = useState<{ x: number; y: number } | null>(null);

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
    turnNumber: 1,
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
    physics.engine.positionIterations = 15;
    physics.engine.velocityIterations = 15;
    physicsRef.current = physics;

    // Create table walls
    const walls = createTableWalls(TABLE_CONFIG);
    Matter.World.add(physics.world, walls);

    // Create pockets
    pocketsRef.current = getTablePockets(TABLE_CONFIG);
    const pocketBodies = createTablePockets(TABLE_CONFIG);
    Matter.World.add(physics.world, pocketBodies);

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
      // Helper functions for defensive label matching
      const isCueBall = (label: string) => 
        label === 'cue-ball' || label === 'ball-0' || label.toLowerCase().includes('cue');

      const getTargetBallNumber = (label: string): number | null => {
        if (!label) return null;
        const match = label.match(/(?:target-ball-|ball-)(\d+)/);
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          return num === 0 ? null : num; // 0 belongs to cue ball
        }
        return null;
      };

      const isTargetBallLabel = (l: string) => /(?:target-ball-|ball-)(\d+)/.test(l) && !isCueBall(l);
      const isCushionLabel = (l: string) => l === 'cushion';

      // 0. Sound Effects for collisions
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        if (!bodyA.label || !bodyB.label) continue;

        const isBallA = isCueBall(bodyA.label) || isTargetBallLabel(bodyA.label);
        const isBallB = isCueBall(bodyB.label) || isTargetBallLabel(bodyB.label);
        const isCushA = isCushionLabel(bodyA.label);
        const isCushB = isCushionLabel(bodyB.label);

        if (isBallA && isBallB) {
          // Ball-to-ball hit sound with dynamic volume scaling
          const relVel = {
            x: bodyA.velocity.x - bodyB.velocity.x,
            y: bodyA.velocity.y - bodyB.velocity.y,
          };
          const speed = Math.sqrt(relVel.x * relVel.x + relVel.y * relVel.y);
          const volume = Math.min(1.0, speed / 8);
          soundManager.play("collision", volume);
        } else if ((isBallA && isCushB) || (isBallB && isCushA)) {
          // Ball-to-cushion hit sound with dynamic volume scaling
          const ball = isBallA ? bodyA : bodyB;
          const speed = Math.sqrt(ball.velocity.x * ball.velocity.x + ball.velocity.y * ball.velocity.y);
          const volume = Math.min(1.0, speed / 8);
          soundManager.play("cushion", volume);
        }
      }

      // 1. Process first ball hit logic
      if (firstBallHitThisTurnRef.current === null) {
        for (const pair of event.pairs) {
          const { bodyA, bodyB } = pair;
          if (!bodyA.label || !bodyB.label) continue;

          // Detect if one of the bodies is the cue ball
          const hasCueBall = isCueBall(bodyA.label) || isCueBall(bodyB.label);
          const targetBody = isCueBall(bodyA.label) ? bodyB : bodyA;
          const hitBallNumber = getTargetBallNumber(targetBody.label);

          // If the cue ball hit a valid target ball
          if (hasCueBall && hitBallNumber !== null) {
            // Dynamically scan the physics world to find which target balls are still alive
            const activeBodies = Matter.Composite.allBodies(physics.engine.world);
            const activeTargetNumbers = activeBodies
              .map(b => getTargetBallNumber(b.label))
              .filter((num): num is number => num !== null);

            const lowestBallRemaining = activeTargetNumbers.length > 0 ? Math.min(...activeTargetNumbers) : 1;

            if (hitBallNumber === lowestBallRemaining) {
              // LEGAL HIT!
              firstBallHitThisTurnRef.current = hitBallNumber;
              if (gameStateRef.current) gameStateRef.current.firstHitBall = hitBallNumber;
              console.log(`[GAME LOG] Legal hit registered on ball: ${hitBallNumber}`);
            } else {
              // ILLEGAL HIT!
              firstBallHitThisTurnRef.current = hitBallNumber;
              if (gameStateRef.current) gameStateRef.current.firstHitBall = hitBallNumber;
              console.log(`[GAME LOG] Foul! Hit ball ${hitBallNumber} but lowest was ${lowestBallRemaining}`);
            }
            break; // Stop evaluating other pairs once the first hit is secured
          }
        }
      }

      // 2. Process rail contact (cushion timing logic & break cushion counting)
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        if (!bodyA.label || !bodyB.label) continue;

        const isAnyBall = (b: Matter.Body) => isCueBall(b.label) || isTargetBallLabel(b.label);
        
        if ((isAnyBall(bodyA) && isCushionLabel(bodyB.label)) || (isAnyBall(bodyB) && isCushionLabel(bodyA.label))) {
          // Rail contact is only valid if it occurs AFTER a legal hit has already been registered
          if (gameStateRef.current.isRunning) {
            if (firstBallHitThisTurnRef.current !== null) {
              gameStateRef.current.railContactMade = true;
            }

            // If it's a break shot, track target balls that hit the cushion
            if (gameStateRef.current.isBreak) {
              const ballBody = isAnyBall(bodyA) ? bodyA : bodyB;
              if (isTargetBallLabel(ballBody.label)) {
                const num = getTargetBallNumber(ballBody.label);
                if (num !== null && num > 0) {
                  breakCushionHitBallsRef.current.add(num);
                  gameStateRef.current.breakCushionCount = breakCushionHitBallsRef.current.size;
                }
              }
            }
          }
        }
      }

      // 3. Process pocket sensors overlap (sinking trigger)
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        if (!bodyA.label || !bodyB.label) continue;

        const isBallBody = (b: Matter.Body) => isCueBall(b.label) || isTargetBallLabel(b.label);
        const isPocketBody = (b: Matter.Body) => b.label === "pocket";

        if ((isBallBody(bodyA) && isPocketBody(bodyB)) || (isBallBody(bodyB) && isPocketBody(bodyA))) {
          const ballBody = isBallBody(bodyA) ? bodyA : bodyB;
          const pocketBody = isPocketBody(bodyA) ? bodyA : bodyB;

          // Find the corresponding BallData
          const ballData = ballsRef.current.find((b) => b.body === ballBody);
          if (ballData && !ballData.isPocketed && !ballData.isSinking) {
            // Calculate distance between centers
            const dx = ballBody.position.x - pocketBody.position.x;
            const dy = ballBody.position.y - pocketBody.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Trigger sinking when the ball center enters the pocket's mouth
            // Use the pocket body's actual radius so fast AND slow balls are caught
            const captureRadius = (pocketBody as any).circleRadius ?? 18;
            if (dist < captureRadius) {
              ballData.isSinking = true;
              ballData.currentVisualRadius = BALL_RADIUS;
              ballData.targetPocketX = pocketBody.position.x;
              ballData.targetPocketY = pocketBody.position.y;

              // Play pocket sink SFX
              soundManager.play("pocket", 0.9);

              // Zero physical velocity
              Matter.Body.setVelocity(ballBody, { x: 0, y: 0 });
              Matter.Body.setAngularVelocity(ballBody, 0);

              // Disable physics collision for this ball while sinking
              ballBody.collisionFilter.mask = 0;

              // Pocketing a ball satisfies the cushion touch/pocketing rule
              if (gameStateRef.current) {
                gameStateRef.current.railContactMade = true;
              }
            }
          }
        }
      }
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
      isBreak: false,
      breakCushionCount: 0,
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
      turnNumber: 1,
    });

    startRenderLoop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Render Loop ──────────────────────────────────────────────────────────

  const startRenderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let lastTime = performance.now();
    let accumulator = 0;
    const fixedDelta = 1000 / 60; // ~16.67ms per frame

    const render = () => {
      const currentTime = performance.now();
      let elapsed = currentTime - lastTime;
      lastTime = currentTime;

      // Prevent "spiral of death" (large lag spikes causing infinite loops)
      if (elapsed > 100) elapsed = 100;

      // Accumulator loop for strict fixed-time physics updates
      if (gameStateRef.current.isRunning) {
        accumulator += elapsed;
        while (accumulator >= fixedDelta) {
          if (physicsRef.current) {
            Matter.Engine.update(physicsRef.current.engine, fixedDelta);
          }
          accumulator -= fixedDelta;
        }
      } else {
        accumulator = 0; // Reset when simulation is not running
      }

      if (drawSceneRef.current) {
        drawSceneRef.current(ctx, canvas.width, canvas.height);
      }
      
      // Per-frame pocket polling: catches slow-moving balls that creep into pockets
      if (gameStateRef.current.isRunning && checkPocketsRef.current) {
        checkPocketsRef.current();
      }

      // Check if simulation ended (all balls stopped AND no sinking animation in progress)
      if (gameStateRef.current.isRunning) {
        const activeBodies = ballsRef.current
          .filter((b) => !b.isPocketed && !b.isSinking)
          .map((b) => b.body);
        const anySinking = ballsRef.current.some((b) => b.isSinking);
        if (allBallsStopped(activeBodies) && !anySinking) {
          if (endTurnRef.current) {
            endTurnRef.current();
          }
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
      if (cueBallData && !cueBallData.isPocketed && !gameStateRef.current.isRunning && !gameState.isSimulating) {
        const isMyTurn = !isMultiplayer || (gameState.currentPlayer === myPlayerIndex);
        if (isMyTurn) {
          // 1. Calculate and Draw Trajectory Guide lines
          const trajectory = calculateTrajectory(
            cueBallData.body.position.x,
            cueBallData.body.position.y,
            currentAngleRef.current,
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
          drawCueStick(ctx, cueBallData.body.position, currentAngleRef.current, currentPowerRef.current);
        }
      }

      // 3. Draw Ball-in-Hand Preview (if cue ball is currently being placed)
      const isMyTurn = !isMultiplayer || (gameState.currentPlayer === myPlayerIndex);
      if (gameState.ballInHand && placementPos && isMyTurn) {
        const isValid = validateCueBallPlacement(
          placementPos.x,
          placementPos.y,
          ballsRef.current,
          pocketsRef.current
        );

        ctx.save();
        ctx.beginPath();
        ctx.arc(placementPos.x, placementPos.y, BALL_RADIUS, 0, Math.PI * 2);
        
        if (isValid) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
        } else {
          ctx.fillStyle = "rgba(239, 68, 68, 0.35)";
          ctx.fill();
          ctx.strokeStyle = "#ef4444";
        }

        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();

        if (!isValid) {
          // Draw a small red warning 'X' in the center
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          const size = 5;
          ctx.moveTo(placementPos.x - size, placementPos.y - size);
          ctx.lineTo(placementPos.x + size, placementPos.y + size);
          ctx.moveTo(placementPos.x + size, placementPos.y - size);
          ctx.lineTo(placementPos.x - size, placementPos.y + size);
          ctx.stroke();
        }
        ctx.restore();
      }
    },
    [getCueBall, isMultiplayer, myPlayerIndex, gameState.currentPlayer, gameState.ballInHand, placementPos]
  );

  const drawTable = (ctx: CanvasRenderingContext2D) => {
    const { x, y, width, height } = TABLE_CONFIG;

    // Outer frame (rich dark wood)
    ctx.save();
    ctx.fillStyle = "#4a2406";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(x - 32, y - 32, width + 64, height + 64, 12);
    ctx.fill();
    ctx.shadowBlur = 0;
    
    ctx.strokeStyle = "#271101";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Felt (playing surface including cushion base)
    ctx.save();
    const feltGrad = ctx.createLinearGradient(x - 25, y - 25, x + width + 25, y + height + 25);
    feltGrad.addColorStop(0, "#0f5a34");
    feltGrad.addColorStop(0.5, "#15803d");
    feltGrad.addColorStop(1, "#0f5a34");
    ctx.fillStyle = feltGrad;
    ctx.beginPath();
    ctx.roundRect(x - 26, y - 26, width + 52, height + 52, 8);
    ctx.fill();
    ctx.restore();

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

    // Draw split slanted cushions
    ctx.save();
    
    const cushions = [
      {
        label: "cushion-top-left",
        pts: [
          { x: x + 35, y: y - 24 },
          { x: x + width/2 - 25, y: y - 24 },
          { x: x + width/2 - 25 - 12, y: y },
          { x: x + 35 + 18, y: y }
        ]
      },
      {
        label: "cushion-top-right",
        pts: [
          { x: x + width/2 + 25, y: y - 24 },
          { x: x + width - 35, y: y - 24 },
          { x: x + width - 35 - 18, y: y },
          { x: x + width/2 + 25 + 12, y: y }
        ]
      },
      {
        label: "cushion-bottom-left",
        pts: [
          { x: x + 35, y: y + height + 24 },
          { x: x + width/2 - 25, y: y + height + 24 },
          { x: x + width/2 - 25 - 12, y: y + height },
          { x: x + 35 + 18, y: y + height }
        ]
      },
      {
        label: "cushion-bottom-right",
        pts: [
          { x: x + width/2 + 25, y: y + height + 24 },
          { x: x + width - 35, y: y + height + 24 },
          { x: x + width - 35 - 18, y: y + height },
          { x: x + width/2 + 25 + 12, y: y + height }
        ]
      },
      {
        label: "cushion-left",
        pts: [
          { x: x - 24, y: y + 35 },
          { x: x - 24, y: y + height - 35 },
          { x: x, y: y + height - 35 - 18 },
          { x: x, y: y + 35 + 18 }
        ]
      },
      {
        label: "cushion-right",
        pts: [
          { x: x + width + 24, y: y + 35 },
          { x: x + width + 24, y: y + height - 35 },
          { x: x + width, y: y + height - 35 - 18 },
          { x: x + width, y: y + 35 + 18 }
        ]
      }
    ];

    cushions.forEach((c) => {
      let grad;
      if (c.label.startsWith("cushion-top")) {
        grad = ctx.createLinearGradient(0, y - 24, 0, y);
      } else if (c.label.startsWith("cushion-bottom")) {
        grad = ctx.createLinearGradient(0, y + height + 24, 0, y + height);
      } else if (c.label === "cushion-left") {
        grad = ctx.createLinearGradient(x - 24, 0, x, 0);
      } else {
        grad = ctx.createLinearGradient(x + width + 24, 0, x + width, 0);
      }
      
      grad.addColorStop(0, "#14532d");
      grad.addColorStop(0.3, "#166534");
      grad.addColorStop(1, "#15803d");

      ctx.fillStyle = grad;
      ctx.strokeStyle = "#0f3e22";
      ctx.lineWidth = 1;
      
      ctx.beginPath();
      ctx.moveTo(c.pts[0].x, c.pts[0].y);
      for (let i = 1; i < c.pts.length; i++) {
        ctx.lineTo(c.pts[i].x, c.pts[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c.pts[3].x, c.pts[3].y);
      ctx.lineTo(c.pts[2].x, c.pts[2].y);
      ctx.stroke();
    });

    ctx.fillStyle = "#15803d";
    ctx.strokeStyle = "#14532d";
    ctx.lineWidth = 1;
    if (physicsRef.current) {
      const bodies = physicsRef.current.world.bodies;
      bodies.forEach((body) => {
        if (body.label === "cushion" && (body as any).circleRadius) {
          ctx.beginPath();
          ctx.arc(body.position.x, body.position.y, (body as any).circleRadius || 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });
    }

    ctx.restore();
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

      // Sinking visual animation logic
      let radius = BALL_RADIUS;
      if (ballData.isSinking) {
        ballData.currentVisualRadius = (ballData.currentVisualRadius ?? BALL_RADIUS) * 0.85;
        radius = ballData.currentVisualRadius;

        // Slide visual position towards pocket center
        if (ballData.targetPocketX !== undefined && ballData.targetPocketY !== undefined) {
          const nextX = body.position.x + (ballData.targetPocketX - body.position.x) * 0.2;
          const nextY = body.position.y + (ballData.targetPocketY - body.position.y) * 0.2;
          Matter.Body.setPosition(body, { x: nextX, y: nextY });
        }

        // Once visual radius drops below 1px, destroy from world and update rules state
        if (radius < 1) {
          ballData.isPocketed = true;
          ballData.isSinking = false;
          if (physicsRef.current) {
            Matter.World.remove(physicsRef.current.world, body);
          }

          if (number === 0) {
            gameStateRef.current.cueBallPocketed = true;
            Matter.Body.setPosition(body, { x: -1000, y: -1000 });
            Matter.Body.setVelocity(body, { x: 0, y: 0 });
          } else {
            gameStateRef.current.pocketedThisTurn.push(number);
            Matter.Body.setPosition(body, { x: -2000, y: -1000 });
            Matter.Body.setVelocity(body, { x: 0, y: 0 });
          }
          return;
        }
      }

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
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Stripe band
        ctx.fillStyle = colors[number] ?? "#888";
        ctx.beginPath();
        ctx.arc(x, y, radius, Math.PI * 0.25, Math.PI * 0.75);
        ctx.arc(x, y, radius, Math.PI * 1.25, Math.PI * 1.75);
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(
          x - radius * 0.3, y - radius * 0.3, radius * 0.1,
          x, y, radius
        );
        grad.addColorStop(0, lightenColor(colors[number] ?? "#888", 40));
        grad.addColorStop(1, colors[number] ?? "#888");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Ball number
      if (number > 0) {
        ctx.fillStyle = isStripe ? "#000" : getTextColor(number);
        ctx.font = `bold ${radius * 0.95}px Inter, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (isStripe) {
          // White circle behind number for stripes
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(x, y, radius * 0.48, 0, Math.PI * 2);
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
    angle: number,
    power: number
  ) => {
    const pullBack = 20 + power * 50; // cue stick pulled back with power
    const tipDist = BALL_RADIUS + 4 + pullBack;
    const stickLength = 200;

    // Use canvas transformation for 360-degree rotation around cue ball
    ctx.save();
    ctx.translate(ballPos.x, ballPos.y);
    ctx.rotate(angle);

    // Tip and tail coordinates in local translated/rotated system
    const tipX = -tipDist;
    const tailX = -tipDist - stickLength;

    // Cue stick gradient defined in local coordinates
    const stickGrad = ctx.createLinearGradient(tipX, 0, tailX, 0);
    stickGrad.addColorStop(0, "#F5DEB3");   // tip (light wood)
    stickGrad.addColorStop(0.3, "#D2691E"); // shaft
    stickGrad.addColorStop(1, "#4A2C0A");   // butt (dark)

    ctx.strokeStyle = stickGrad;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";

    // Glow for active aim
    ctx.shadowColor = "rgba(255, 200, 50, 0.4)";
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(tipX, 0);
    ctx.lineTo(tailX, 0);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.restore();

    // Aim trajectory dotted line in local coordinates
    const dashLen = 80;
    ctx.save();
    ctx.translate(ballPos.x, ballPos.y);
    ctx.rotate(angle);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(BALL_RADIUS, 0);
    ctx.lineTo(BALL_RADIUS + dashLen, 0);
    ctx.stroke();
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
      // Skip balls already handled
      if (ballData.isPocketed || ballData.isSinking) return;

      for (const pocket of pockets) {
        const dx = ballData.body.position.x - pocket.x;
        const dy = ballData.body.position.y - pocket.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Ball center is within the pocket mouth — trigger sinking animation
        if (dist < pocket.radius) {
          ballData.isSinking = true;
          ballData.currentVisualRadius = BALL_RADIUS;
          ballData.targetPocketX = pocket.x;
          ballData.targetPocketY = pocket.y;

          // Play pocket sound
          soundManager.play("pocket", 0.9);

          // Freeze physics immediately
          Matter.Body.setVelocity(ballData.body, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(ballData.body, 0);
          // Strip collision mask so sinking ball ignores everything
          ballData.body.collisionFilter.mask = 0;

          // Pocketing a ball satisfies the cushion-touch rule
          if (gameStateRef.current) {
            gameStateRef.current.railContactMade = true;
          }
          break; // One pocket match per ball is enough
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
        isBreak: gameStateRef.current.isBreak,
        breakCushionCount: gameStateRef.current.breakCushionCount,
      };

      if (onEmitSyncResult) {
        onEmitSyncResult(positions, foulData);
      }
      return;
    }

    // Local single player turn evaluation
    gameStateRef.current.isBreak = gameState.turnNumber === 1;
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

      const nextTurnNumber = prev.turnNumber + 1;

      const newState: GameHookState = {
        ...prev,
        isSimulating: false,
        currentPlayer: nextPlayer,
        foulMessage: result.foul ? getFoulMessage(result.foul) : "",
        winner,
        pocketedBalls: newPocketed,
        ballInHand: result.foul === "scratch" || result.foul === "wrong_ball" || result.foul === "bad_break" || result.foul === "time_foul",
        lowestBall: getLowestBall(ballsRef.current),
        turnNumber: nextTurnNumber,
      };

      return newState;
    });

    // Handle cue ball respawn after scratch
    if (result.foul === "scratch") {
      const cueBall = getCueBall();
      if (cueBall) {
        cueBall.isPocketed = false;
        cueBall.body.collisionFilter.mask = 0x0001 | 0x0002 | 0x0004;
        Matter.Body.setPosition(cueBall.body, CUE_BALL_START);
        Matter.Body.setVelocity(cueBall.body, { x: 0, y: 0 });
        if (physicsRef.current) {
          const worldBodies = Matter.Composite.allBodies(physicsRef.current.world);
          if (!worldBodies.includes(cueBall.body)) {
            Matter.World.add(physicsRef.current.world, cueBall.body);
          }
        }
      }
    }

    // Reset turn tracking
    firstBallHitThisTurnRef.current = null;
    breakCushionHitBallsRef.current.clear();
    Object.assign(gameStateRef.current, resetTurnState(gameStateRef.current));
    gameStateRef.current.activeBalls = ballsRef.current.filter(
      (b) => !b.isPocketed
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCueBall, isMultiplayer, onEmitSyncResult, gameState.turnNumber]);

  // ─── Mouse / Input Handlers ───────────────────────────────────────────────

  const placeCueBall = useCallback((x: number, y: number) => {
    const cueBallData = getCueBall();
    if (!cueBallData) return;
    cueBallData.isPocketed = false;
    cueBallData.body.collisionFilter.mask = 0x0001 | 0x0002 | 0x0004;
    Matter.Body.setPosition(cueBallData.body, { x, y });
    Matter.Body.setVelocity(cueBallData.body, { x: 0, y: 0 });
    if (physicsRef.current) {
      const worldBodies = Matter.Composite.allBodies(physicsRef.current.world);
      if (!worldBodies.includes(cueBallData.body)) {
        Matter.World.add(physicsRef.current.world, cueBallData.body);
      }
    }
    setPlacementPos(null); // Clear placement preview coordinates
    setGameState((prev) => ({ ...prev, ballInHand: false, foulMessage: "" }));
  }, [getCueBall]);

  const handleShoot = useCallback((powerOverride?: number) => {
    // Snapshot angle and power values immediately to freeze inputs at the millisecond of invocation
    const snapshotPower = currentPowerRef.current;
    const shotPower = powerOverride !== undefined ? powerOverride : snapshotPower;
    
    // Strict guard clause: block shot if power is 0 (or <= 0)
    if (shotPower <= 0) {
      console.log("[INPUT GUARD] Shot blocked. Power is 0.");
      return;
    }

    // Use the locked angle if available, otherwise fallback to current angle
    const shotAngle = lockedAngleRef.current !== null ? lockedAngleRef.current : currentAngleRef.current;

    if (gameStateRef.current.isRunning) return;
    if (gameState.winner) return;
    const cueBallData = getCueBall();
    if (!cueBallData || cueBallData.isPocketed) return;

    // In multiplayer, check if it's our turn
    if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

    if (isMultiplayer && onEmitShot) {
      onEmitShot({
        angle: shotAngle,
        power: shotPower,
        cueBallPos: {
          x: cueBallData.body.position.x,
          y: cueBallData.body.position.y,
        },
      });
    }

    firstBallHitThisTurnRef.current = null;
    breakCushionHitBallsRef.current.clear();
    
    // Set break shot indicators
    const isBreak = gameState.turnNumber === 1;
    Object.assign(gameStateRef.current, {
      firstHitBall: null,
      railContactMade: false,
      pocketedThisTurn: [],
      cueBallPocketed: false,
      isRunning: true,
      isBreak: isBreak,
      breakCushionCount: 0,
    });

    // Play stik strike sound (volume scales with shot power)
    soundManager.play("shoot", shotPower);

    shootCueBall(cueBallData.body, shotAngle, shotPower);
    currentPowerRef.current = 0;
    isDraggingRef.current = false;
    lockedAngleRef.current = null;
    isReadyToFireRef.current = false;
    setPlacementPos(null);
    setAimState((prev) => ({ ...prev, power: 0, isDragging: false }));
    setGameState((prev) => ({ ...prev, isSimulating: true, foulMessage: "" }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCueBall, gameState.winner, isMultiplayer, myPlayerIndex, gameState.currentPlayer, gameState.turnNumber, onEmitShot]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (gameStateRef.current.isRunning) return;
      if (gameState.winner) return;

      // In multiplayer, check if it's our turn
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

      const pos = getCanvasPos(e);

      // Track placement preview coordinates if placing
      if (gameState.ballInHand) {
        setPlacementPos(pos);
        return;
      }

      // Canvas Boundary Guard: Check if mouse is within a safety margin from canvas borders
      const canvasWidth = TABLE_CONFIG.x * 2 + TABLE_CONFIG.width + 60; // 900
      const canvasHeight = TABLE_CONFIG.y * 2 + TABLE_CONFIG.height; // 460
      const margin = 10;
      const isInsideCanvas = 
        pos.x >= margin && 
        pos.x <= canvasWidth - margin && 
        pos.y >= margin && 
        pos.y <= canvasHeight - margin;

      if (!isInsideCanvas) {
        return; // Lock angle: ignore mouse movements near/outside canvas borders
      }

      const cueBallData = getCueBall();
      if (!cueBallData || cueBallData.isPocketed) return;

      const bx = cueBallData.body.position.x;
      const by = cueBallData.body.position.y;
      const targetAngle = Math.atan2(pos.y - by, pos.x - bx);

      let angleDiff = targetAngle - currentAngleRef.current;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

      if (e.shiftKey) {
        // Slow aim: dampen angle tracking by 90% to allow pixel-perfect precision
        currentAngleRef.current += angleDiff * 0.1;
      } else {
        // Direct tracking
        currentAngleRef.current = targetAngle;
      }

      // Normalize current angle between -PI and PI
      while (currentAngleRef.current < -Math.PI) currentAngleRef.current += Math.PI * 2;
      while (currentAngleRef.current > Math.PI) currentAngleRef.current -= Math.PI * 2;

      setAimState((prev) => ({ ...prev, angle: currentAngleRef.current }));
    },
    [getCueBall, getCanvasPos, gameState.winner, isMultiplayer, gameState.currentPlayer, myPlayerIndex, gameState.ballInHand]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (gameStateRef.current.isRunning || gameState.winner) return;

      // In multiplayer, check if it's our turn
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

      if (e.button === 0) {
        // Only set lock and ready-to-fire if we are not placing the cue ball (Ball-in-Hand)
        if (!gameState.ballInHand) {
          lockedAngleRef.current = currentAngleRef.current;
          isReadyToFireRef.current = true;
          console.log("[LOCK ANGLE] Angle locked at MouseDown:", lockedAngleRef.current);
        }

        isDraggingRef.current = true;
        setAimState((prev) => ({ ...prev, isDragging: true }));

        const cueBallData = getCueBall();
        if (cueBallData && !cueBallData.isPocketed) {
          const pos = getCanvasPos(e);
          const bx = cueBallData.body.position.x;
          const by = cueBallData.body.position.y;
          const angle = Math.atan2(pos.y - by, pos.x - bx);
          currentAngleRef.current = angle;
          setAimState((prev) => ({ ...prev, angle }));

          // Update locked angle to this clicked angle as well
          if (!gameState.ballInHand) {
            lockedAngleRef.current = angle;
          }
        }
      }
    },
    [gameState.winner, isMultiplayer, gameState.currentPlayer, myPlayerIndex, getCueBall, getCanvasPos, gameState.ballInHand]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;

      isDraggingRef.current = false;
      setAimState((prev) => ({ ...prev, isDragging: false }));

      // Shoot on mouse release if we were ready, not in ball-in-hand, game is ready, and power is set
      if (isReadyToFireRef.current && !gameState.ballInHand && !gameStateRef.current.isRunning && !gameState.winner) {
        const isMyTurn = !isMultiplayer || (gameState.currentPlayer === myPlayerIndex);
        const snapshotPower = currentPowerRef.current;
        if (isMyTurn && snapshotPower > 0) {
          console.log(`[FIRE TRIGGER] Shoot triggered on MouseUp. Angle: ${lockedAngleRef.current}, Power: ${snapshotPower}`);
          handleShoot();
        }
      }

      // Reset the ready-to-fire states
      isReadyToFireRef.current = false;
      lockedAngleRef.current = null;
    },
    [gameState.ballInHand, gameState.winner, isMultiplayer, gameState.currentPlayer, myPlayerIndex, handleShoot]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!gameState.ballInHand) return;

      // In multiplayer, check if it's our turn
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;

      const pos = getCanvasPos(e);
      
      // Validate placement position against cushion boundary, target balls, and pockets
      const isValid = validateCueBallPlacement(
        pos.x,
        pos.y,
        ballsRef.current,
        pocketsRef.current
      );

      if (isValid) {
        placeCueBall(pos.x, pos.y);
      }
    },
    [gameState.ballInHand, getCanvasPos, isMultiplayer, gameState.currentPlayer, myPlayerIndex, placeCueBall]
  );

  const resetGame = useCallback(() => {
    initGame();
  }, [initGame]);

  const setPower = useCallback((power: number) => {
    const nextPower = Math.max(0, Math.min(1, power));
    currentPowerRef.current = nextPower;
    setAimState((prev) => ({
      ...prev,
      power: nextPower,
    }));
  }, []);

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

    firstBallHitThisTurnRef.current = null;
    Object.assign(gameStateRef.current, {
      firstHitBall: null,
      railContactMade: false,
      pocketedThisTurn: [],
      cueBallPocketed: false,
      isRunning: true,
    });

    // Sync cue ball placement chosen by opponent
    cueBallData.isPocketed = false;
    cueBallData.body.collisionFilter.mask = 0x0001 | 0x0002 | 0x0004;
    Matter.Body.setPosition(cueBallData.body, lastOpponentShot.cueBallPos);
    Matter.Body.setVelocity(cueBallData.body, { x: 0, y: 0 });
    if (physicsRef.current) {
      const worldBodies = Matter.Composite.allBodies(physicsRef.current.world);
      if (!worldBodies.includes(cueBallData.body)) {
        Matter.World.add(physicsRef.current.world, cueBallData.body);
      }
    }

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
          cueBall.body.collisionFilter.mask = 0x0001 | 0x0002 | 0x0004;
          Matter.Body.setPosition(cueBall.body, CUE_BALL_START);
          Matter.Body.setVelocity(cueBall.body, { x: 0, y: 0 });
          if (physicsRef.current) {
            const worldBodies = Matter.Composite.allBodies(physicsRef.current.world);
            if (!worldBodies.includes(cueBall.body)) {
              Matter.World.add(physicsRef.current.world, cueBall.body);
            }
          }
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

    firstBallHitThisTurnRef.current = null;
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
      setAimState((prev) => {
        const nextPower = Math.max(0, Math.min(1, prev.power + delta));
        currentPowerRef.current = nextPower;
        return {
          ...prev,
          power: nextPower,
        };
      });
    };

    canvas.addEventListener("wheel", handleWheelEvent, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheelEvent);
    };
  }, [isMultiplayer, gameState.currentPlayer, myPlayerIndex, gameState.winner]);

  // Listen to keyboard Arrow keys and Spacebar for fine-tuning angle and shooting
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameStateRef.current.isRunning || gameState.isSimulating || gameState.winner) return;
      if (isMultiplayer && gameState.currentPlayer !== myPlayerIndex) return;
      if (gameState.ballInHand) return; // ignore during placement

      // Spacebar to shoot (ready state checked above)
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        handleShoot();
        return;
      }

      const step = 0.003; // micro step for high precision fine-tuning
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        currentAngleRef.current -= step;
        while (currentAngleRef.current < -Math.PI) currentAngleRef.current += Math.PI * 2;
        while (currentAngleRef.current > Math.PI) currentAngleRef.current -= Math.PI * 2;
        setAimState((prev) => ({ ...prev, angle: currentAngleRef.current }));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        currentAngleRef.current += step;
        while (currentAngleRef.current < -Math.PI) currentAngleRef.current += Math.PI * 2;
        while (currentAngleRef.current > Math.PI) currentAngleRef.current -= Math.PI * 2;
        setAimState((prev) => ({ ...prev, angle: currentAngleRef.current }));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMultiplayer, gameState.currentPlayer, myPlayerIndex, gameState.winner, gameState.isSimulating, gameState.ballInHand, handleShoot]);

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    initGame();
    return () => {
      if (physicsRef.current) stopEngine(physicsRef.current);
      cancelAnimationFrame(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep rendering and logic callbacks fresh
  useEffect(() => {
    drawSceneRef.current = drawScene;
  }, [drawScene]);

  useEffect(() => {
    checkPocketsRef.current = checkPockets;
  }, [checkPockets]);

  useEffect(() => {
    endTurnRef.current = endTurn;
  }, [endTurn]);

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
    setPower,
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
