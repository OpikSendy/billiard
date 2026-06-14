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
const CUSHION_RESTITUTION = 0.78;
const CUSHION_FRICTION = 0.0;

/**
 * Creates the 4 cushion walls of the billiard table.
 * Walls are placed outside the playable area.
 */
export function createTableWalls(config: TableConfig): Matter.Body[] {
  const { x, y, width, height } = config;

  const bodies: Matter.Body[] = [];

  // Define cushion points matching the visual trapezoids exactly
  const cushionsData = [
    // Top-Left cushion
    {
      label: "cushion",
      pts: [
        { x: x + 35, y: y - 24 },
        { x: x + width / 2 - 25, y: y - 24 },
        { x: x + width / 2 - 25 - 12, y: y },
        { x: x + 35 + 18, y: y }
      ]
    },
    // Top-Right cushion
    {
      label: "cushion",
      pts: [
        { x: x + width / 2 + 25, y: y - 24 },
        { x: x + width - 35, y: y - 24 },
        { x: x + width - 35 - 18, y: y },
        { x: x + width / 2 + 25 + 12, y: y }
      ]
    },
    // Bottom-Left cushion
    {
      label: "cushion",
      pts: [
        { x: x + 35, y: y + height + 24 },
        { x: x + width / 2 - 25, y: y + height + 24 },
        { x: x + width / 2 - 25 - 12, y: y + height },
        { x: x + 35 + 18, y: y + height }
      ]
    },
    // Bottom-Right cushion
    {
      label: "cushion",
      pts: [
        { x: x + width / 2 + 25, y: y + height + 24 },
        { x: x + width - 35, y: y + height + 24 },
        { x: x + width - 35 - 18, y: y + height },
        { x: x + width / 2 + 25 + 12, y: y + height }
      ]
    },
    // Left cushion
    {
      label: "cushion",
      pts: [
        { x: x - 24, y: y + 35 },
        { x: x - 24, y: y + height - 35 },
        { x: x, y: y + height - 35 - 18 },
        { x: x, y: y + 35 + 18 }
      ]
    },
    // Right cushion
    {
      label: "cushion",
      pts: [
        { x: x + width + 24, y: y + 35 },
        { x: x + width + 24, y: y + height - 35 },
        { x: x + width, y: y + height - 35 - 18 },
        { x: x + width, y: y + 35 + 18 }
      ]
    }
  ];

  cushionsData.forEach((c) => {
    const body = Matter.Body.create({
      isStatic: true,
      restitution: CUSHION_RESTITUTION,
      friction: CUSHION_FRICTION,
      frictionStatic: 0,
      label: c.label,
      collisionFilter: { category: 0x0002, mask: 0x0001 },
    });
    const vertices = Matter.Vertices.create(c.pts, body);
    const centre = Matter.Vertices.centre(vertices);
    Matter.Body.setVertices(body, vertices);
    Matter.Body.setPosition(body, centre);
    bodies.push(body);
  });

  // Rounded bumper circles at the ends of the cushions to act as realistic pocket inlets
  const bumperRadius = 7;
  const bumperOptions = {
    isStatic: true,
    restitution: CUSHION_RESTITUTION,
    friction: CUSHION_FRICTION,
    frictionStatic: 0,
    label: "cushion",
    collisionFilter: { category: 0x0002, mask: 0x0001 },
  };

  const bumpers = [
    // Top-Left ends
    { x: x + 35, y: y - 2 },
    { x: x + width / 2 - 25, y: y - 2 },
    // Top-Right ends
    { x: x + width / 2 + 25, y: y - 2 },
    { x: x + width - 35, y: y - 2 },
    // Bottom-Left ends
    { x: x + 35, y: y + height + 2 },
    { x: x + width / 2 - 25, y: y + height + 2 },
    // Bottom-Right ends
    { x: x + width / 2 + 25, y: y + height + 2 },
    { x: x + width - 35, y: y + height + 2 },
    // Left ends
    { x: x - 2, y: y + 35 },
    { x: x - 2, y: y + height - 35 },
    // Right ends
    { x: x + width + 2, y: y + 35 },
    { x: x + width + 2, y: y + height - 35 },
  ];

  bumpers.forEach((pos) => {
    bodies.push(Matter.Bodies.circle(pos.x, pos.y, bumperRadius, bumperOptions));
  });

  return bodies;
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
 * Creates standard pockets as static circular sensor bodies.
 */
export function createTablePockets(config: TableConfig): Matter.Body[] {
  const pockets = getTablePockets(config);
  return pockets.map((p, index) => {
    return Matter.Bodies.circle(p.x, p.y, p.radius, {
      isStatic: true,
      isSensor: true,
      label: "pocket",
      collisionFilter: {
        category: 0x0004,
        mask: 0x0001
      }
    });
  });
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
