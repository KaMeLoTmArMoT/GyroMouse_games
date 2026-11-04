"""Factory functions creating standard ship archetypes for testing and balance."""

import math

from src.engine.constants import WEAPON_DEFINITIONS, WeaponType
from src.engine.models import Ship, TurretMount


def create_strike_craft(id: str, team: int, group_id: int, pos: tuple[float, float]) -> Ship:
    """Fast, agile fighter equipped with forward plasma blaster and light shields."""
    ship = Ship(
        id=id,
        name="Interceptor",
        team=team,
        group_id=group_id,
        hull_class="strike_craft",
        pos=pos,
        max_speed=240.0,
        turn_rate=3.5,
        size=10.0,
        shield_max=60.0,
        shield_current=60.0,
        shield_regen=10.0,
        armor_max=40.0,
        armor_current=40.0,
        armor_rating=5.0,
        hull_max=70.0,
        hull_current=70.0,
        cost=120.0,
    )
    # Forward nose gun with narrow 30 deg arc
    ship.turrets = [
        TurretMount(
            id=f"{id}_t1",
            offset=(6.0, 0.0),
            base_arc=(-math.pi / 6, math.pi / 6),
            tracking_speed=4.0,
            weapon=WEAPON_DEFINITIONS[WeaponType.PLASMA],
        )
    ]
    return ship


def create_corvette_pd(id: str, team: int, group_id: int, pos: tuple[float, float]) -> Ship:
    """Point defense escort designed to protect capitals from torpedoes and strike crafts."""
    ship = Ship(
        id=id,
        name="Aegis Corvette",
        team=team,
        group_id=group_id,
        hull_class="corvette",
        pos=pos,
        max_speed=150.0,
        turn_rate=2.2,
        size=18.0,
        shield_max=180.0,
        shield_current=180.0,
        shield_regen=15.0,
        armor_max=150.0,
        armor_current=150.0,
        armor_rating=15.0,
        hull_max=220.0,
        hull_current=220.0,
        cost=350.0,
    )
    # 2 dual 360-degree point defense flak turrets
    ship.turrets = [
        TurretMount(
            id=f"{id}_pd1",
            offset=(-4.0, -5.0),
            base_arc=(-math.pi, math.pi),
            tracking_speed=6.28,
            weapon=WEAPON_DEFINITIONS[WeaponType.POINT_DEFENSE],
        ),
        TurretMount(
            id=f"{id}_pd2",
            offset=(-4.0, 5.0),
            base_arc=(-math.pi, math.pi),
            tracking_speed=6.28,
            weapon=WEAPON_DEFINITIONS[WeaponType.POINT_DEFENSE],
        ),
    ]
    return ship


def create_cruiser(id: str, team: int, group_id: int, pos: tuple[float, float]) -> Ship:
    """Versatile combatant equipped with beam lasers and torpedo tubes."""
    ship = Ship(
        id=id,
        name="Vanguard Cruiser",
        team=team,
        group_id=group_id,
        hull_class="cruiser",
        pos=pos,
        max_speed=90.0,
        turn_rate=1.2,
        size=35.0,
        shield_max=600.0,
        shield_current=600.0,
        shield_regen=25.0,
        armor_max=500.0,
        armor_current=500.0,
        armor_rating=35.0,
        hull_max=700.0,
        hull_current=700.0,
        cost=1100.0,
    )
    ship.turrets = [
        # Dorsal beam laser turret (360 arc)
        TurretMount(
            id=f"{id}_t1",
            offset=(10.0, 0.0),
            base_arc=(-math.pi, math.pi),
            tracking_speed=1.8,
            weapon=WEAPON_DEFINITIONS[WeaponType.BEAM_LASER],
        ),
        # Prow heavy torpedo launcher (forward 60 deg arc)
        TurretMount(
            id=f"{id}_t2",
            offset=(20.0, 0.0),
            base_arc=(-math.pi / 3, math.pi / 3),
            tracking_speed=2.0,
            weapon=WEAPON_DEFINITIONS[WeaponType.MISSILE],
        ),
    ]
    return ship


def create_battleship(id: str, team: int, group_id: int, pos: tuple[float, float]) -> Ship:
    """Heavy capital ship with long-range spinal railguns and broadside batteries."""
    ship = Ship(
        id=id,
        name="Leviathan Battleship",
        team=team,
        group_id=group_id,
        hull_class="battleship",
        pos=pos,
        max_speed=45.0,
        turn_rate=0.45,
        size=55.0,
        shield_max=1800.0,
        shield_current=1800.0,
        shield_regen=40.0,
        shield_recharge_delay=0.0,  # Zero delay for capital dreadnought!
        armor_max=1600.0,
        armor_current=1600.0,
        armor_rating=75.0,
        hull_max=2200.0,
        hull_current=2200.0,
        cost=3200.0,
    )
    ship.turrets = [
        # Spinal railgun battery forward
        TurretMount(
            id=f"{id}_rg1",
            offset=(25.0, 0.0),
            base_arc=(-math.pi / 2, math.pi / 2),
            tracking_speed=0.6,
            weapon=WEAPON_DEFINITIONS[WeaponType.RAILGUN],
        ),
        # Port broadside beam battery
        TurretMount(
            id=f"{id}_bs_port",
            offset=(-10.0, -15.0),
            base_arc=(-math.pi + 0.2, -0.2),  # Port broadside sector
            tracking_speed=1.2,
            weapon=WEAPON_DEFINITIONS[WeaponType.BEAM_LASER],
        ),
        # Starboard broadside beam battery
        TurretMount(
            id=f"{id}_bs_stbd",
            offset=(-10.0, 15.0),
            base_arc=(0.2, math.pi - 0.2),  # Starboard broadside sector
            tracking_speed=1.2,
            weapon=WEAPON_DEFINITIONS[WeaponType.BEAM_LASER],
        ),
    ]
    return ship
