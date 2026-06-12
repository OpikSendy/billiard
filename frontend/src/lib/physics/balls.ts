import Matter from "matter-js";

export const BALL_RADIUS = 11;
export const BALL_FRICTION = 0.008;       // rolling friction on table
export const BALL_RESTITUTION = 0.9;      // bounciness between balls
export const BALL_FRICTION_AIR = 0.018;   // air drag (simulates table cloth)

// 9-ball color palette
export const BALL_COLORS: Record<number, { fill: string; stripe?: string }> = {
  0:  { fill: "#FFFFFF" },                        // Cue Ball
  1:  { fill: "#F5C518" },                        // 1 - Yellow solid
  2:  { fill: "#1A56DB" },                        // 2 - Blue solid
  3:  { fill: "#E02424" },                        // 3 - Red solid
  4:  { fill: "#7E3AF2" },                        // 4 - Purple solid
  5:  { fill: "#FF7700" },                        // 5 - Orange solid
  6:  { fill: "#16A34A" },                        // 6 - Green solid
  7:  { fill: "#92400E" },                        // 7 - Maroon solid
  8:  { fill: "#1F2937" },                        // 8 - Black solid
  9:  { fill: "#F5C518", stripe: "#F5C518" },     // 9 - Yellow stripe
};

export interface BallData {
  body: Matter.Body;
  number: number; // 0 = cue ball
  isPocketed: boolean;
  isSinking?: boolean;
  currentVisualRadius?: number;
  targetPocketX?: number;
  targetPocketY?: number;
}

const ballPhysicsOptions: Matter.IBodyDefinition = {
  restitution: BALL_RESTITUTION,
  friction: BALL_FRICTION,
  frictionAir: BALL_FRICTION_AIR,
  frictionStatic: 0.01,
  density: 0.004,
  inertia: Infinity,     // prevent rotation (top-down view)
  inverseInertia: 0,
  collisionFilter: { category: 0x0001, mask: 0x0001 | 0x0002 | 0x0004 },
  label: "ball",
};

/**
 * Creates a single ball body at (x, y) with the given ball number.
 */
export function createBall(x: number, y: number, number: number): BallData {
  const body = Matter.Bodies.circle(x, y, BALL_RADIUS, {
    ...ballPhysicsOptions,
    label: `target-ball-${number}`,
  });

  return { body, number, isPocketed: false };
}

/**
 * Creates the cue ball at the given position.
 */
export function createCueBall(x: number, y: number): BallData {
  const body = Matter.Bodies.circle(x, y, BALL_RADIUS, {
    ...ballPhysicsOptions,
    label: "cue-ball",
    frictionAir: BALL_FRICTION_AIR,
  });
  return { body, number: 0, isPocketed: false };
}

/**
 * Builds the 9-ball diamond rack formation.
 *
 * Diamond layout (. = empty, numbers = ball positions):
 *          1
 *        X   X
 *      X   9   X
 *        X   X
 *          X
 *
 * Standard order in diamond:
 * Row 1 (tip): 1
 * Row 2: random, random
 * Row 3: random, 9, random
 * Row 4: random, random
 * Row 5 (back): random
 */
export function createRackedBalls(
  rackX: number,
  rackY: number
): BallData[] {
  const gap = BALL_RADIUS * 2 + 0.5; // slight gap for stable stack
  const rowOffset = gap * Math.sin(Math.PI / 3); // ~√3/2 * gap

  // Diamond positions relative to rack tip
  // Facing left (towards the cue ball), centered vertically
  const positions: [number, number][] = [
    [0, 0],                                    // row 1 - tip (ball 1)
    [rowOffset, -gap / 2],                     // row 2
    [rowOffset, gap / 2],
    [rowOffset * 2, -gap],                     // row 3
    [rowOffset * 2, 0],                        // center = ball 9
    [rowOffset * 2, gap],
    [rowOffset * 3, -gap / 2],                 // row 4
    [rowOffset * 3, gap / 2],
    [rowOffset * 4, 0],                        // row 5 - back
  ];

  // Fixed positions: 1 at tip (index 0), 9 at center (index 4)
  const ballNumbers = [2, 3, 4, 5, 6, 7, 8]; // remaining balls to shuffle
  const shuffled = shuffleArray(ballNumbers);

  // Build assignment: 0→1, 4→9, others→shuffled
  const assignment: number[] = new Array(9);
  assignment[0] = 1;
  assignment[4] = 9;
  let si = 0;
  for (let i = 1; i < 9; i++) {
    if (i === 4) continue;
    assignment[i] = shuffled[si++];
  }

  return positions.map(([dx, dy], i) => {
    return createBall(rackX + dx, rackY + dy, assignment[i]);
  });
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Applies an impulse to the cue ball in the given direction with the given power.
 * angle is in radians (0 = right, PI = left).
 * power is 0..1 normalized.
 */
export function shootCueBall(
  cueBall: Matter.Body,
  angle: number,
  power: number
): void {
  // Clear any residual drift velocity before shot to make direction 100% accurate
  Matter.Body.setVelocity(cueBall, { x: 0, y: 0 });
  Matter.Body.setAngularVelocity(cueBall, 0);

  // Calculate normalized direction vector based on the angle
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);

  // Apply force exactly to the cue ball's center position (center of mass) to ensure zero torque
  const position = cueBall.position;

  // Use a small scaling factor for Matter.js force to prevent balls from moving too fast
  const MAX_FORCE = 0.085;
  const force = {
    x: dirX * power * MAX_FORCE,
    y: dirY * power * MAX_FORCE,
  };

  Matter.Body.applyForce(cueBall, position, force);
}

