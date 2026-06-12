/**
 * gameManager.js
 * Manages per-room game state: turn order, foul tracking,
 * shot data relay, and win condition.
 *
 * Game State per room:
 * {
 *   roomId,
 *   currentPlayerIndex: 1 | 2,
 *   pocketedBalls: number[],
 *   turnNumber: number,
 *   lastShot: { angle, power, cueBallPos } | null,
 *   pendingSyncResults: Map<socketId, BallPositions>,
 *   ballInHand: boolean,
 *   winner: string | null,
 * }
 */

/** @type {Map<string, GameState>} roomId → GameState */
const gameStates = new Map();

/**
 * Initializes a fresh game state for a room.
 * Called when both players click Ready.
 */
function initGame(roomId, players) {
  const state = {
    roomId,
    currentPlayerIndex: 1,        // Player 1 breaks first
    pocketedBalls: [],
    turnNumber: 1,
    lastShot: null,
    pendingSyncResults: new Map(), // socketId → { positions, foulData }
    ballInHand: false,
    winner: null,
    players,                       // [{ socketId, nickname, playerIndex }]
    startedAt: new Date(),
    consecutiveFouls: {
      1: 0,
      2: 0,
    },
    pushOutAvailable: false,
    isPushOutActive: false,
    pushOutResolvePending: false,
  };

  gameStates.set(roomId, state);
  console.log(`[Game] Initialized game for room ${roomId}`);
  return state;
}

/**
 * Records a shot made by the active player.
 * Returns the shot data to be broadcast to opponents.
 *
 * @param {string} roomId
 * @param {string} socketId - who shot
 * @param {{ angle: number, power: number, cueBallPos: { x, y } }} shotData
 */
function recordShot(roomId, socketId, shotData) {
  const state = gameStates.get(roomId);
  if (!state) return { success: false, error: "Game not found." };

  const shooter = state.players.find((p) => p.socketId === socketId);
  if (!shooter) return { success: false, error: "Player not in game." };

  if (shooter.playerIndex !== state.currentPlayerIndex) {
    return { success: false, error: "Not your turn." };
  }

  state.lastShot = {
    ...shotData,
    shooterIndex: shooter.playerIndex,
    timestamp: Date.now(),
  };

  // Reset pending sync results for this new turn
  state.pendingSyncResults.clear();

  console.log(
    `[Game] Room ${roomId} - Player ${shooter.playerIndex} shot: angle=${shotData.angle.toFixed(2)}, power=${shotData.power.toFixed(2)}`
  );

  return { success: true, shot: state.lastShot };
}

/**
 * Records a client's simulation result (ball positions after all balls stop).
 * When both clients have submitted, we validate and determine the next turn.
 *
 * @param {string} roomId
 * @param {string} socketId
 * @param {{ positions: BallPos[], foulData: FoulData }} result
 * @returns {{ ready: boolean, consensus?: object }}
 */
function recordSyncResult(roomId, socketId, result) {
  const state = gameStates.get(roomId);
  if (!state) return { success: false, error: "Game not found." };

  state.pendingSyncResults.set(socketId, result);

  const totalPlayers = state.players.length;
  const resultsReceived = state.pendingSyncResults.size;

  console.log(
    `[Game] Room ${roomId} - sync result ${resultsReceived}/${totalPlayers} received`
  );

  if (resultsReceived < totalPlayers) {
    return { success: true, ready: false };
  }

  // All clients submitted — build consensus
  const allResults = Array.from(state.pendingSyncResults.values());
  return { success: true, ready: true, allResults };
}

/**
 * Applies the turn result to game state.
 * Determines next active player, handles fouls, checks win.
 *
 * @param {string} roomId
 * @param {{ foul: string|null, ballsPocketed: number[], won: boolean, switchTurn: boolean, isPushOutResolve?: boolean }} turnResult
 * @param {string} winnerNickname - set if won=true
 */
function applyTurnResult(roomId, turnResult, winnerNickname = null) {
  const state = gameStates.get(roomId);
  if (!state) return null;

  const { foul, ballsPocketed, won, switchTurn, isPushOutResolve } = turnResult;

  // Reset push out active state after shot is evaluated
  state.isPushOutActive = false;

  // If push out resolve is pending, set it
  if (isPushOutResolve) {
    state.pushOutResolvePending = true;
    state.pushOutAvailable = false;
  } else {
    // Normal shot, push out no longer available
    state.pushOutAvailable = false;
  }

  // Update consecutive fouls
  if (foul) {
    state.consecutiveFouls[state.currentPlayerIndex] += 1;
    if (state.consecutiveFouls[state.currentPlayerIndex] >= 3) {
      state.winner = winnerNickname || `Player ${state.currentPlayerIndex === 1 ? 2 : 1}`;
    }
  } else {
    // Clean hit resets foul count
    state.consecutiveFouls[state.currentPlayerIndex] = 0;
  }

  // Update pocketed balls (exclude cue ball)
  ballsPocketed.forEach((n) => {
    if (n !== 0 && !state.pocketedBalls.includes(n)) {
      state.pocketedBalls.push(n);
    }
  });

  state.ballInHand = foul === "scratch" || foul === "wrong_ball";

  if (state.winner) {
    // Game is over (3 fouls or normal win)
  } else if (won) {
    state.winner = winnerNickname;
  } else if (switchTurn) {
    state.currentPlayerIndex = state.currentPlayerIndex === 1 ? 2 : 1;
  }

  state.turnNumber += 1;

  // Push out is available exactly on turn 2 (first shot after break)
  if (state.turnNumber === 2 && !state.winner) {
    state.pushOutAvailable = true;
  }

  state.pendingSyncResults.clear();

  console.log(
    `[Game] Room ${roomId} turn ${state.turnNumber}: foul=${foul}, pocketed=[${ballsPocketed}], nextPlayer=${state.currentPlayerIndex}, consecutiveFouls=${JSON.stringify(state.consecutiveFouls)}`
  );

  return state;
}

/**
 * Returns current game state for a room.
 */
function getGameState(roomId) {
  return gameStates.get(roomId) || null;
}

/**
 * Cleans up game state for a room.
 */
function destroyGame(roomId) {
  gameStates.delete(roomId);
  console.log(`[Game] Destroyed game state for room ${roomId}`);
}

/**
 * Returns a client-safe snapshot of the game state.
 */
function sanitizeGameState(state) {
  return {
    roomId: state.roomId,
    currentPlayerIndex: state.currentPlayerIndex,
    pocketedBalls: state.pocketedBalls,
    turnNumber: state.turnNumber,
    ballInHand: state.ballInHand,
    winner: state.winner,
    consecutiveFouls: state.consecutiveFouls,
    pushOutAvailable: state.pushOutAvailable,
    isPushOutActive: state.isPushOutActive,
    pushOutResolvePending: state.pushOutResolvePending,
  };
}

module.exports = {
  initGame,
  recordShot,
  recordSyncResult,
  applyTurnResult,
  getGameState,
  destroyGame,
  sanitizeGameState,
};
