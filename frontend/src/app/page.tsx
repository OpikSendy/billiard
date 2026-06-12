import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "9-Ball Pool | Home",
  description: "Play multiplayer 9-ball pool in your browser. No install required.",
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-8 gap-12 relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-green-900/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/4 right-1/4 w-[300px] h-[300px] bg-yellow-900/10 rounded-full blur-[80px]" />
      </div>

      {/* Hero */}
      <div className="flex flex-col items-center gap-5 text-center relative z-10">
        {/* Logo / Icon */}
        <div className="text-7xl animate-float select-none">🎱</div>

        <div className="flex flex-col gap-2">
          <h1 className="text-5xl font-bold text-white tracking-tight">
            9-Ball Pool
          </h1>
          <p className="text-white/40 text-base max-w-sm">
            Real-time multiplayer billiards in your browser. No install. Just play.
          </p>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 mt-4">
          <Link
            href="/game"
            id="btn-play-solo"
            className="px-8 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition-all duration-200 shadow-lg shadow-green-900/40 hover:shadow-green-700/40 hover:-translate-y-0.5 text-sm"
          >
            ▶ Play Solo (Phase 1)
          </Link>

          <Link
            href="/lobby"
            id="btn-multiplayer"
            className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all duration-200 shadow-lg shadow-blue-900/40 hover:shadow-blue-700/40 hover:-translate-y-0.5 text-sm"
          >
            🌐 Multiplayer
          </Link>
        </div>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full relative z-10">
        {[
          { icon: "⚡", title: "Real Physics", desc: "Matter.js 2D engine with accurate ball collisions, friction & cushion bounce" },
          { icon: "🎯", title: "9-Ball Rules", desc: "Legal hit detection, foul system, and win condition — fully implemented" },
          { icon: "🌐", title: "Multiplayer", desc: "Real-time sync via Socket.io — coming in Phase 3" },
        ].map((f) => (
          <div
            key={f.title}
            className="flex flex-col gap-2 p-5 rounded-xl bg-white/5 border border-white/8 hover:border-white/15 transition-colors"
          >
            <div className="text-2xl">{f.icon}</div>
            <div className="text-white font-semibold text-sm">{f.title}</div>
            <div className="text-white/40 text-xs leading-relaxed">{f.desc}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p className="text-white/20 text-xs relative z-10">
        Phase 1 — Local Physics Prototype
      </p>
    </main>
  );
}
