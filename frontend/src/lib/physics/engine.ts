import Matter from "matter-js";

export interface PhysicsEngine {
  engine: Matter.Engine;
  render: Matter.Render | null;
  runner: Matter.Runner;
  world: Matter.World;
}

/**
 * Creates and configures a Matter.js physics engine instance.
 * We use a custom gravity-free world (top-down view).
 */
export function createPhysicsEngine(): PhysicsEngine {
  const engine = Matter.Engine.create({
    gravity: { x: 0, y: 0 }, // Top-down view, no gravity
    positionIterations: 10,
    velocityIterations: 8,
  });

  const runner = Matter.Runner.create();
  const world = engine.world;

  return { engine, render: null, runner, world };
}

/**
 * Starts the physics simulation loop.
 */
export function startEngine(physicsEngine: PhysicsEngine): void {
  Matter.Runner.run(physicsEngine.runner, physicsEngine.engine);
}

/**
 * Stops the physics simulation loop and clears the world.
 */
export function stopEngine(physicsEngine: PhysicsEngine): void {
  Matter.Runner.stop(physicsEngine.runner);
  Matter.World.clear(physicsEngine.world, false);
  Matter.Engine.clear(physicsEngine.engine);
}

/**
 * Checks if all balls have stopped moving (velocity below threshold).
 */
export function allBallsStopped(
  balls: Matter.Body[],
  threshold = 0.08
): boolean {
  return balls.every((ball) => {
    const speed = Math.sqrt(
      ball.velocity.x ** 2 + ball.velocity.y ** 2
    );
    return speed < threshold;
  });
}
