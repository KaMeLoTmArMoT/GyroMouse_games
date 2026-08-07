import { simulateShot } from "../physics/ballistics";
import type { WeaponId } from "../types";
import type { AIPlanner, AITurnPlan, PlannerParams } from "./wormAI";

export interface MCTSAction {
	x: number;
	weaponId: WeaponId;
	angle: number;
	power: number;
}

export class MCTSNode {
	public parent: MCTSNode | null = null;
	public children: MCTSNode[] = [];
	public visits: number = 0;
	public totalReward: number = 0;
	public action: MCTSAction;
	public isExpanded: boolean = false;

	constructor(action: MCTSAction, parent: MCTSNode | null = null) {
		this.action = action;
		this.parent = parent;
	}

	public ucb1(totalVisits: number, c: number = Math.SQRT2): number {
		if (this.visits === 0) return Infinity;
		return (
			this.totalReward / this.visits +
			c * Math.sqrt(Math.log(totalVisits + 1) / this.visits)
		);
	}
}

export class MCTSPlanner implements AIPlanner {
	private params: PlannerParams;
	private root: MCTSNode;
	private currentStepCount: number = 0;
	public isDone: boolean = false;
	private bestAction: MCTSAction;
	private startTime: number = Date.now();

	constructor(params: PlannerParams) {
		this.params = params;
		const initialPos = params.fixedPositionX ?? params.aiWorm.x;

		const enemies = params.allWorms.filter(
			(w) => w.isAlive && w.team !== params.aiWorm.team,
		);
		let isEnemyRight = params.aiWorm.facingRight;
		if (enemies.length > 0) {
			let closestX = enemies[0].x;
			let minD = Infinity;
			for (const e of enemies) {
				const d = Math.hypot(e.x - params.aiWorm.x, e.y - params.aiWorm.y);
				if (d < minD) {
					minD = d;
					closestX = e.x;
				}
			}
			isEnemyRight = closestX >= params.aiWorm.x;
		}

		const defaultAngle = isEnemyRight ? -45 : -135;

		this.bestAction = {
			x: initialPos,
			weaponId: "bazooka",
			angle: defaultAngle,
			power: 0.6,
		};
		this.root = new MCTSNode(this.bestAction);
		this.expandNode(this.root);
	}

	private expandNode(node: MCTSNode): void {
		if (node.isExpanded) return;

		const { aiWorm, availableAmmo, allWorms } = this.params;
		const candidateX = this.params.fixedPositionX ?? aiWorm.x;

		const enemies = allWorms.filter((w) => w.isAlive && w.team !== aiWorm.team);
		let isEnemyRight = aiWorm.facingRight;
		if (enemies.length > 0) {
			let closestX = enemies[0].x;
			let minD = Infinity;
			for (const e of enemies) {
				const d = Math.hypot(e.x - aiWorm.x, e.y - aiWorm.y);
				if (d < minD) {
					minD = d;
					closestX = e.x;
				}
			}
			isEnemyRight = closestX >= aiWorm.x;
		}

		// Valid air launch angles towards enemy side
		const angles = isEnemyRight
			? [-80, -70, -60, -45, -30, -15]
			: [-100, -110, -120, -135, -150, -165];

		// Prioritize infinite signature Bazooka and direct fire weapons
		const weapons: WeaponId[] = (
			[
				"bazooka",
				"grenade",
				"rifle",
				"shotgun",
				"cluster",
				"acid_bomb",
				"dynamite",
				"mortar",
				"drill",
			] as WeaponId[]
		).filter((id) => id === "bazooka" || (availableAmmo[id] ?? 0) > 0);

		const powers = [0.35, 0.6, 0.85, 1.0];

		for (const wid of weapons) {
			for (const ang of angles) {
				for (const pow of powers) {
					const child = new MCTSNode(
						{
							x: candidateX,
							weaponId: wid,
							angle: ang,
							power: pow,
						},
						node,
					);
					node.children.push(child);
				}
			}
		}

		node.isExpanded = true;
	}

	public step(sliceMs: number): void {
		if (this.isDone) return;

		const endTime = Date.now() + sliceMs;
		let highestScore = -Infinity;

		while (Date.now() < endTime) {
			this.currentStepCount++;
			if (Date.now() - this.startTime >= this.params.deadlineMs) {
				this.isDone = true;
				break;
			}

			// 1. Selection
			let curr = this.root;
			while (curr.isExpanded && curr.children.length > 0) {
				let bestChild: MCTSNode | null = null;
				let bestUCB = -Infinity;

				for (const child of curr.children) {
					const score = child.ucb1(curr.visits);
					if (score > bestUCB) {
						bestUCB = score;
						bestChild = child;
					}
				}

				if (!bestChild) break;
				curr = bestChild;
			}

			// 2. Expansion
			if (!curr.isExpanded && curr.visits > 0) {
				this.expandNode(curr);
				if (curr.children.length > 0) {
					curr = curr.children[0];
				}
			}

			// 3. Rollout / Simulation
			const action = curr.action;
			const shot = simulateShot(
				action.weaponId,
				action.x,
				this.params.aiWorm.y - 12,
				action.angle,
				action.power,
				this.params.windX,
				this.params.terrain,
				this.params.allWorms,
				this.params.aiWorm,
				this.params.mapObjects,
			);

			// 4. Tactical Evaluation & Zero-Tolerance for Ally/Self Damage
			if (shot.selfDamage > 0 || shot.allyDamage > 0) {
				const reward = -99999;
				let backNode: MCTSNode | null = curr;
				while (backNode) {
					backNode.visits++;
					backNode.totalReward += reward;
					backNode = backNode.parent;
				}
				continue;
			}

			let weaponBonus = 0;
			if (action.weaponId === "bazooka") {
				weaponBonus = 25;
			} else if (action.weaponId === "grenade") {
				weaponBonus = 15;
			} else if (action.weaponId === "rifle" || action.weaponId === "shotgun") {
				weaponBonus = 20;
			} else if (action.weaponId === "drill") {
				weaponBonus = 5;
			}

			const effectiveDamage = Math.min(60, shot.enemyDamage);

			const reward =
				effectiveDamage * 1.5 +
				shot.kills * 40 +
				shot.waterKnockouts * 50 +
				shot.chainBonus +
				weaponBonus +
				(Math.random() - 0.5) * 6;

			if (reward > highestScore) {
				highestScore = reward;
				this.bestAction = action;
			}

			// 5. Backpropagation
			let backNode: MCTSNode | null = curr;
			while (backNode) {
				backNode.visits++;
				backNode.totalReward += reward;
				backNode = backNode.parent;
			}
		}

		if (
			this.currentStepCount >= 1000 ||
			Date.now() - this.startTime >= this.params.deadlineMs
		) {
			this.isDone = true;
		}
	}

	public getPlan(): AITurnPlan {
		return {
			targetAngle: this.bestAction.angle,
			targetPower: this.bestAction.power,
			weaponId: this.bestAction.weaponId,
			walkDir: 0,
			targetX: this.bestAction.x,
			personality: this.params.personality,
			sims: this.currentStepCount,
		};
	}
}
