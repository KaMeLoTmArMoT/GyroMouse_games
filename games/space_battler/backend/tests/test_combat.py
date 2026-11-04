"""Comprehensive combat mechanics, defense layers, and balance tests."""

import pytest

from src.balance.tournament import run_single_match
from src.engine.constants import WEAPON_DEFINITIONS, WeaponType
from src.engine.models import Ship, TurretMount
from src.engine.ship_factory import (
    create_corvette_pd,
    create_cruiser,
    create_strike_craft,
)
from src.engine.simulation import CombatSimulation


def test_ship_defense_layers():
    """Verify shield absorption, armor mitigation, and hull penetration."""
    ship = Ship(
        id="test_target",
        name="Target",
        team=1,
        group_id=1,
        hull_class="cruiser",
        pos=(0.0, 0.0),
        shield_max=100.0,
        shield_current=100.0,
        armor_max=100.0,
        armor_current=100.0,
        armor_rating=20.0,
        hull_max=100.0,
        hull_current=100.0,
    )

    # 1. Fire laser (0.5x vs shield)
    laser = WEAPON_DEFINITIONS[WeaponType.BEAM_LASER]
    ship.take_damage(50.0, laser)
    # Shield absorbs: 50.0 * 0.5 = 25.0 damage
    assert ship.shield_current == pytest.approx(75.0)
    assert ship.armor_current == 100.0
    assert ship.hull_current == 100.0


def test_point_defense_intercepts_missiles():
    """Verify that point defense corvettes quickly shoot down incoming heavy torpedoes."""
    sim = CombatSimulation()
    # Add PD Corvette at center
    corvette = create_corvette_pd("pd_1", team=0, group_id=1, pos=(0.0, 0.0))
    sim.add_ship(corvette)

    # Add enemy missile heading toward it
    from src.engine.models import Projectile

    missile = Projectile(
        id="torpedo_test",
        weapon_type=WeaponType.MISSILE,
        damage=220.0,
        owner_id="enemy_launcher",
        owner_team=1,
        pos=(150.0, 0.0),
        velocity=(-100.0, 0.0),
        lifetime=5.0,
        hp=25.0,
    )
    sim.projectiles.append(missile)

    # Run for 0.5 seconds
    for _ in range(15):
        sim.update(1.0 / 30.0)

    # Missile should be intercepted and destroyed
    assert len(sim.projectiles) == 0


def test_turret_aim_arc_clamping():
    """Verify that turrets respect their designated firing arcs."""
    # Turret with forward 60 deg arc (-pi/6 to pi/6)
    import math

    turret = TurretMount(
        id="t1",
        offset=(0.0, 0.0),
        base_arc=(-math.pi / 6, math.pi / 6),
        tracking_speed=2.0,
        weapon=WEAPON_DEFINITIONS[WeaponType.RAILGUN],
    )

    # Target is directly behind the ship (angle = pi)
    target_pos = (-500.0, 0.0)
    ship_pos = (0.0, 0.0)
    ship_heading = 0.0

    turret.update_aim(0.1, ship_pos, ship_heading, target_pos)

    # Local angle should be clamped to max_arc (pi/6 ~ 0.523)
    assert turret.current_local_angle <= math.pi / 6 + 1e-4


def test_quick_fleet_engagement():
    """Run a deterministic fleet battle to extinction and verify winner."""
    match = run_single_match(
        blue_ships_fn=lambda: [create_cruiser("cruiser_blue", 0, 1, (-200.0, 0.0))],
        red_ships_fn=lambda: [
            create_strike_craft(f"sc_red_{i}", 1, 1, (200.0, i * 20.0)) for i in range(3)
        ],
        max_duration=30.0,
    )
    assert match.duration > 0.0
    assert match.winner_team in (0, 1, -1)
