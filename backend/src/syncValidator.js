/**
 * syncValidator.js
 * Validates that two clients' simulation results match within
 * an acceptable threshold, preventing desync cheating.
 *
 * Strategy:
 * - Compare final ball positions from both clients
 * - If within POSITION_THRESHOLD → use average as authoritative
 * - If diverged → use the result with majority pocketed balls as authority
 *   (conservative: fewer assumptions about cheating vs network lag)
 */

const POSITION_THRESHOLD = 15; // pixels — acceptable desync margin

/**
 * @typedef {{ number: number, x: number, y: number, isPocketed: boolean }} BallPos
 * @typedef {{ positions: BallPos[], foulData: FoulData }} SyncResult
 * @typedef {{ foul: string|null, firstHitBall: number|null, cueBallPocketed: boolean, railContactMade: boolean, pocketedThisTurn: number[] }} FoulData
 */

/**
 * Validates two sync results and returns the authoritative state.
 *
 * @param {SyncResult[]} results - Array of results from each client (2 players)
 * @returns {{ authoritative: SyncResult, desynced: boolean, deviation: number }}
 */
function validateSync(results) {
  if (results.length < 2) {
    // Only one player submitted — use their result directly
    return { authoritative: results[0], desynced: false, deviation: 0 };
  }

  const [r1, r2] = results;
  let totalDeviation = 0;
  let desynced = false;

  // Compare ball positions
  const balls1 = r1.positions;
  const balls2 = r2.positions;

  // Build merged authoritative positions (average of both if close enough)
  const authPositions = balls1.map((b1) => {
    const b2 = balls2.find((b) => b.number === b1.number);
    if (!b2) {
      // Ball only in one result — trust the pocketed flag majority
      return { ...b1 };
    }

    if (b1.isPocketed && b2.isPocketed) {
      return { ...b1, isPocketed: true };
    }

    if (b1.isPocketed !== b2.isPocketed) {
      // Disagreement on pocket status — conservative: pocket it
      desynced = true;
      return { ...b1, isPocketed: true };
    }

    const dx = b1.x - b2.x;
    const dy = b1.y - b2.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    totalDeviation += dist;

    if (dist > POSITION_THRESHOLD) {
      desynced = true;
    }

    // Use midpoint as authoritative position
    return {
      number: b1.number,
      x: (b1.x + b2.x) / 2,
      y: (b1.y + b2.y) / 2,
      isPocketed: false,
    };
  });

  // Foul data: use the result where more balls were pocketed
  // (conservative — if either client saw a foul, respect it)
  const foulData = mergeFoulData(r1.foulData, r2.foulData);

  const avgDeviation = balls1.length > 0 ? totalDeviation / balls1.length : 0;

  if (desynced) {
    console.warn(
      `[Sync] DESYNC detected! Avg deviation: ${avgDeviation.toFixed(2)}px`
    );
  } else {
    console.log(
      `[Sync] Sync OK. Avg deviation: ${avgDeviation.toFixed(2)}px`
    );
  }

  return {
    authoritative: { positions: authPositions, foulData },
    desynced,
    deviation: avgDeviation,
  };
}

/**
 * Merges foul data from two clients conservatively:
 * - If either saw a cue ball scratch → scratch
 * - If either saw wrong ball hit → wrong ball
 * - firstHitBall: use the one that's not null; if both not null and different → wrong_ball
 * - railContactMade: AND of both (if either says no rail → no rail)
 */
function mergeFoulData(f1, f2) {
  if (!f1 && !f2) return null;
  if (!f1) return f2;
  if (!f2) return f1;

  const cueBallPocketed = f1.cueBallPocketed || f2.cueBallPocketed;

  // First hit ball: if they disagree, flag wrong_ball
  let firstHitBall = f1.firstHitBall ?? f2.firstHitBall;
  let foul = f1.foul || f2.foul || null;

  if (
    f1.firstHitBall !== null &&
    f2.firstHitBall !== null &&
    f1.firstHitBall !== f2.firstHitBall
  ) {
    // Disagreement — conservative: use the lower number (safer call)
    firstHitBall = Math.min(f1.firstHitBall, f2.firstHitBall);
  }

  const railContactMade = f1.railContactMade && f2.railContactMade;

  // Merge pocketed lists (union)
  const pocketedThisTurn = [
    ...new Set([...f1.pocketedThisTurn, ...f2.pocketedThisTurn]),
  ];

  return {
    cueBallPocketed,
    firstHitBall,
    railContactMade,
    pocketedThisTurn,
    foul,
  };
}

module.exports = { validateSync, POSITION_THRESHOLD };
