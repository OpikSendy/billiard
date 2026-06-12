import type { Metadata } from "next";
import GameCanvas from "@/components/game/GameCanvas";

export const metadata: Metadata = {
  title: "9-Ball Pool | Play",
  description: "Play 2D 9-Ball Pool in your browser. Real-time physics, no install required.",
};

export default function GamePage() {
  return (
    <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 gap-6">
      <h1 className="text-white/20 text-xs uppercase tracking-[0.3em] mt-2">
        9-Ball Pool
      </h1>
      <GameCanvas />
    </main>
  );
}
