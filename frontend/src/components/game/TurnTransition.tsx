"use client";

import { useEffect, useState } from "react";

interface TurnTransitionProps {
  currentPlayer: 1 | 2;
  myPlayerIndex: 1 | 2 | null;
  isMultiplayer: boolean;
  foulMessage: string;
  turnNumber: number;
  playerNames?: { p1: string; p2: string };
}

export default function TurnTransition({
  currentPlayer,
  myPlayerIndex,
  isMultiplayer,
  foulMessage,
  turnNumber,
  playerNames,
}: TurnTransitionProps) {
  const [visible, setVisible] = useState(false);
  const [bannerText, setBannerText] = useState("");
  const [subText, setSubText] = useState("");
  const [styleClass, setStyleClass] = useState("");

  useEffect(() => {
    let mainText = "";
    let sub = "";
    let style = "";

    const isMyTurn = !isMultiplayer || currentPlayer === myPlayerIndex;
    const nameP1 = playerNames?.p1 || "Player 1";
    const nameP2 = playerNames?.p2 || "Player 2";
    const activeName = currentPlayer === 1 ? nameP1 : nameP2;

    if (turnNumber === 1) {
      mainText = "GAME START";
      sub = isMultiplayer
        ? (isMyTurn ? "You break first!" : `${activeName} breaks first!`)
        : "Let's Rack 'Em!";
      style = "from-yellow-500/90 to-amber-600/90 text-yellow-100 border-yellow-400/30";
    } else if (foulMessage) {
      mainText = "FOUL!";
      sub = foulMessage;
      style = "from-red-600/90 to-rose-700/90 text-red-500 border-red-500/30";
    } else {
      mainText = isMultiplayer
        ? (isMyTurn ? "YOUR TURN" : "OPPONENT'S TURN")
        : `${activeName}'s Turn`;
      sub = isMultiplayer
        ? (isMyTurn ? "Take your best shot!" : `Waiting for ${activeName}...`)
        : "Make it count!";
      style = isMyTurn
        ? "from-emerald-600/90 to-teal-700/90 text-emerald-100 border-emerald-500/30"
        : "from-slate-800/90 to-slate-900/90 text-slate-300 border-slate-700/30";
    }

    setBannerText(mainText);
    setSubText(sub);
    setStyleClass(style);
    setVisible(true);

    const timer = setTimeout(() => {
      setVisible(false);
    }, 1500); // Overlay displays for 1.5s total

    return () => clearTimeout(timer);
  }, [currentPlayer, foulMessage, turnNumber, myPlayerIndex, isMultiplayer, playerNames]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none bg-black/10 backdrop-blur-[0.5px] animate-fade-out-delayed">
      <div className={`flex flex-col items-center justify-center py-6 px-12 rounded-2xl bg-gradient-to-r ${styleClass} border shadow-2xl animate-zoom-in-bounce text-center max-w-[90%]`}>
        <h1 className="text-4xl md:text-5xl font-black uppercase tracking-[0.2em] drop-shadow-md select-none">
          {bannerText}
        </h1>
        {subText && (
          <p className="text-sm md:text-base opacity-90 mt-2 font-medium tracking-wide drop-shadow select-none">
            {subText}
          </p>
        )}
      </div>
    </div>
  );
}
