"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";
import NicknameScreen from "@/components/lobby/NicknameScreen";
import RoomScreen from "@/components/lobby/RoomScreen";
import WaitingRoom from "@/components/lobby/WaitingRoom";

type LobbyStep = "nickname" | "room" | "waiting" | "starting";

export default function LobbyPage() {
  const router = useRouter();
  const {
    isConnected,
    room,
    gameState,
    myPlayerIndex,
    lastError,
    createRoom,
    joinRoom,
    setReady,
    leaveRoom,
    clearError,
  } = useSocket();

  const [step, setStep] = useState<LobbyStep>("nickname");
  const [nickname, setNickname] = useState("");

  // ── Transition handlers ────────────────────────────────────────────────────

  const handleNicknameConfirm = (name: string) => {
    setNickname(name);
    setStep("room");
  };

  const handleCreateRoom = () => {
    createRoom(nickname);
  };

  const handleJoinRoom = (roomId: string) => {
    joinRoom(nickname, roomId);
  };

  const handleReady = (isReady: boolean) => {
    setReady(isReady);
  };

  const handleLeave = () => {
    leaveRoom();
    setStep("room");
  };

  // ── React to socket events ─────────────────────────────────────────────────

  // When a room is created or joined → go to waiting room
  useEffect(() => {
    if (room && step === "room") {
      setStep("waiting");
    }
  }, [room, step]);

  // When game starts → navigate to multiplayer game page
  useEffect(() => {
    if (gameState && myPlayerIndex) {
      setStep("starting");
      // Give a brief "Starting..." moment, then navigate
      const timer = setTimeout(() => {
        router.push(`/game/multiplayer`);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [gameState, myPlayerIndex, router]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-green-950/40 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {step === "nickname" && (
          <NicknameScreen onConfirm={handleNicknameConfirm} />
        )}

        {step === "room" && (
          <RoomScreen
            nickname={nickname}
            isConnected={isConnected}
            lastError={lastError}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            onClearError={clearError}
          />
        )}

        {step === "waiting" && room && (
          <WaitingRoom
            room={room}
            myPlayerIndex={myPlayerIndex}
            onReady={handleReady}
            onLeave={handleLeave}
          />
        )}

        {step === "starting" && (
          <div className="flex flex-col items-center gap-6 animate-fade-in">
            <div className="text-6xl animate-bounce">🎱</div>
            <div className="text-white font-bold text-xl">Game starting...</div>
            <div className="text-white/40 text-sm">
              You are Player {myPlayerIndex}
            </div>
            <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </main>
  );
}
