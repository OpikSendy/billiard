"use client";

import { useState } from "react";
import type { RoomInfo } from "@/hooks/useSocket";

interface Props {
  room: RoomInfo;
  myPlayerIndex: 1 | 2 | null;
  onReady: (isReady: boolean) => void;
  onLeave: () => void;
}

export default function WaitingRoom({ room, myPlayerIndex, onReady, onLeave }: Props) {
  const [isReady, setIsReady] = useState(false);

  const myPlayer = room.players.find((p) => p.playerIndex === myPlayerIndex);
  const opponent = room.players.find((p) => p.playerIndex !== myPlayerIndex);
  const allReady = room.players.length === 2 && room.players.every((p) => p.isReady);

  const handleReadyToggle = () => {
    const next = !isReady;
    setIsReady(next);
    onReady(next);
  };

  return (
    <div className="flex flex-col items-center gap-8 animate-fade-in w-full max-w-sm">
      {/* Header */}
      <div className="flex flex-col items-center gap-1">
        <div className="text-4xl">🎱</div>
        <h2 className="text-2xl font-bold text-white">Waiting Room</h2>
      </div>

      {/* Room Code */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-white/30 text-xs uppercase tracking-widest">Room Code</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-3xl font-bold text-yellow-400 tracking-widest">
            {room.id}
          </span>
          <button
            id="btn-copy-room-code"
            onClick={() => navigator.clipboard.writeText(room.id)}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-white/70 text-xs transition-colors"
          >
            Copy
          </button>
        </div>
        <p className="text-white/25 text-xs">Share this code with your opponent</p>
      </div>

      {/* Players */}
      <div className="w-full flex flex-col gap-3">
        {/* Player 1 slot */}
        <PlayerSlot
          player={room.players.find((p) => p.playerIndex === 1) ?? null}
          isMe={myPlayerIndex === 1}
          slotIndex={1}
        />

        {/* VS divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-white/20 text-xs font-bold">VS</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Player 2 slot */}
        <PlayerSlot
          player={room.players.find((p) => p.playerIndex === 2) ?? null}
          isMe={myPlayerIndex === 2}
          slotIndex={2}
        />
      </div>

      {/* All Ready Banner */}
      {allReady && (
        <div className="w-full px-4 py-3 bg-green-500/15 border border-green-500/40 rounded-xl text-green-400 text-sm font-semibold text-center animate-pulse">
          🚀 Both players ready! Starting game...
        </div>
      )}

      {/* Ready Button */}
      {!allReady && (
        <div className="flex flex-col gap-2 w-full">
          <button
            id="btn-ready-toggle"
            onClick={handleReadyToggle}
            className={`
              w-full py-3 rounded-xl font-bold text-sm transition-all duration-200
              ${isReady
                ? "bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10"
                : "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/30"
              }
              hover:-translate-y-0.5
            `}
          >
            {isReady ? "✓ Ready (click to cancel)" : "I'm Ready!"}
          </button>

          <button
            id="btn-leave-room"
            onClick={onLeave}
            className="w-full py-2 rounded-xl text-white/20 hover:text-white/50 text-xs transition-colors"
          >
            Leave Room
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Player Slot ─────────────────────────────────────────────────────────────

function PlayerSlot({
  player,
  isMe,
  slotIndex,
}: {
  player: { nickname: string; isReady: boolean } | null;
  isMe: boolean;
  slotIndex: 1 | 2;
}) {
  return (
    <div
      className={`
        flex items-center gap-4 px-4 py-3 rounded-xl border transition-all
        ${player
          ? player.isReady
            ? "border-green-500/40 bg-green-500/8"
            : "border-white/10 bg-white/5"
          : "border-white/5 bg-white/2 border-dashed"
        }
      `}
    >
      {/* Avatar */}
      <div
        className={`
          w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm
          ${player ? "bg-white/10 text-white" : "bg-white/5 text-white/10"}
        `}
      >
        {player ? player.nickname[0].toUpperCase() : "?"}
      </div>

      {/* Name + badge */}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`font-semibold text-sm ${player ? "text-white" : "text-white/20"}`}>
            {player ? player.nickname : "Waiting for player..."}
          </span>
          {isMe && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-400/20 text-yellow-400 font-bold">
              YOU
            </span>
          )}
        </div>
        <div className="text-xs text-white/30 mt-0.5">Player {slotIndex}</div>
      </div>

      {/* Ready status */}
      {player && (
        <div
          className={`text-xs font-semibold px-2 py-1 rounded-lg
            ${player.isReady ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/30"}
          `}
        >
          {player.isReady ? "✓ Ready" : "Not Ready"}
        </div>
      )}

      {/* Spinner for empty slot */}
      {!player && (
        <div className="w-5 h-5 border-2 border-white/10 border-t-white/30 rounded-full animate-spin" />
      )}
    </div>
  );
}
