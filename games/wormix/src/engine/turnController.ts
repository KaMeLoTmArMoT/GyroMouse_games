import type { SharedAudioManager } from "../../../../shared/audioManager";
import type { Worm } from "../entities/worm";
import type { TerrainManager } from "../terrain/terrainManager";
import type {
	AIDifficulty,
	LobbyConfig,
	MatchSaveData,
	TeamAmmo,
	TurnPhase,
} from "../types";

export class TurnController {
	public phase: TurnPhase = "MENU";
	public activeWormIndex: number = 0;
	public playerWeaponIndex: number = 0;
	public turnCount: number = 0;

	public turnTimer: number = 45.0; // 45s countdown
	public repositionTimer: number = 0;
	public windX: number = 0.0;
	public aiDifficulty: AIDifficulty = "normal";

	public lobbyConfig: LobbyConfig = {
		teamSize: 2,
		wormHealth: 100,
		gameMode: "deathmatch",
		mapId: "random",
		aiDifficulty: "normal",
		matchType: "ai",
	};

	public getActiveWorm(worms: Worm[]): Worm | null {
		return worms[this.activeWormIndex] || null;
	}

	public updateWind(): void {
		if (this.lobbyConfig.enableWind) {
			this.windX = (Math.random() - 0.5) * 5.0; // -2.5 to +2.5
		} else {
			this.windX = 0;
		}
	}

	public checkTurnEnd(
		worms: Worm[],
		audioManager: SharedAudioManager,
		onTurnStart: () => void,
		onGameOver: () => void,
		saveMatchStateFn: () => void,
	): void {
		const redAlive = worms.filter(
			(w) => w.team === "player" && w.isAlive,
		).length;
		const blueAlive = worms.filter((w) => w.team === "ai" && w.isAlive).length;

		if (redAlive === 0 || blueAlive === 0) {
			this.phase = "GAME_OVER";
			audioManager.playWin();
			onGameOver();
			return;
		}

		// Alternating team rotation
		const currentWorm = worms[this.activeWormIndex];
		const targetTeam = currentWorm?.team === "player" ? "ai" : "player";

		let nextIdx = (this.activeWormIndex + 1) % worms.length;
		let attempts = 0;
		while (attempts < worms.length * 2) {
			const candidate = worms[nextIdx];
			if (candidate?.isAlive && candidate.team === targetTeam) {
				break;
			}
			nextIdx = (nextIdx + 1) % worms.length;
			attempts++;
		}

		this.activeWormIndex = nextIdx;
		const nextWorm = worms[nextIdx];
		nextWorm.resetTurnFlags();

		this.turnCount++;
		this.phase = "MOVE";
		this.turnTimer = 45.0;
		this.repositionTimer = 0;
		this.updateWind();

		onTurnStart();
		saveMatchStateFn();
	}

	public saveMatchState(
		worms: Worm[],
		teamAmmo: Record<"player" | "ai", TeamAmmo>,
		terrain: TerrainManager,
	): void {
		if (
			this.phase === "MENU" ||
			this.phase === "EDITOR" ||
			this.phase === "GAME_OVER"
		) {
			return;
		}

		const saveObj: MatchSaveData = {
			id: `save_${Date.now()}`,
			timestamp: Date.now(),
			dateString: new Date().toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			}),
			lobbyConfig: this.lobbyConfig,
			worms: worms.map((w) => ({
				id: w.id,
				name: w.name,
				team: w.team,
				x: w.x,
				y: w.y,
				health: w.health,
				maxHealth: w.maxHealth,
				personality: w.personality,
				isAlive: w.isAlive,
			})),
			activeWormIndex: this.activeWormIndex,
			playerWeaponIndex: this.playerWeaponIndex,
			teamAmmo,
			windX: this.windX,
			turnCount: this.turnCount,
			terrainData: {
				gridData: Array.from(terrain.grid),
				waterY: terrain.waterY,
				width: terrain.width,
				height: terrain.height,
			},
		};

		try {
			const existingJson = localStorage.getItem("wormix_saved_matches");
			let saves: MatchSaveData[] = existingJson ? JSON.parse(existingJson) : [];
			saves.unshift(saveObj);
			saves = saves.slice(0, 3);
			localStorage.setItem("wormix_saved_matches", JSON.stringify(saves));
		} catch (err) {
			console.warn("Failed to save match state:", err);
		}
	}
}
