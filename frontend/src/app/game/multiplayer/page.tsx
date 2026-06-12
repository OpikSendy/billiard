"use client";

// Multiplayer game page — wires useSocket + useGameEngine together
// Phase 4 will complete the full sync; this page scaffolds the layout
// and shows a "coming in Phase 4" notice for now.

import { Suspense } from "react";
import Link from "next/link";

export default function MultiplayerGamePage() {
  return (
    <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 gap-8">
      {/* Temporary Phase 3 placeholder — Phase 4 will wire the actual game */}
      <div className="flex flex-col items-center gap-6 text-center max-w-sm animate-fade-in">
        <div className="text-6xl">🎱</div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-white">Multiplayer Game</h1>
          <p className="text-white/40 text-sm">
            You&apos;re connected! Full game sync coming in Phase 4.
          </p>
        </div>

        <div className="w-full px-5 py-4 bg-yellow-400/10 border border-yellow-400/30 rounded-xl text-yellow-400 text-sm text-left">
          <p className="font-bold mb-2">🚧 Phase 3 Complete</p>
          <ul className="list-disc list-inside space-y-1 text-yellow-400/70 text-xs">
            <li>Socket.io connection ✓</li>
            <li>Room create / join ✓</li>
            <li>Waiting room with ready state ✓</li>
            <li>Game start trigger ✓</li>
            <li>Shot broadcast — Phase 4</li>
            <li>Turn sync & validation — Phase 4</li>
          </ul>
        </div>

        <div className="flex gap-3 w-full">
          <Link
            href="/lobby"
            className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white/50 text-sm font-semibold text-center hover:bg-white/10 transition-colors"
          >
            ← Back to Lobby
          </Link>
          <Link
            href="/game"
            className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold text-center transition-colors"
          >
            Solo Practice
          </Link>
        </div>
      </div>
    </main>
  );
}
