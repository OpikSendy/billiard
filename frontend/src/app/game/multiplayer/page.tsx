"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSocket } from "@/hooks/useSocket";
import { useGameEngine } from "@/hooks/useGameEngine";
import GameCanvas from "@/components/game/GameCanvas";

export default function MultiplayerGamePage() {
  const router = useRouter();
  const {
    isConnected,
    room,
    gameState,
    myPlayerIndex,
    lastError,
    lastOpponentShot,
    lastTurnResult,
    gameOver,
    opponentLeft,
    emitShot,
    emitSyncResult,
    leaveRoom,
    clearOpponentShot,
    clearTurnResult,
  } = useSocket();

  // Redirect to lobby if room is lost or not in multiplayer room context
  useEffect(() => {
    if (!room) {
      const timer = setTimeout(() => {
        router.push("/lobby");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [room, router]);

  // Connect socket events with game engine
  const engine = useGameEngine({
    isMultiplayer: true,
    myPlayerIndex,
    socketGameState: gameState,
    lastOpponentShot,
    lastTurnResult,
    gameOver,
    opponentLeft,
    onEmitShot: emitShot,
    onEmitSyncResult: emitSyncResult,
    onClearOpponentShot: clearOpponentShot,
    onClearTurnResult: clearTurnResult,
  });

  const handleLeave = () => {
    leaveRoom();
    router.push("/lobby");
  };

  // Render loading/redirect state if room not found
  if (!room) {
    return (
      <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 gap-6 text-center">
        <div className="w-12 h-12 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
        <div className="flex flex-col gap-2">
          <h1 className="text-white font-bold text-xl">Connecting to Room...</h1>
          <p className="text-white/40 text-sm max-w-xs leading-relaxed">
            Please wait, or return to the lobby if you are not joined to any active room.
          </p>
        </div>
        <Link
          href="/lobby"
          className="px-6 py-2.5 bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 text-sm font-semibold rounded-xl transition-colors"
        >
          ← Go to Lobby
        </Link>
      </main>
    );
  }

  const p1Nickname = room.players.find((p) => p.playerIndex === 1)?.nickname || "Player 1";
  const p2Nickname = room.players.find((p) => p.playerIndex === 2)?.nickname || "Player 2";

  return (
    <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 gap-6 relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-green-950/20 rounded-full blur-[120px]" />
      </div>

      {/* Header Info */}
      <div className="relative z-10 flex items-center justify-between w-full max-w-[840px] px-2 animate-fade-in">
        <div className="flex flex-col">
          <h1 className="text-white/40 text-xs uppercase tracking-widest font-semibold">9-Ball Pool Match</h1>
          <div className="text-white font-bold text-sm">
            Room Code: <span className="text-green-400 select-all">{room.id}</span>
          </div>
        </div>

        {/* Server Connection status */}
        <div className="flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs text-white/50">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500 animate-pulse"}`} />
          {isConnected ? "Connected" : "Reconnecting..."}
        </div>
      </div>

      {/* Main Game Component */}
      <div className="relative z-10 w-full max-w-[900px] flex justify-center">
        <GameCanvas
          engine={engine}
          playerNames={{ p1: p1Nickname, p2: p2Nickname }}
          isMultiplayer={true}
          myPlayerIndex={myPlayerIndex}
          onLeave={handleLeave}
        />
      </div>

      {/* Error alert toast */}
      {lastError && !opponentLeft && (
        <div className="relative z-10 px-4 py-2 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 text-xs animate-shake">
          {lastError}
        </div>
      )}

      {/* Opponent Disconnected Modal */}
      {opponentLeft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-6 p-8 rounded-2xl border border-red-500/30 bg-slate-900/90 shadow-2xl shadow-red-500/10 text-center max-w-sm mx-4">
            <div className="text-6xl animate-bounce">🚪</div>
            <div className="flex flex-col gap-2">
              <div className="text-red-400 text-2xl font-bold">Opponent Left</div>
              <p className="text-white/50 text-sm leading-relaxed">
                Your opponent disconnected or left the match. The game session has ended.
              </p>
            </div>
            <button
              onClick={handleLeave}
              className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-colors text-sm w-full font-semibold"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
