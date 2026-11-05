# Space Battler Backend

The backend's sole role is offline procedural hull geometry validation against
`frontend/src/canvas/shipRenderer.ts`. The validator measures the renderer's
filled hull paths using the Shoelace formula: Terran and Alien hulls must have
less than 5% area difference and remain within the 1.40x shield bubble.

## Development Commands

```bash
uv run pytest -q

uv run ruff check .

uv run ruff format .
```
