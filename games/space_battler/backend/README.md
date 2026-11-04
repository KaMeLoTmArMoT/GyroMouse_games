# Space Battler Backend

Deterministic simulation engine and Monte Carlo balance optimizer for tactical fleet combat.

## Capabilities

- **Deterministic Simulation Core**: Fixed-step physical update loop (tracking physics, multi-layer damage, flight vectors).
- **Monte Carlo Balancer**: Automated tournament runner generating cost-efficiency matrices across ship archetype matchups.
- **Data Export**: Generates standardized balance datasets (`ships_balance.json`) consumed by the static web client.

## Development Commands

```bash
# Run test suite
uv run pytest

# Lint and check
uv run ruff check .

# Format code
uv run ruff format .
```

