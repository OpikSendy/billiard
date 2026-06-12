"use client";

import { useSocketContext } from "@/context/SocketContext";
export type {
  PlayerInfo,
  RoomInfo,
  GameStateInfo,
  ShotData,
  BallPos,
  FoulData,
  TurnResult,
} from "@/context/SocketContext";

export function useSocket() {
  return useSocketContext();
}
