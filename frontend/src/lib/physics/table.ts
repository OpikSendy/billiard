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
const CUSHION_RESTITUTION = 0.8;
const CUSHION_FRICTION = 0.0;

/**
 * Creates the 4 cushion walls of the billiard table.
 * Walls are placed outside the playable area.
 */
export function createTableWalls(config: TableConfig): Matter.Body[] {
  const { x, y, width, height } = config;

  const wallOptions = {
    isStatic: true,
    restitution: CUSHION_RESTITUTION,
    friction: CUSHION_FRICTION,
    frictionStatic: 0,
    label: "cushion",
    collisionFilter: { category: 0x0002, mask: 0x0001 },
  };

  const bodies: Matter.Body[] = [];

  // Split Top wall: Left & Right segments
  const topSegLength = width / 2 - 60;
  const topY = y - WALL_THICKNESS / 2;
  
  // Top-Left cushion
  bodies.push(Matter.Bodies.rectangle(
    x + 35 + topSegLength / 2, topY,
    topSegLength, WALL_THICKNESS,
    { ...wallOptions, label: "cushion-top-left" }
  ));
  
  // Top-Right cushion
  bodies.push(Matter.Bodies.rectangle(
    x + width / 2 + 25 + topSegLength / 2, topY,
    topSegLength, WALL_THICKNESS,
    { ...wallOptions, label: "cushion-top-right" }
  ));

  // Split Bottom wall: Left & Right segments
  const botY = y + height + WALL_THICKNESS / 2;
  // Bottom-Left cushion
  bodies.push(Matter.Bodies.rectangle(
    x + 35 + topSegLength / 2, botY,
    topSegLength, WALL_THICKNESS,
    { ...wallOptions, label: "cushion-bottom-left" }
  ));
  // Bottom-Right cushion
  bodies.push(Matter.Bodies.rectangle(
    x + width / 2 + 25 + topSegLength / 2, botY,
    topSegLength, WALL_THICKNESS,
    { ...wallOptions, label: "cushion-bottom-right" }
  ));

  // Left cushion
  const sideSegLength = height - 70;
  const leftX = x - WALL_THICKNESS / 2;
  bodies.push(Matter.Bodies.rectangle(
    leftX, y + 35 + sideSegLength / 2,
    WALL_THICKNESS, sideSegLength,
    { ...wallOptions, label: "cushion-left" }
  ));

  // Right cushion
  const rightX = x + width + WALL_THICKNESS / 2;
  bodies.push(Matter.Bodies.rectangle(
    rightX, y + 35 + sideSegLength / 2,
    WALL_THICKNESS, sideSegLength,
    { ...wallOptions, label: "cushion-right" }
  ));

  // Rounded bumper circles at the ends of the cushions to act as realistic pocket inlets
  const bumperRadius = 7;
  const bumperOptions = {
    ...wallOptions,
    label: "cushion-bumper",
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
      label: `pocket-${index}`,
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
