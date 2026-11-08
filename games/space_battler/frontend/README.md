# Space Battler Frontend

Tactical 2.5D space fleet auto-battler built with React 19, TypeScript, and Tailwind CSS v4.

## Features

- **Procedural 2.5D Tactical View**: Real-time rendering of capital ships, independent turret arcs, projectile trails, and shield effects.
- **Fleet Assembly**: Operational group doctrines, weapon loadout counters, and budget constraints.
- **Simulation Controls**: Granular time-scale adjustments (pause, step, 0.5x, 1x, 2x, 5x).
- **Static Deployment**: Fully autonomous client capable of running on static web hosts without server latency.

## Development Commands

```bash
# Development server
bun dev

# Lint and format check (Biome)
npx @biomejs/biome check src/

# Format code in-place
npx @biomejs/biome check --write src/

# Type check
npx tsc --noEmit

# Production build
bun run build
```
