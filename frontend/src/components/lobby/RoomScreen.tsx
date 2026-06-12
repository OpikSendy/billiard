"use client";

import { useState } from "react";

interface Props {
  nickname: string;
  isConnected: boolean;
  lastError: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onClearError: () => void;
}

export default function RoomScreen({
  nickname,
  isConnected,
  lastError,
  onCreateRoom,
  onJoinRoom,
  onClearError,
}: Props) {
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"menu" | "join">("menu");

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) return;
    onJoinRoom(code);
  };

  return (
    <div className="flex flex-col items-center gap-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="text-5xl mb-2">🎱</div>
        <h1 className="text-3xl font-bold text-white">Welcome, {nickname}!</h1>
        <div className="flex items-center gap-2 mt-1">
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-400" : "bg-red-400"} animate-pulse`}
          />
          <span className="text-white/40 text-xs">
            {isConnected ? "Connected to server" : "Connecting..."}
          </span>
        </div>
      </div>

      {/* Error Banner */}
      {lastError && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm max-w-xs w-full animate-fade-in">
          <span>⚠️ {lastError}</span>
          <button
            onClick={onClearError}
            className="ml-auto text-red-400/50 hover:text-red-400 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Menu */}
      {mode === "menu" && (
        <div className="flex flex-col gap-3 w-72">
          <button
            id="btn-create-room"
            onClick={onCreateRoom}
            disabled={!isConnected}
            className="
              w-full py-4 rounded-xl font-bold text-sm transition-all duration-200
              bg-green-600 hover:bg-green-500 text-white
              disabled:opacity-30 disabled:cursor-not-allowed
              shadow-lg shadow-green-900/30 hover:-translate-y-0.5
              flex items-center justify-center gap-2
            "
          >
            <span className="text-lg">＋</span>
            Create Room
          </button>

          <button
            id="btn-join-room-toggle"
            onClick={() => { setMode("join"); onClearError(); }}
            disabled={!isConnected}
            className="
              w-full py-4 rounded-xl font-bold text-sm transition-all duration-200
              bg-white/5 hover:bg-white/10 border border-white/10 text-white
              disabled:opacity-30 disabled:cursor-not-allowed
              hover:-translate-y-0.5
              flex items-center justify-center gap-2
            "
          >
            <span className="text-lg">🔗</span>
            Join Room
          </button>

          {/* Solo play link */}
          <div className="text-center mt-2">
            <a
              href="/game"
              className="text-white/20 hover:text-white/40 text-xs transition-colors underline underline-offset-2"
            >
              Practice solo (no server needed)
            </a>
          </div>
        </div>
      )}

      {/* Join Room Form */}
      {mode === "join" && (
        <form
          onSubmit={handleJoin}
          className="flex flex-col gap-3 w-72 animate-fade-in"
        >
          <div className="text-white/50 text-sm text-center">
            Enter the 6-character room code
          </div>

          <input
            id="input-room-code"
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="ABC123"
            autoFocus
            className="
              w-full px-4 py-3 rounded-xl text-center
              bg-white/5 border border-white/10
              text-white placeholder-white/20 font-mono text-xl tracking-widest uppercase
              focus:outline-none focus:border-green-500/60
              transition-all duration-200
            "
          />

          <button
            id="btn-join-room-submit"
            type="submit"
            disabled={joinCode.trim().length !== 6 || !isConnected}
            className="
              w-full py-3 rounded-xl font-bold text-sm transition-all duration-200
              bg-green-600 hover:bg-green-500 text-white
              disabled:opacity-30 disabled:cursor-not-allowed
              hover:-translate-y-0.5
            "
          >
            Join →
          </button>

          <button
            type="button"
            onClick={() => { setMode("menu"); setJoinCode(""); onClearError(); }}
            className="text-white/30 hover:text-white/50 text-xs transition-colors"
          >
            ← Back
          </button>
        </form>
      )}
    </div>
  );
}
