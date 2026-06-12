import { BallData } from "@/lib/physics/balls";

export type FoulReason =
  | "scratch"           // cue ball pocketed
  | "wrong_ball"        // cue ball hit wrong ball first
  | "no_ball_hit"       // cue ball didn't hit any ball
  | "no_rail_contact"   // no ball touched a cushion after hit (competitive rule)
  | null;

export interface TurnResult {
  foul: FoulReason;
  ballsPocketed: number[];   // ball numbers pocketed this turn
  won: boolean;              // true if ball 9 was legally pocketed
  switchTurn: boolean;       // whether to switch active player
}

export interface GameState {
  balls: BallData[];
  activeBalls: BallData[];   // balls still on table
  cueBallPocketed: boolean;
  firstHitBall: number | null; // ball number first hit by cue ball this turn
  pocketedThisTurn: number[];
  railContactMade: boolean;
  isRunning: boolean;        // physics still simulating
}

/**
 * Returns the lowest-numbered ball still on the table.
 * This is the "legal hit" target — cue ball must hit this first.
 */
export function getLowestBall(balls: BallData[]): number | null {
  const active = balls.filter((b) => b.number > 0 && !b.isPocketed);
  if (active.length === 0) return null;
  return Math.min(...active.map((b) => b.number));
}

/**
 * Evaluates the result of a completed turn.
 */
export function evaluateTurn(state: GameState): TurnResult {
  const { cueBallPocketed, firstHitBall, pocketedThisTurn, balls, railContactMade } =
    state;

  const activeBalls = balls.filter((b) => b.number > 0 && !b.isPocketed);
  const lowestBefore = Math.min(
    ...balls
      .filter((b) => b.number > 0 && !pocketedThisTurn.includes(b.number))
      .map((b) => b.number)
  );

  // --- Foul checks ---

  // 1. Scratch: cue ball was pocketed
  if (cueBallPocketed) {
    return {
      foul: "scratch",
      ballsPocketed: pocketedThisTurn,
      won: false,
      switchTurn: true,
    };
  }

  // 2. Wrong ball: cue ball didn't hit the lowest ball first
  if (firstHitBall !== null && firstHitBall !== lowestBefore) {
    return {
      foul: "wrong_ball",
      ballsPocketed: pocketedThisTurn,
      won: false,
      switchTurn: true,
    };
  }

  // 3. No legal hit at all
  if (firstHitBall === null) {
    return {
      foul: "no_ball_hit",
      ballsPocketed: pocketedThisTurn,
      won: false,
      switchTurn: true,
    };
  }

  // 4. No rail contact after hit (competitive rule)
  if (!railContactMade) {
    return {
      foul: "no_rail_contact",
      ballsPocketed: pocketedThisTurn,
      won: false,
      switchTurn: true,
    };
  }

  // --- Win condition ---
  // Ball 9 was legally pocketed (legal hit = lowest ball was hit first)
  if (pocketedThisTurn.includes(9)) {
    return {
      foul: null,
      ballsPocketed: pocketedThisTurn,
      won: true,
      switchTurn: false,
    };
  }

  // --- Normal turn result ---
  // If at least one ball was pocketed legally, player keeps the turn
  const keepTurn = pocketedThisTurn.length > 0;
  return {
    foul: null,
    ballsPocketed: pocketedThisTurn,
    won: false,
    switchTurn: !keepTurn,
  };
}

/**
 * Resets game state fields for a new turn.
 */
export function resetTurnState(
  state: GameState
): Pick<GameState, "cueBallPocketed" | "firstHitBall" | "pocketedThisTurn" | "railContactMade"> {
  return {
    cueBallPocketed: false,
    firstHitBall: null,
    pocketedThisTurn: [],
    railContactMade: false,
  };
}

/**
 * Returns a human-readable foul message.
 */
export function getFoulMessage(foul: FoulReason): string {
  switch (foul) {
    case "scratch":
      return "Scratch! Cue ball pocketed. Ball in hand!";
    case "wrong_ball":
      return "Foul! Wrong ball hit. Ball in hand!";
    case "no_ball_hit":
      return "Foul! No ball was hit. Ball in hand!";
    case "no_rail_contact":
      return "Foul! No rail contact after hit. Ball in hand!";
    default:
      return "";
  }
}
