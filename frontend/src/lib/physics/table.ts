import Matter from "matter-js";

export interface TableConfig {
  x: number;       // canvas top-left X
  y: number;       // canvas top-left Y
  width: number;   // playable area width
  height: number;  // playable area height
}

export interface Pocket {
  x: number;
  y: number;
  radius: number;
}

// Wall thickness
const WALL_THICKNESS = 30;
// Cushion restitution (bounciness) and friction
const CUSHION_RESTITUTION = 0.75;
const CUSHION_FRICTION = 0.0;

/**
 * Creates the 4 cushion walls of the billiard table.
 * Walls are placed outside the playable area.
 */
export function createTableWalls(config: TableConfig): Matter.Body[] {
  const { x, y, width, height } = config;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const wallOptions = {
    isStatic: true,
    restitution: CUSHION_RESTITUTION,
    friction: CUSHION_FRICTION,
    frictionStatic: 0,
    label: "wall",
    collisionFilter: { category: 0x0002, mask: 0x0001 },
  };

  return [
    // Top wall
    Matter.Bodies.rectangle(
      cx, y - WALL_THICKNESS / 2,
      width, WALL_THICKNESS,
      { ...wallOptions, label: "wall-top" }
    ),
    // Bottom wall
    Matter.Bodies.rectangle(
      cx, y + height + WALL_THICKNESS / 2,
      width, WALL_THICKNESS,
      { ...wallOptions, label: "wall-bottom" }
    ),
    // Left wall
    Matter.Bodies.rectangle(
      x - WALL_THICKNESS / 2, cy,
      WALL_THICKNESS, height,
      { ...wallOptions, label: "wall-left" }
    ),
    // Right wall
    Matter.Bodies.rectangle(
      x + width + WALL_THICKNESS / 2, cy,
      WALL_THICKNESS, height,
      { ...wallOptions, label: "wall-right" }
    ),
  ];
}

/**
 * Returns the 6 pocket positions for a standard pool table.
 * 4 corner pockets + 2 side (middle) pockets.
 */
export function getTablePockets(config: TableConfig): Pocket[] {
  const { x, y, width, height } = config;
  const pocketRadius = 18;

  return [
    // Top-left
    { x: x + 4, y: y + 4, radius: pocketRadius },
    // Top-middle
    { x: x + width / 2, y: y - 4, radius: pocketRadius - 2 },
    // Top-right
    { x: x + width - 4, y: y + 4, radius: pocketRadius },
    // Bottom-left
    { x: x + 4, y: y + height - 4, radius: pocketRadius },
    // Bottom-middle
    { x: x + width / 2, y: y + height + 4, radius: pocketRadius - 2 },
    // Bottom-right
    { x: x + width - 4, y: y + height - 4, radius: pocketRadius },
  ];
}

/**
 * Checks if a ball has fallen into any pocket.
 * Returns the pocket index or -1 if not pocketed.
 */
export function checkPocketed(
  ball: Matter.Body,
  pockets: Pocket[]
): number {
  for (let i = 0; i < pockets.length; i++) {
    const pocket = pockets[i];
    const dx = ball.position.x - pocket.x;
    const dy = ball.position.y - pocket.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < pocket.radius + 2) {
      return i;
    }
  }
  return -1;
}
