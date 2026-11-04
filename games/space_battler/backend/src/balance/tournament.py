"""Monte Carlo tournament runner testing matchup balance and budget efficiency."""

import json
from dataclasses import dataclass

from src.engine.ship_factory import (
    create_battleship,
    create_corvette_pd,
    create_strike_craft,
)
from src.engine.simulation import CombatSimulation


@dataclass
class MatchResult:
    winner_team: int  # 0 or 1, -1 for draw/timeout
    blue_survivors: int
    red_survivors: int
    duration: float


def run_single_match(
    blue_ships_fn,
    red_ships_fn,
    max_duration: float = 60.0,
    dt: float = 1.0 / 30.0,
) -> MatchResult:
    """Run one headless deterministic simulation between two fleets until extinction or timeout."""
    sim = CombatSimulation()

    for ship in blue_ships_fn():
        sim.add_ship(ship)
    for ship in red_ships_fn():
        sim.add_ship(ship)

    time = 0.0
    while time < max_duration:
        sim.update(dt)
        time += dt

        blue_alive = [s for s in sim.ships if s.team == 0 and s.is_alive]
        red_alive = [s for s in sim.ships if s.team == 1 and s.is_alive]

        if not blue_alive or not red_alive:
            break

    blue_alive_count = len([s for s in sim.ships if s.team == 0 and s.is_alive])
    red_alive_count = len([s for s in sim.ships if s.team == 1 and s.is_alive])

    if blue_alive_count > 0 and red_alive_count == 0:
        winner = 0
    elif red_alive_count > 0 and blue_alive_count == 0:
        winner = 1
    else:
        winner = -1

    return MatchResult(
        winner_team=winner,
        blue_survivors=blue_alive_count,
        red_survivors=red_alive_count,
        duration=time,
    )


def fleet_battleships(team: int, offset_x: float) -> list:
    """Single heavy battleship (~3200 credits)."""
    return [create_battleship(f"bs_{team}_1", team, 1, (offset_x, 0.0))]


def fleet_strike_swarm(team: int, offset_x: float) -> list:
    """Swarm of 25 interceptors (~3000 credits)."""
    ships = []
    for i in range(25):
        y_pos = (i - 12) * 25.0
        ships.append(create_strike_craft(f"sc_{team}_{i}", team, 1, (offset_x, y_pos)))
    return ships


def fleet_corvette_escort(team: int, offset_x: float) -> list:
    """Task force of 9 point-defense corvettes (~3150 credits)."""
    ships = []
    for i in range(9):
        y_pos = (i - 4) * 40.0
        ships.append(create_corvette_pd(f"cv_{team}_{i}", team, 1, (offset_x, y_pos)))
    return ships


def run_balance_tournament(rounds_per_matchup: int = 10) -> dict[str, float]:
    """Run cross-archetype matchup tournament to compute win rates."""
    archetypes = {
        "Battleship": fleet_battleships,
        "StrikeSwarm": fleet_strike_swarm,
        "CorvetteEscort": fleet_corvette_escort,
    }

    results: dict[str, float] = {}
    names = list(archetypes.keys())

    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            name_a = names[i]
            name_b = names[j]

            a_wins = 0
            b_wins = 0

            for _ in range(rounds_per_matchup):
                # Match: A (Blue) vs B (Red)
                fn_a = archetypes[name_a]
                fn_b = archetypes[name_b]
                match = run_single_match(
                    lambda f=fn_a: f(0, -400.0),
                    lambda f=fn_b: f(1, 400.0),
                )
                if match.winner_team == 0:
                    a_wins += 1
                elif match.winner_team == 1:
                    b_wins += 1

            key = f"{name_a}_vs_{name_b}"
            total_decisive = max(1, a_wins + b_wins)
            results[key] = round(a_wins / total_decisive, 2)

    return results


def export_balance_json(filepath: str) -> None:
    """Export ship and weapon attributes to static JSON for client consumption."""
    from src.engine.constants import WEAPON_DEFINITIONS

    data = {
        "weapons": {
            k.value: {
                "name": v.name,
                "damage": v.damage,
                "cooldown": v.cooldown,
                "range": v.range,
                "projectileSpeed": v.projectile_speed,
                "trackingSpeed": v.tracking_speed,
                "shieldMultiplier": v.shield_multiplier,
                "armorMultiplier": v.armor_multiplier,
                "hullMultiplier": v.hull_multiplier,
                "cost": v.cost,
            }
            for k, v in WEAPON_DEFINITIONS.items()
        },
        "hulls": {
            "strike_craft": {
                "name": "Interceptor",
                "cost": 120,
                "maxSpeed": 240,
                "turnRate": 3.5,
                "shield": 60,
                "armor": 40,
                "hull": 70,
            },
            "corvette": {
                "name": "Aegis Corvette",
                "cost": 350,
                "maxSpeed": 150,
                "turnRate": 2.2,
                "shield": 180,
                "armor": 150,
                "hull": 220,
            },
            "cruiser": {
                "name": "Vanguard Cruiser",
                "cost": 1100,
                "maxSpeed": 90,
                "turnRate": 1.2,
                "shield": 600,
                "armor": 500,
                "hull": 700,
            },
            "battleship": {
                "name": "Leviathan Battleship",
                "cost": 3200,
                "maxSpeed": 45,
                "turnRate": 0.45,
                "shield": 1800,
                "armor": 1600,
                "hull": 2200,
            },
        },
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
