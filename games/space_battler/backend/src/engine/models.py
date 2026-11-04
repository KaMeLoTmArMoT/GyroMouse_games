"""Ship models, defensive layers, turret hardpoints, and munitions."""

import math
from dataclasses import dataclass, field

from src.engine.constants import WeaponDefinition, WeaponType
from src.engine.math2d import (
    Vector2,
    clamp,
    normalize_angle,
    rotate_point,
    vec_add,
    vec_sub,
)


@dataclass
class TurretMount:
    id: str
    offset: Vector2  # Relative to ship center
    base_arc: tuple[float, float]  # [min_angle, max_angle] relative to ship forward
    tracking_speed: float  # rad/s
    weapon: WeaponDefinition
    current_local_angle: float = 0.0
    cooldown_timer: float = 0.0
    current_target_id: str | None = None

    def update_aim(
        self,
        dt: float,
        ship_pos: Vector2,
        ship_heading: float,
        target_pos: Vector2 | None,
    ) -> bool:
        """Rotate turret toward target position. Returns True if on target and within arc."""
        if self.cooldown_timer > 0.0:
            self.cooldown_timer = max(0.0, self.cooldown_timer - dt)

        if not target_pos:
            return False

        # World position of this turret
        rotated_offset = rotate_point(self.offset, ship_heading)
        turret_world_pos = vec_add(ship_pos, rotated_offset)

        # Desired world angle
        to_target = vec_sub(target_pos, turret_world_pos)
        desired_world_angle = math.atan2(to_target[1], to_target[0])

        # Desired local angle relative to ship heading
        desired_local = normalize_angle(desired_world_angle - ship_heading)

        # Check arc bounds
        min_arc, max_arc = self.base_arc
        clamped_local = clamp(desired_local, min_arc, max_arc)

        # Rotate toward clamped target angle
        diff = normalize_angle(clamped_local - self.current_local_angle)
        max_step = self.tracking_speed * dt
        step = clamp(diff, -max_step, max_step)
        self.current_local_angle = normalize_angle(self.current_local_angle + step)

        # Return True if aimed within ~3 degrees of desired angle and within arc
        is_in_arc = min_arc <= desired_local <= max_arc
        is_aligned = abs(diff) < 0.05
        return is_in_arc and is_aligned


@dataclass
class Projectile:
    id: str
    weapon_type: WeaponType
    damage: float
    owner_id: str
    owner_team: int
    pos: Vector2
    velocity: Vector2
    lifetime: float
    target_id: str | None = None
    hp: float = 25.0  # For physical missiles that can be shot down


@dataclass
class Ship:
    id: str
    name: str
    team: int  # 0: Blue, 1: Red
    group_id: int  # 1..10
    hull_class: str  # "strike_craft", "corvette", "cruiser", "battleship"
    pos: Vector2
    velocity: Vector2 = (0.0, 0.0)
    heading: float = 0.0
    max_speed: float = 80.0
    turn_rate: float = 1.0  # rad/s
    size: float = 20.0  # collision / target radius

    # Defense Layers
    shield_max: float = 300.0
    shield_current: float = 300.0
    shield_regen: float = 15.0  # per second
    shield_recharge_delay: float = 1.5  # delay after taking damage (0.0 for Battleship, 1.2 for Cruiser)
    shield_delay_timer: float = 0.0

    armor_max: float = 400.0
    armor_current: float = 400.0
    armor_rating: float = 35.0  # resistance threshold

    hull_max: float = 500.0
    hull_current: float = 500.0

    turrets: list[TurretMount] = field(default_factory=list)
    cost: float = 1000.0
    is_alive: bool = True

    def take_damage(self, raw_damage: float, weapon: WeaponDefinition) -> float:
        """Apply damage across shield, armor, and hull. Returns total effective damage dealt."""
        if not self.is_alive:
            return 0.0

        self.shield_delay_timer = self.shield_recharge_delay
        remaining = raw_damage

        # 1. Shield Absorption
        if self.shield_current > 0.0:
            effective_shield_dmg = remaining * weapon.shield_multiplier
            if self.shield_current >= effective_shield_dmg:
                self.shield_current -= effective_shield_dmg
                return raw_damage
            else:
                remaining -= self.shield_current / weapon.shield_multiplier
                self.shield_current = 0.0

        # 2. Armor Mitigation
        if self.armor_current > 0.0 and remaining > 0.0:
            effective_armor_dmg = remaining * weapon.armor_multiplier
            # Damage reduction via armor rating formula
            mitigation_factor = remaining / (remaining + self.armor_rating)
            mitigated_dmg = effective_armor_dmg * mitigation_factor
            if self.armor_current >= mitigated_dmg:
                self.armor_current -= mitigated_dmg
                return raw_damage
            else:
                remaining -= self.armor_current / (weapon.armor_multiplier * mitigation_factor)
                self.armor_current = 0.0

        # 3. Hull Structural Damage
        if remaining > 0.0:
            hull_dmg = remaining * weapon.hull_multiplier
            self.hull_current = max(0.0, self.hull_current - hull_dmg)
            if self.hull_current <= 0.0:
                self.is_alive = False

        return raw_damage

    def update_defense(self, dt: float) -> None:
        """Regenerate shields if cooldown delay expired."""
        if not self.is_alive:
            return
        if self.shield_delay_timer > 0.0:
            self.shield_delay_timer = max(0.0, self.shield_delay_timer - dt)
        elif self.shield_current < self.shield_max:
            self.shield_current = min(self.shield_max, self.shield_current + self.shield_regen * dt)
