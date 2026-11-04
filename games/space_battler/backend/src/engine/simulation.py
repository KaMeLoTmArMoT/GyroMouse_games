"""Deterministic combat simulation loop executing flight kinematics, turret aiming, and ballistics."""

import math
from dataclasses import dataclass, field

from src.engine.constants import EngagementStance, TargetPriority, WeaponType
from src.engine.math2d import (
    Vector2,
    clamp,
    normalize_angle,
    rotate_point,
    vec_add,
    vec_distance,
    vec_distance_sq,
    vec_normalize,
    vec_scale,
    vec_sub,
)
from src.engine.models import Projectile, Ship, TurretMount


@dataclass
class GroupOrder:
    group_id: int
    priority: TargetPriority = TargetPriority.NEAREST
    stance: EngagementStance = EngagementStance.OPTIMAL_RANGE
    custom_target_group: int | None = None


@dataclass
class CombatSimulation:
    ships: list[Ship] = field(default_factory=list)
    projectiles: list[Projectile] = field(default_factory=list)
    orders: dict[int, GroupOrder] = field(default_factory=dict)
    time_elapsed: float = 0.0
    projectile_counter: int = 0

    def add_ship(self, ship: Ship) -> None:
        self.ships.append(ship)

    def set_group_order(self, order: GroupOrder) -> None:
        self.orders[order.group_id] = order

    def update(self, dt: float) -> None:
        """Run one fixed simulation step."""
        self.time_elapsed += dt

        # 1. Update Defense & Regenerate Shields
        for ship in self.ships:
            ship.update_defense(dt)

        # 2. Tactical Movement & Targeting AI
        alive_ships = [s for s in self.ships if s.is_alive]
        for ship in alive_ships:
            order = self.orders.get(ship.group_id, GroupOrder(group_id=ship.group_id))
            target = self._find_target_for_ship(ship, order, alive_ships)
            self._update_ship_movement(ship, target, order, dt)

            # Update Turret Aim and Fire
            for turret in ship.turrets:
                target_pos = target.pos if target else None
                # Special targeting for Point Defense: prioritize missiles in range
                if turret.weapon.weapon_type == WeaponType.POINT_DEFENSE:
                    missile_target = self._find_missile_target(ship, turret.weapon.range)
                    if missile_target:
                        target_pos = missile_target.pos
                elif target and turret.weapon.projectile_speed > 0:
                    dist = vec_distance(ship.pos, target.pos)
                    flight_time = dist / turret.weapon.projectile_speed
                    target_pos = (
                        target.pos[0] + target.velocity[0] * flight_time,
                        target.pos[1] + target.velocity[1] * flight_time,
                    )

                is_aimed = turret.update_aim(dt, ship.pos, ship.heading, target_pos)

                if is_aimed and turret.cooldown_timer <= 0.0 and target_pos:
                    self._fire_weapon(ship, turret, target_pos, target)

        # 3. Update Projectiles & Resolve Impacts
        self._update_projectiles(dt, alive_ships)

    def _find_target_for_ship(
        self, ship: Ship, order: GroupOrder, alive_ships: list[Ship]
    ) -> Ship | None:
        """Select primary enemy target according to group doctrine."""
        enemies = [s for s in alive_ships if s.team != ship.team]
        if not enemies:
            return None

        if order.priority == TargetPriority.CAPITALS:
            capitals = [s for s in enemies if s.hull_class in ("cruiser", "battleship")]
            if capitals:
                enemies = capitals
        elif order.priority == TargetPriority.STRIKE_CRAFT:
            crafts = [s for s in enemies if s.hull_class in ("strike_craft", "corvette")]
            if crafts:
                enemies = crafts

        # Nearest within priority subset
        return min(enemies, key=lambda e: vec_distance_sq(ship.pos, e.pos))

    def _find_missile_target(self, ship: Ship, max_range: float) -> Projectile | None:
        """Find nearest enemy missile targeting friendly group."""
        hostile_missiles = [
            p
            for p in self.projectiles
            if p.owner_team != ship.team and p.weapon_type == WeaponType.MISSILE
        ]
        if not hostile_missiles:
            return None
        in_range = [p for p in hostile_missiles if vec_distance(ship.pos, p.pos) <= max_range]
        if not in_range:
            return None
        return min(in_range, key=lambda p: vec_distance_sq(ship.pos, p.pos))

    def _update_ship_movement(
        self, ship: Ship, target: Ship | None, order: GroupOrder, dt: float
    ) -> None:
        """Calculate steering behaviors and integrate velocity/position."""
        if not target:
            # Slow down to stop
            ship.velocity = vec_scale(ship.velocity, max(0.0, 1.0 - dt * 2.0))
            ship.pos = vec_add(ship.pos, vec_scale(ship.velocity, dt))
            return

        to_target = vec_sub(target.pos, ship.pos)
        dist = vec_distance(ship.pos, target.pos)
        desired_dist = 600.0 if order.stance == EngagementStance.MAX_RANGE else 250.0

        # Capital ship broadside maneuver
        desired_angle = math.atan2(to_target[1], to_target[0])
        if ship.hull_class == "battleship" and dist < desired_dist * 1.5:
            # Turn 90 degrees to present broadsides
            desired_angle += math.pi / 2

        # Rotate hull toward desired heading
        angle_diff = normalize_angle(desired_angle - ship.heading)
        turn_step = clamp(angle_diff, -ship.turn_rate * dt, ship.turn_rate * dt)
        ship.heading = normalize_angle(ship.heading + turn_step)

        # Thrust forward or reverse based on desired distance
        forward_dir = (math.cos(ship.heading), math.sin(ship.heading))
        thrust = 1.0 if dist > desired_dist else (-0.5 if dist < desired_dist * 0.7 else 0.0)

        accel = vec_scale(forward_dir, thrust * ship.max_speed * 1.5)
        ship.velocity = vec_add(ship.velocity, vec_scale(accel, dt))

        # Speed clamping
        speed = vec_distance((0, 0), ship.velocity)
        if speed > ship.max_speed:
            ship.velocity = vec_scale(vec_normalize(ship.velocity), ship.max_speed)

        # Position integration
        ship.pos = vec_add(ship.pos, vec_scale(ship.velocity, dt))

    def _fire_weapon(
        self,
        ship: Ship,
        turret: "TurretMount",
        target_pos: Vector2,
        target_ship: Ship | None,
    ) -> None:
        """Trigger weapon firing and spawn projectile or resolve hitscan immediately."""
        turret.cooldown_timer = turret.weapon.cooldown
        rotated_offset = rotate_point(turret.offset, ship.heading)
        spawn_pos = vec_add(ship.pos, rotated_offset)

        # 1. Hitscan (Beam Laser or Point Defense)
        if turret.weapon.projectile_speed <= 0.0:
            if turret.weapon.weapon_type == WeaponType.POINT_DEFENSE:
                # Intercept nearest hostile missile
                missile = self._find_missile_target(ship, turret.weapon.range)
                if missile:
                    missile.hp -= turret.weapon.damage * 6.0  # 6x multiplier against missiles
                    return
            if target_ship and target_ship.is_alive:
                dist = vec_distance(spawn_pos, target_ship.pos)
                if dist <= turret.weapon.range:
                    if target_ship.hull_class == "strike_craft":
                        # Full damage against unarmored strike craft
                        import dataclasses
                        swarm_w = dataclasses.replace(
                            turret.weapon,
                            shield_multiplier=1.0,
                            armor_multiplier=1.0,
                            hull_multiplier=1.0,
                        )
                        target_ship.take_damage(turret.weapon.damage, swarm_w)
                    else:
                        target_ship.take_damage(turret.weapon.damage, turret.weapon)
            return

        # 2. Physical Projectile (Railgun, Plasma, Missile)
        self.projectile_counter += 1
        to_target = vec_normalize(vec_sub(target_pos, spawn_pos))
        proj_vel = vec_scale(to_target, turret.weapon.projectile_speed)

        lifetime = turret.weapon.range / turret.weapon.projectile_speed * 1.2
        proj = Projectile(
            id=f"proj_{self.projectile_counter}",
            weapon_type=turret.weapon.weapon_type,
            damage=turret.weapon.damage,
            owner_id=ship.id,
            owner_team=ship.team,
            pos=spawn_pos,
            velocity=proj_vel,
            lifetime=lifetime,
            target_id=target_ship.id if target_ship else None,
        )
        self.projectiles.append(proj)

    def _update_projectiles(self, dt: float, alive_ships: list[Ship]) -> None:
        """Move active projectiles, test collisions, and apply damage."""
        active: list[Projectile] = []

        for p in self.projectiles:
            p.lifetime -= dt
            if p.lifetime <= 0.0 or p.hp <= 0.0:
                continue

            # Move projectile with continuous ray sweep collision
            old_pos = p.pos
            p.pos = vec_add(old_pos, vec_scale(p.velocity, dt))

            # Test collision against enemy ships
            hit = False
            for ship in alive_ships:
                if ship.team == p.owner_team:
                    continue
                from src.engine.math2d import dist_to_segment

                if dist_to_segment(ship.pos, old_pos, p.pos) <= ship.size:
                    from src.engine.constants import WEAPON_DEFINITIONS

                    weapon = WEAPON_DEFINITIONS[p.weapon_type]
                    ship.take_damage(p.damage, weapon)
                    hit = True
                    break

            if not hit:
                active.append(p)

        self.projectiles = active
