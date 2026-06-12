"use client";

import { useState } from "react";

interface Props {
  onConfirm: (nickname: string) => void;
}

export default function NicknameScreen({ onConfirm }: Props) {
  const [nickname, setNickname] = useState("");
  const [shake, setShake] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed || trimmed.length < 2) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <div className="flex flex-col items-center gap-8 animate-fade-in">
      {/* Icon */}
      <div className="text-7xl animate-float select-none">🎱</div>

      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-4xl font-bold text-white tracking-tight">9-Ball Pool</h1>
        <p className="text-white/40 text-sm">Enter your nickname to start</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className={`flex flex-col gap-3 w-72 ${shake ? "animate-shake" : ""}`}
      >
        <div className="relative">
          <input
            id="input-nickname"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Your nickname..."
            maxLength={20}
            autoFocus
            className="
              w-full px-4 py-3 rounded-xl
              bg-white/5 border border-white/10
              text-white placeholder-white/20
              focus:outline-none focus:border-green-500/60 focus:bg-white/8
              transition-all duration-200 text-sm
            "
          />
          {nickname.length > 0 && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 text-xs">
              {nickname.length}/20
            </span>
          )}
        </div>

        <button
          id="btn-confirm-nickname"
          type="submit"
          disabled={nickname.trim().length < 2}
          className="
            w-full py-3 rounded-xl font-bold text-sm transition-all duration-200
            bg-green-600 hover:bg-green-500 text-white
            disabled:opacity-30 disabled:cursor-not-allowed
            shadow-lg shadow-green-900/30 hover:shadow-green-700/30
            hover:-translate-y-0.5 disabled:hover:translate-y-0
          "
        >
          Continue →
        </button>
      </form>

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-6px); }
          40%, 80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}
