import { cpus } from "node:os";
import { createSwarm } from "./swarmFixture";

// Cross-check without Vitest's module interception; npx tsx bench/swarm.ts.
console.log({ node: process.version, cpu: cpus()[0].model });
for (const corvettes of [0, 50, 100]) {
  const warm = createSwarm(corvettes);
  for (let tick = 0; tick < 30; tick++) warm.update(1 / 60);
  const sim = createSwarm(corvettes);
  const durations: number[] = [];
  let maxProjectiles = 0;
  for (let tick = 0; tick < 300; tick++) {
    const start = performance.now();
    sim.update(1 / 60);
    durations.push(performance.now() - start);
    maxProjectiles = Math.max(maxProjectiles, sim.projectiles.length);
  }
  durations.sort((a, b) => a - b);
  console.log({
    corvettesPerTeam: corvettes,
    ticks: 300,
    meanMs: durations.reduce((sum, value) => sum + value, 0) / 300,
    p50Ms: durations[149],
    p95Ms: durations[284],
    maxMs: durations[299],
    alive: sim.ships.filter((ship) => ship.isAlive).length,
    maxProjectiles,
  });
}
