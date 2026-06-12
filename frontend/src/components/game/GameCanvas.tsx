"use client";

import { useEffect } from "react";
import { useGameEngine, TABLE_CONFIG, UseGameEngineReturn } from "@/hooks/useGameEngine";
import { useSocket } from "@/hooks/useSocket";

const CANVAS_WIDTH = TABLE_CONFIG.x * 2 + TABLE_CONFIG.width + 60; // extra for power meter
const CANVAS_HEIGHT = TABLE_CONFIG.y * 2 + TABLE_CONFIG.height;

interface GameCanvasProps {
  engine?: UseGameEngineReturn;
  playerNames?: { p1: string; p2: string };
  isMultiplayer?: boolean;
  myPlayerIndex?: 1 | 2 | null;
  onLeave?: () => void;
}

export default function GameCanvas({
  engine,
  playerNames,
  isMultiplayer = false,
  myPlayerIndex = null,
  onLeave,
}: GameCanvasProps = {}) {
  // If engine prop is provided, use it. Otherwise, initialize local engine (for solo play)
  const localEngine = useGameEngine();
  const activeEngine = engine || localEngine;

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
  } = activeEngine;

  const { declarePushOut, resolvePushOut } = useSocket();

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

  const isMyTurn = !isMultiplayer || gameState.currentPlayer === myPlayerIndex;

  return (
    <div className="flex flex-col items-center gap-4 w-full select-none">
      {/* HUD Bar */}
      <div className="flex items-center justify-between w-full max-w-[840px] px-2 animate-fade-in">
        {/* Player 1 */}
        <PlayerBadge
          player={1}
          isActive={gameState.currentPlayer === 1}
          score={gameState.scores.p1}
          name={playerNames?.p1 ? `${playerNames.p1}${myPlayerIndex === 1 ? " (You)" : ""}` : undefined}
          consecutiveFouls={gameState.consecutiveFouls?.[1]}
        />

        {/* Center Info */}
        <div className="flex flex-col items-center gap-1">
          {gameState.winner ? (
            <div className="text-yellow-400 font-bold text-lg animate-pulse">
              🏆 {gameState.winner} Wins!
            </div>
          ) : (
            <>
              <div className="text-white/60 text-xs uppercase tracking-widest flex flex-col items-center gap-0.5">
                <span>
                  {gameState.isSimulating ? (
                    isMultiplayer ? "Syncing positions..." : "Simulating..."
                  ) : (
                    `${gameState.currentPlayer === 1 ? (playerNames?.p1 || "Player 1") : (playerNames?.p2 || "Player 2")}'s Turn`
                  )}
                </span>
                {isMultiplayer && gameState.isPushOutActive && (
                  <span className="px-1.5 py-0.5 bg-cyan-500/20 border border-cyan-500/30 rounded text-cyan-400 text-[9px] uppercase font-bold tracking-wider animate-pulse mt-0.5">
                    Push Out Active
                  </span>
                )}
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
          name={playerNames?.p2 ? `${playerNames.p2}${myPlayerIndex === 2 ? " (You)" : ""}` : undefined}
          consecutiveFouls={gameState.consecutiveFouls?.[2]}
        />
      </div>

      {/* Foul / Ball In Hand / 2-Foul Warnings */}
      <div className="flex flex-col gap-2 w-full items-center max-w-[840px]">
        {gameState.foulMessage && (
          <div className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm font-medium animate-fade-in w-full text-center">
            ⚠️ {gameState.foulMessage}
            {gameState.ballInHand && (
              <span className="ml-2 text-yellow-400">
                {isMultiplayer && gameState.currentPlayer !== myPlayerIndex
                  ? "Opponent is placing the ball."
                  : "Click table to place cue ball."}
              </span>
            )}
          </div>
        )}

        {isMultiplayer && !gameState.isSimulating && !gameState.winner && isMyTurn && (
          (() => {
            const myFouls = gameState.consecutiveFouls?.[myPlayerIndex || 1] || 0;
            if (myFouls === 2) {
              return (
                <div className="px-4 py-2 bg-red-600/20 border border-red-500/40 rounded-lg text-red-400 text-xs font-bold animate-pulse w-full text-center">
                  ⚠️ Warning: You have 2 consecutive fouls. A 3rd consecutive foul will forfeit the match!
                </div>
              );
            }
            return null;
          })()
        )}
      </div>

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/10 animate-fade-in">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block"
          style={{
            cursor: gameState.ballInHand && (!isMultiplayer || gameState.currentPlayer === myPlayerIndex)
              ? "crosshair"
              : gameState.isSimulating
              ? "not-allowed"
              : isMultiplayer && gameState.currentPlayer !== myPlayerIndex
              ? "not-allowed"
              : "none",
          }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleCanvasClick}
        />

        {/* Ball-in-hand overlay */}
        {gameState.ballInHand && (!isMultiplayer || gameState.currentPlayer === myPlayerIndex) && (
          <div className="absolute inset-0 pointer-events-none border-2 border-yellow-400/40 rounded-xl animate-pulse" />
        )}
      </div>

      {/* Pocketed Balls Tray */}
      <div className="flex items-center gap-3 flex-wrap justify-center max-w-[840px] animate-fade-in">
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
      <div className="flex items-center justify-between w-full max-w-[840px] mt-1 px-2 animate-fade-in gap-4">
        <div className="text-white/30 text-xs max-w-[50%] leading-relaxed">
          {gameState.isSimulating
            ? isMultiplayer ? "Waiting for sync consensus..." : "Waiting for balls to stop..."
            : gameState.ballInHand
            ? isMultiplayer && gameState.currentPlayer !== myPlayerIndex
              ? `${gameState.currentPlayer === 1 ? (playerNames?.p1 || "Player 1") : (playerNames?.p2 || "Player 2")} is placing cue ball...`
              : "Click on table to place cue ball"
            : isMultiplayer && gameState.currentPlayer !== myPlayerIndex
            ? `Waiting for ${gameState.currentPlayer === 1 ? (playerNames?.p1 || "Player 1") : (playerNames?.p2 || "Player 2")} to shoot...`
            : "Drag mouse to aim, scroll wheel to adjust power • Click Shoot or Space to fire"}
        </div>
        
        <div className="flex items-center gap-3">
          {/* Declare Push Out button */}
          {isMultiplayer && isMyTurn && gameState.pushOutAvailable && !gameState.isPushOutActive && !gameState.isSimulating && !gameState.winner && (
            <button
              onClick={declarePushOut}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-xs shadow-lg shadow-cyan-600/20 active:scale-95 duration-100 transition-all font-semibold"
            >
              🎯 Declare Push Out
            </button>
          )}

          {/* Shoot Button */}
          {isMyTurn && !gameState.isSimulating && !gameState.winner && !gameState.ballInHand && (
            <button
              onClick={handleShoot}
              className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-bold rounded-lg text-sm shadow-lg shadow-yellow-500/20 active:scale-95 duration-100 transition-all"
            >
              ⚡ Shoot
            </button>
          )}

          {!isMultiplayer && (
            <button
              onClick={resetGame}
              className="px-4 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white/60 text-xs transition-colors"
            >
              ↺ Reset
            </button>
          )}
          
          {isMultiplayer && onLeave && (
            <button
              onClick={onLeave}
              className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-xs font-semibold transition-colors"
            >
              ← Leave Game
            </button>
          )}
        </div>
      </div>

      {/* Push Out Resolve Modal */}
      {isMultiplayer && isMyTurn && gameState.pushOutResolvePending && !gameState.winner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-6 p-8 rounded-2xl border border-cyan-500/30 bg-slate-900 shadow-2xl shadow-cyan-500/10 text-center max-w-sm mx-4">
            <div className="text-5xl">🎯</div>
            <div className="flex flex-col gap-2">
              <div className="text-cyan-400 text-2xl font-bold">Resolve Push Out</div>
              <p className="text-white/60 text-xs leading-relaxed">
                Your opponent declared a Push Out. You can accept the current position and play the shot, or pass the turn back to them.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full">
              <button
                onClick={() => resolvePushOut(true)}
                className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl transition-all active:scale-95 duration-100 text-sm font-semibold"
              >
                Accept & Play
              </button>
              <button
                onClick={() => resolvePushOut(false)}
                className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold rounded-xl transition-all active:scale-95 duration-100 text-sm font-semibold"
              >
                Pass Turn Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Win Modal */}
      {gameState.winner && (
        <WinModal
          winner={gameState.winner}
          onReset={resetGame}
          isMultiplayer={isMultiplayer}
          onLeave={onLeave}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PlayerBadge({
  player,
  isActive,
  score,
  name,
  consecutiveFouls = 0,
}: {
  player: 1 | 2;
  isActive: boolean;
  score: number;
  name?: string;
  consecutiveFouls?: number;
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
        {name || `Player ${player}`}
      </div>
      <div className="text-white/30 text-xs">Score: {score}</div>
      {consecutiveFouls > 0 && (
        <div className={`text-[10px] font-semibold mt-1.5 px-1.5 py-0.5 rounded ${
          consecutiveFouls >= 2
            ? "bg-red-500/25 text-red-400 border border-red-500/30 animate-pulse"
            : "bg-white/10 text-white/50 border border-white/5"
        }`}>
          {consecutiveFouls} {consecutiveFouls === 1 ? "Foul" : "Fouls"}
        </div>
      )}
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
  isMultiplayer,
  onLeave,
}: {
  winner: string;
  onReset: () => void;
  isMultiplayer: boolean;
  onLeave?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-col items-center gap-6 p-10 rounded-2xl border border-yellow-400/30 bg-slate-900/90 shadow-2xl shadow-yellow-400/10 text-center">
        <div className="text-6xl">🏆</div>
        <div>
          <div className="text-yellow-400 text-3xl font-bold mb-1">{winner} Wins!</div>
          <div className="text-white/50 text-sm">Ball 9 legally pocketed!</div>
        </div>
        {isMultiplayer && onLeave ? (
          <button
            onClick={onLeave}
            className="px-8 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-colors text-sm font-semibold"
          >
            Back to Lobby
          </button>
        ) : (
          <button
            onClick={onReset}
            className="px-8 py-3 bg-yellow-400 hover:bg-yellow-300 text-black font-bold rounded-xl transition-colors text-sm"
          >
            Play Again
          </button>
        )}
      </div>
    </div>
  );
}
