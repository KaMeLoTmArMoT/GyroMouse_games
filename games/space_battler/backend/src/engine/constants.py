"""Combat mathematical constants, physics definitions, and weapon types."""

from dataclasses import dataclass
from enum import StrEnum


class WeaponType(StrEnum):
    BEAM_LASER = "beam_laser"
    RAILGUN = "railgun"
    PLASMA = "plasma"
    MISSILE = "missile"
    POINT_DEFENSE = "point_defense"


class TargetPriority(StrEnum):
    CAPITALS = "capitals"
    SCREEN_AND_DEFEND = "screen_and_defend"
    STRIKE_CRAFT = "strike_craft"
    NEAREST = "nearest"


class EngagementStance(StrEnum):
    MAX_RANGE = "max_range"
    OPTIMAL_RANGE = "optimal_range"
    BRAWL = "brawl"


@dataclass(frozen=True)
class WeaponDefinition:
    weapon_type: WeaponType
    name: str
    damage: float
    cooldown: float  # Seconds between shots
    range: float  # Operational firing range in world units
    projectile_speed: float  # 0 for instant hitscan (lasers/PD)
    tracking_speed: float  # Radians per second for turret traverse
    shield_multiplier: float
    armor_multiplier: float
    hull_multiplier: float
    cost: float


# Baseline Weapon Profiles
WEAPON_DEFINITIONS = {
    WeaponType.BEAM_LASER: WeaponDefinition(
        weapon_type=WeaponType.BEAM_LASER,
        name="Beam Laser",
        damage=45.0,
        cooldown=1.2,
        range=600.0,
        projectile_speed=0.0,  # Hitscan
        tracking_speed=1.8,
        shield_multiplier=0.5,
        armor_multiplier=1.6,
        hull_multiplier=1.0,
        cost=250.0,
    ),
    WeaponType.RAILGUN: WeaponDefinition(
        weapon_type=WeaponType.RAILGUN,
        name="Heavy Railgun",
        damage=85.0,
        cooldown=2.5,
        range=950.0,
        projectile_speed=1200.0,
        tracking_speed=0.8,
        shield_multiplier=1.6,
        armor_multiplier=0.75,
        hull_multiplier=1.0,
        cost=320.0,
    ),
    WeaponType.PLASMA: WeaponDefinition(
        weapon_type=WeaponType.PLASMA,
        name="Plasma Blaster",
        damage=120.0,
        cooldown=3.0,
        range=480.0,
        projectile_speed=450.0,
        tracking_speed=1.2,
        shield_multiplier=1.0,
        armor_multiplier=1.1,
        hull_multiplier=1.5,
        cost=280.0,
    ),
    WeaponType.MISSILE: WeaponDefinition(
        weapon_type=WeaponType.MISSILE,
        name="Heavy Torpedo",
        damage=220.0,
        cooldown=5.0,
        range=1100.0,
        projectile_speed=320.0,  # Physical missile that can be intercepted
        tracking_speed=2.5,
        shield_multiplier=1.0,
        armor_multiplier=1.8,
        hull_multiplier=1.8,
        cost=380.0,
    ),
    WeaponType.POINT_DEFENSE: WeaponDefinition(
        weapon_type=WeaponType.POINT_DEFENSE,
        name="Point Defense Flak",
        damage=12.0,
        cooldown=0.15,
        range=350.0,
        projectile_speed=0.0,  # Hitscan beam/flak
        tracking_speed=6.28,  # Ultra-fast traverse
        shield_multiplier=0.1,
        armor_multiplier=0.1,
        hull_multiplier=0.2,
        cost=150.0,
    ),
}
