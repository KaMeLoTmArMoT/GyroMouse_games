import type { SharedAudioManager } from "../../../../shared/audioManager";
import type { EffectSystem } from "../effects/effects";
import type { MapObject } from "../entities/mapObject";
import type { Worm } from "../entities/worm";
import { Projectile } from "../physics/projectile";
import type { TerrainManager } from "../terrain/terrainManager";
import type { TeamAmmo, TurnPhase } from "../types";
import { PROJECTILE_MAX_SPEED } from "../types";
import { WEAPON_LIST } from "../ui/hud";

export class WeaponController {
	public activeWeaponIndex: number = 0;
	public isCharging: boolean = false;
	public chargePower: number = 0.0;
	public chargeSpeed: number = 0.025; // 30fps

	public teamAmmo: Record<"player" | "ai", TeamAmmo> = {
		player: {},
		ai: {},
	};

	public resetAmmo(): void {
		const defaultAmmo: TeamAmmo = {
			grenade: 4,
			cluster: 2,
			acid_bomb: 2,
			sand_bomb: 3,
			drill: 2,
			mortar: 2,
			dynamite: 1,
			shotgun: 3,
			rifle: 5,
		};
		this.teamAmmo = {
			player: { ...defaultAmmo },
			ai: { ...defaultAmmo },
		};
	}

	public ensureActiveWeaponHasAmmo(
		activeWorm: Worm | null,
		setPlayerWeaponIndex: (idx: number) => void,
	): void {
		const team = (activeWorm?.team ?? "player") as "player" | "ai";
		const ammo = this.teamAmmo[team];
		const hasAmmo = (wid: string) =>
			wid === "bazooka" || (ammo[wid as keyof TeamAmmo] ?? 0) > 0;

		if (hasAmmo(WEAPON_LIST[this.activeWeaponIndex].id)) return;

		const bazookaIdx = WEAPON_LIST.findIndex((w) => w.id === "bazooka");
		this.activeWeaponIndex = bazookaIdx;
		if (team === "player") {
			setPlayerWeaponIndex(bazookaIdx);
		}
	}

	public fireActiveWeapon(
		activeWorm: Worm | null,
		worms: Worm[],
		terrain: TerrainManager,
		mapObjects: MapObject[],
		projectiles: Projectile[],
		effects: EffectSystem,
		audioManager: SharedAudioManager,
		setPhase: (phase: TurnPhase) => void,
		setRepositionTimer: (sec: number) => void,
	): void {
		this.isCharging = false;
		if (!activeWorm) return;

		const weapon = WEAPON_LIST[this.activeWeaponIndex];
		const team = activeWorm.team as "player" | "ai";
		const ammoCount = this.teamAmmo[team][weapon.id];

		// Guard: no ammo
		if (ammoCount !== undefined && ammoCount <= 0) {
			this.ensureActiveWeaponHasAmmo(activeWorm, () => {});
			setPhase("WEAPON_SELECT");
			audioManager.playTone(220, 0.1, "square");
			return;
		}

		const tip = activeWorm.getCannonTip();
		const rad = (activeWorm.aimAngle * Math.PI) / 180;
		const launchSpeed =
			Math.max(0.15, this.chargePower) * PROJECTILE_MAX_SPEED[weapon.id];

		effects.spawnMuzzleFlash(tip.x, tip.y, rad);

		const vx = Math.cos(rad) * launchSpeed;
		const vy = Math.sin(rad) * launchSpeed;

		if (weapon.id === "shotgun") {
			audioManager.playHit(1.5);
			effects.spawnTracer(tip.x, tip.y, rad, 250, "#fbbf24");
			const rayLen = 250;
			const rayStep = 4;
			const shotDamage = 35;

			const shootRay = (damageMult: number) => {
				const hitWormsThisRay = new Set<string>();
				const hitObjsThisRay = new Set<string>();

				for (let d = 0; d < rayLen; d += rayStep) {
					const rx = tip.x + Math.cos(rad) * d;
					const ry = tip.y + Math.sin(rad) * d;

					if (terrain.isSolidAt(rx, ry)) {
						terrain.explode(rx, ry, 18);
						effects.spawnFlash(rx, ry, 12);
						effects.spawnSparks(rx, ry, 10, 1, 4, "#fbbf24");
						break;
					}

					for (const w of worms) {
						if (w !== activeWorm && w.isAlive && !hitWormsThisRay.has(w.id)) {
							if (Math.hypot(w.x - rx, w.y - ry) < 16) {
								hitWormsThisRay.add(w.id);
								w.takeDamage(Math.floor(shotDamage * damageMult));
								const kAngle = Math.atan2(w.y - tip.y, w.x - tip.x);
								w.vx += Math.cos(kAngle) * 5;
								w.vy += Math.sin(kAngle) * 4 - 2;
							}
						}
					}

					for (const obj of mapObjects) {
						if (!obj.isDestroyed && !hitObjsThisRay.has(obj.id)) {
							if (Math.hypot(obj.x - rx, obj.y - ry) < 16) {
								hitObjsThisRay.add(obj.id);
								obj.takeDamage(Math.floor(shotDamage * damageMult));
							}
						}
					}
				}
			};

			shootRay(1.0);
			shootRay(0.75);

			setPhase("PROJECTILE_FLIGHT");
		} else {
			audioManager.playTone(220, 0.15, "sawtooth");
			if (weapon.id === "rifle") {
				effects.spawnTracer(tip.x, tip.y, rad, 300, "rgba(103, 232, 249, 0.8)");
			}
			const fuseTime =
				weapon.id === "dynamite" ? 4 : weapon.id === "mortar" ? 2.5 : 3;
			projectiles.push(
				new Projectile(
					weapon.id,
					tip.x,
					tip.y,
					vx,
					vy,
					activeWorm.team,
					fuseTime,
				),
			);

			if (weapon.id === "dynamite") {
				setPhase("REPOSITION");
				setRepositionTimer(3.5);
			} else {
				setPhase("PROJECTILE_FLIGHT");
			}
		}

		if (ammoCount !== undefined) {
			this.teamAmmo[team][weapon.id] = ammoCount - 1;
		}
	}
}
