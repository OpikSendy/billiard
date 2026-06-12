"use client";

import { useEffect } from "react";
import { useGameEngine, TABLE_CONFIG } from "@/hooks/useGameEngine";

const CANVAS_WIDTH = TABLE_CONFIG.x * 2 + TABLE_CONFIG.width + 60; // extra for power meter
const CANVAS_HEIGHT = TABLE_CONFIG.y * 2 + TABLE_CONFIG.height;

export default function GameCanvas() {
  const {
    canvasRef,
    aimState,
    gameState,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleCanvasClick,
    handleShoot,
    resetGame,
  } = useGameEngine();

  // Keyboard shoot (Spacebar)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handleShoot();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleShoot]);

  return (
    <div className="flex flex-col items-center gap-4 w-full select-none">
      {/* HUD Bar */}
      <div className="flex items-center justify-between w-full max-w-[840px] px-2">
        {/* Player 1 */}
        <PlayerBadge
          player={1}
          isActive={gameState.currentPlayer === 1}
          score={gameState.scores.p1}
        />

        {/* Center Info */}
        <div className="flex flex-col items-center gap-1">
          {gameState.winner ? (
            <div className="text-yellow-400 font-bold text-lg animate-pulse">
              🏆 {gameState.winner} Wins!
            </div>
          ) : (
            <>
              <div className="text-white/60 text-xs uppercase tracking-widest">
                {gameState.isSimulating ? "Simulating..." : `Player ${gameState.currentPlayer}'s Turn`}
              </div>
              {gameState.lowestBall && !gameState.isSimulating && (
                <div className="text-white/40 text-xs">
                  Must hit: <span className="text-yellow-400 font-bold">Ball {gameState.lowestBall}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Player 2 */}
        <PlayerBadge
          player={2}
          isActive={gameState.currentPlayer === 2}
          score={gameState.scores.p2}
        />
      </div>

      {/* Foul / Ball In Hand Banner */}
      {gameState.foulMessage && (
        <div className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm font-medium animate-fade-in">
          ⚠️ {gameState.foulMessage}
          {gameState.ballInHand && (
            <span className="ml-2 text-yellow-400">Click table to place cue ball.</span>
          )}
        </div>
      )}

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/10">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block"
          style={{
            cursor: gameState.ballInHand
              ? "crosshair"
              : gameState.isSimulating
              ? "not-allowed"
              : "none",
          }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleCanvasClick}
        />

        {/* Ball-in-hand overlay */}
        {gameState.ballInHand && (
          <div className="absolute inset-0 pointer-events-none border-2 border-yellow-400/40 rounded-xl animate-pulse" />
        )}
      </div>

      {/* Pocketed Balls Tray */}
      <div className="flex items-center gap-3 flex-wrap justify-center max-w-[840px]">
        <span className="text-white/30 text-xs uppercase tracking-widest">Pocketed:</span>
        {gameState.pocketedBalls.length === 0 ? (
          <span className="text-white/20 text-xs">—</span>
        ) : (
          [...gameState.pocketedBalls].sort((a, b) => a - b).map((n) => (
            <BallChip key={n} number={n} />
          ))
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 mt-1">
        <div className="text-white/30 text-xs">
          {gameState.isSimulating
            ? "Waiting for balls to stop..."
            : gameState.ballInHand
            ? "Click on table to place cue ball"
            : "Drag mouse to aim & set power • Space / Release to shoot"}
        </div>
        <button
          onClick={resetGame}
          className="px-4 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 text-xs transition-colors"
        >
          ↺ Reset
        </button>
      </div>

      {/* Win Modal */}
      {gameState.winner && (
        <WinModal winner={gameState.winner} onReset={resetGame} />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PlayerBadge({
  player,
  isActive,
  score,
}: {
  player: 1 | 2;
  isActive: boolean;
  score: number;
}) {
  return (
    <div
      className={`flex flex-col items-center px-4 py-2 rounded-xl border transition-all duration-300 ${
        isActive
          ? "border-yellow-400/60 bg-yellow-400/10 shadow-lg shadow-yellow-400/10"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className={`text-sm font-bold ${isActive ? "text-yellow-400" : "text-white/50"}`}>
        {isActive && <span className="mr-1">▶</span>}
        Player {player}
      </div>
      <div className="text-white/30 text-xs">Score: {score}</div>
    </div>
  );
}

function BallChip({ number }: { number: number }) {
  const colors: Record<number, string> = {
    1: "bg-yellow-400 text-black",
    2: "bg-blue-600 text-white",
    3: "bg-red-500 text-white",
    4: "bg-purple-600 text-white",
    5: "bg-orange-500 text-white",
    6: "bg-green-600 text-white",
    7: "bg-amber-900 text-white",
    8: "bg-gray-900 text-white border border-white/20",
    9: "bg-yellow-400 text-black ring-2 ring-white",
  };
  return (
    <div
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow ${
        colors[number] ?? "bg-gray-500 text-white"
      }`}
    >
      {number}
    </div>
  );
}

function WinModal({
  winner,
  onReset,
}: {
  winner: string;
  onReset: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-col items-center gap-6 p-10 rounded-2xl border border-yellow-400/30 bg-slate-900/90 shadow-2xl shadow-yellow-400/10 text-center">
        <div className="text-6xl">🏆</div>
        <div>
          <div className="text-yellow-400 text-3xl font-bold mb-1">{winner} Wins!</div>
          <div className="text-white/50 text-sm">Ball 9 legally pocketed!</div>
        </div>
        <button
          onClick={onReset}
          className="px-8 py-3 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl transition-colors text-sm"
        >
          Play Again
        </button>
      </div>
    </div>
  );
}
