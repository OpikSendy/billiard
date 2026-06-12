"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

// ─── Types (mirror backend event payloads) ───────────────────────────────────

export interface PlayerInfo {
  nickname: string;
  playerIndex: 1 | 2;
  isReady: boolean;
}

export interface RoomInfo {
  id: string;
  status: "waiting" | "ready" | "playing" | "finished";
  players: PlayerInfo[];
}

export interface GameStateInfo {
  roomId: string;
  currentPlayerIndex: 1 | 2;
  pocketedBalls: number[];
  turnNumber: number;
  ballInHand: boolean;
  winner: string | null;
}

export interface ShotData {
  angle: number;
  power: number;
  cueBallPos: { x: number; y: number };
}

export interface BallPos {
  number: number;
  x: number;
  y: number;
  isPocketed: boolean;
}

export interface FoulData {
  cueBallPocketed: boolean;
  firstHitBall: number | null;
  railContactMade: boolean;
  pocketedThisTurn: number[];
  foul: string | null;
}

export interface TurnResult {
  foul: string | null;
  ballsPocketed: number[];
  won: boolean;
  switchTurn: boolean;
}

// ─── Socket Events ───────────────────────────────────────────────────────────

export type SocketEvents = {
  // Incoming
  room_created: (data: { room: RoomInfo }) => void;
  room_joined: (data: { room: RoomInfo }) => void;
  room_updated: (data: { room: RoomInfo }) => void;
  room_error: (data: { message: string }) => void;
  game_start: (data: { gameState: GameStateInfo; yourIndex: 1 | 2 }) => void;
  opponent_shot: (data: ShotData & { shooterIndex: 1 | 2 }) => void;
  turn_result: (data: {
    gameState: GameStateInfo;
    turnResult: TurnResult;
    authPositions: BallPos[];
    desynced: boolean;
    deviation: string;
  }) => void;
  game_over: (data: { winner: string; gameState: GameStateInfo }) => void;
  opponent_left: (data: { message: string }) => void;
};

// ─── Hook State ──────────────────────────────────────────────────────────────

export interface UseSocketReturn {
  isConnected: boolean;
  room: RoomInfo | null;
  gameState: GameStateInfo | null;
  myPlayerIndex: 1 | 2 | null;
  lastError: string | null;
  lastOpponentShot: (ShotData & { shooterIndex: 1 | 2 }) | null;
  lastTurnResult: {
    gameState: GameStateInfo;
    turnResult: TurnResult;
    authPositions: BallPos[];
    desynced: boolean;
  } | null;
  gameOver: { winner: string; gameState: GameStateInfo } | null;
  opponentLeft: boolean;

  // Actions
  createRoom: (nickname: string) => void;
  joinRoom: (nickname: string, roomId: string) => void;
  setReady: (isReady: boolean) => void;
  emitShot: (shot: ShotData) => void;
  emitSyncResult: (positions: BallPos[], foulData: FoulData) => void;
  leaveRoom: () => void;
  clearError: () => void;
  clearTurnResult: () => void;
  clearOpponentShot: () => void;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [gameState, setGameState] = useState<GameStateInfo | null>(null);
  const [myPlayerIndex, setMyPlayerIndex] = useState<1 | 2 | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastOpponentShot, setLastOpponentShot] = useState<
    (ShotData & { shooterIndex: 1 | 2 }) | null
  >(null);
  const [lastTurnResult, setLastTurnResult] = useState<{
    gameState: GameStateInfo;
    turnResult: TurnResult;
    authPositions: BallPos[];
    desynced: boolean;
  } | null>(null);
  const [gameOver, setGameOver] = useState<{
    winner: string;
    gameState: GameStateInfo;
  } | null>(null);
  const [opponentLeft, setOpponentLeft] = useState(false);

  // ─── Initialize socket connection ─────────────────────────────────────────

  useEffect(() => {
    const socket: Socket = io(BACKEND_URL, {
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Socket] Connected:", socket.id);
      setIsConnected(true);
    });

    socket.on("disconnect", (reason) => {
      console.log("[Socket] Disconnected:", reason);
      setIsConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.error("[Socket] Connection error:", err.message);
      setLastError("Cannot connect to server. Is the backend running?");
    });

    // ── Room events ────────────────────────────────────────────────────────

    socket.on("room_created", ({ room }) => {
      setRoom(room);
      setLastError(null);
    });

    socket.on("room_joined", ({ room }) => {
      setRoom(room);
      setLastError(null);
    });

    socket.on("room_updated", ({ room }) => {
      setRoom(room);
    });

    socket.on("room_error", ({ message }) => {
      setLastError(message);
    });

    // ── Game events ────────────────────────────────────────────────────────

    socket.on("game_start", ({ gameState, yourIndex }) => {
      setGameState(gameState);
      setMyPlayerIndex(yourIndex);
      setOpponentLeft(false);
    });

    socket.on("opponent_shot", (shotData) => {
      setLastOpponentShot(shotData);
    });

    socket.on("turn_result", ({ gameState, turnResult, authPositions, desynced, deviation }) => {
      setGameState(gameState);
      setLastTurnResult({ gameState, turnResult, authPositions, desynced });
      if (desynced) {
        console.warn(`[Sync] Desync detected! Deviation: ${deviation}px`);
      }
    });

    socket.on("game_over", ({ winner, gameState }) => {
      setGameState(gameState);
      setGameOver({ winner, gameState });
    });

    socket.on("opponent_left", ({ message }) => {
      setOpponentLeft(true);
      setLastError(message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const createRoom = useCallback((nickname: string) => {
    socketRef.current?.emit("create_room", { nickname });
  }, []);

  const joinRoom = useCallback((nickname: string, roomId: string) => {
    socketRef.current?.emit("join_room", { nickname, roomId });
  }, []);

  const setReady = useCallback((isReady: boolean) => {
    socketRef.current?.emit("player_ready", { isReady });
  }, []);

  const emitShot = useCallback((shot: ShotData) => {
    socketRef.current?.emit("shoot", shot);
  }, []);

  const emitSyncResult = useCallback(
    (positions: BallPos[], foulData: FoulData) => {
      socketRef.current?.emit("sync_result", { positions, foulData });
    },
    []
  );

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("leave_room");
    setRoom(null);
    setGameState(null);
    setMyPlayerIndex(null);
    setGameOver(null);
    setOpponentLeft(false);
  }, []);

  const clearError = useCallback(() => setLastError(null), []);
  const clearTurnResult = useCallback(() => setLastTurnResult(null), []);
  const clearOpponentShot = useCallback(() => setLastOpponentShot(null), []);

  return {
    isConnected,
    room,
    gameState,
    myPlayerIndex,
    lastError,
    lastOpponentShot,
    lastTurnResult,
    gameOver,
    opponentLeft,
    createRoom,
    joinRoom,
    setReady,
    emitShot,
    emitSyncResult,
    leaveRoom,
    clearError,
    clearTurnResult,
    clearOpponentShot,
  };
}
