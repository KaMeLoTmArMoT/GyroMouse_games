import type { CustomMapData } from "../types";

const STORAGE_KEY = "wormix_saved_maps";

export class MapStorage {
	public static getPresetMaps(width: number, height: number): CustomMapData[] {
		const waterY = height - 40;
		const baseGroundY = height * 0.62;

		// 1. Archipelago (Floating Islands)
		const archipelagoHeights = new Array(width).fill(waterY);
		for (let x = 0; x < width; x++) {
			if (
				(x > width * 0.15 && x < width * 0.35) ||
				(x > width * 0.65 && x < width * 0.85)
			) {
				archipelagoHeights[x] =
					baseGroundY -
					Math.sin(((x % (width * 0.2)) / (width * 0.2)) * Math.PI) * 80;
			}
		}

		const map1: CustomMapData = {
			id: "preset_archipelago",
			name: "🏝️ Floating Archipelago",
			createdAt: Date.now(),
			width,
			height,
			waterY,
			terrainHeights: archipelagoHeights,
			spawnPoints: [
				{ x: width * 0.22, y: baseGroundY - 90, team: "player" },
				{ x: width * 0.28, y: baseGroundY - 90, team: "player" },
				{ x: width * 0.72, y: baseGroundY - 90, team: "ai" },
				{ x: width * 0.78, y: baseGroundY - 90, team: "ai" },
			],
			mapObjects: [
				{ id: "b1", type: "barrel", x: width * 0.25, y: baseGroundY - 95 },
				{ id: "m1", type: "landmine", x: width * 0.75, y: baseGroundY - 95 },
				{ id: "c1", type: "health_crate", x: width * 0.5, y: waterY - 50 },
			],
			waterBodies: [],
		};

		// 2. Twin Forts
		const fortsHeights = new Array(width).fill(waterY);
		for (let x = 0; x < width; x++) {
			let h = baseGroundY + Math.sin(x * 0.005) * 30;
			if (
				(x > width * 0.1 && x < width * 0.3) ||
				(x > width * 0.7 && x < width * 0.9)
			) {
				h -= 90; // Fort towers
			}
			fortsHeights[x] = h;
		}

		const map2: CustomMapData = {
			id: "preset_twin_forts",
			name: "🏰 Twin Fortresses",
			createdAt: Date.now(),
			width,
			height,
			waterY,
			terrainHeights: fortsHeights,
			spawnPoints: [
				{ x: width * 0.15, y: baseGroundY - 110, team: "player" },
				{ x: width * 0.25, y: baseGroundY - 110, team: "player" },
				{ x: width * 0.75, y: baseGroundY - 110, team: "ai" },
				{ x: width * 0.85, y: baseGroundY - 110, team: "ai" },
			],
			mapObjects: [
				{ id: "b1", type: "barrel", x: width * 0.2, y: baseGroundY - 115 },
				{ id: "b2", type: "barrel", x: width * 0.8, y: baseGroundY - 115 },
				{ id: "c1", type: "health_crate", x: width * 0.5, y: baseGroundY - 20 },
			],
			waterBodies: [],
		};

		// 3. Iron Citadel (Acid-Immune Bunker Towers)
		const citadelHeights = new Array(width).fill(baseGroundY);
		for (let x = 0; x < width; x++) {
			if (
				(x > width * 0.12 && x < width * 0.28) ||
				(x > width * 0.72 && x < width * 0.88)
			) {
				citadelHeights[x] = baseGroundY - 110;
			}
		}

		const map3: CustomMapData = {
			id: "preset_iron_citadel",
			name: "⚙️ Iron Citadel",
			createdAt: Date.now(),
			width,
			height,
			waterY,
			terrainHeights: citadelHeights,
			terrainMaterials: new Array(width).fill("#64748b"),
			spawnPoints: [
				{ x: width * 0.18, y: baseGroundY - 125, team: "player" },
				{ x: width * 0.24, y: baseGroundY - 125, team: "player" },
				{ x: width * 0.76, y: baseGroundY - 125, team: "ai" },
				{ x: width * 0.82, y: baseGroundY - 125, team: "ai" },
			],
			mapObjects: [
				{ id: "b1", type: "barrel", x: width * 0.2, y: baseGroundY - 130 },
				{ id: "b2", type: "barrel", x: width * 0.8, y: baseGroundY - 130 },
				{ id: "m1", type: "landmine", x: width * 0.5, y: baseGroundY - 15 },
			],
			waterBodies: [],
		};

		// 4. Volcano Acid Crater
		const volcanoHeights = new Array(width).fill(baseGroundY);
		for (let x = 0; x < width; x++) {
			const distFromCenter = Math.abs(x - width * 0.5);
			if (distFromCenter < width * 0.35) {
				volcanoHeights[x] =
					baseGroundY +
					60 -
					Math.sin((distFromCenter / (width * 0.35)) * Math.PI) * 110;
			}
		}

		const map4: CustomMapData = {
			id: "preset_volcano_crater",
			name: "🌋 Volcano Acid Crater",
			createdAt: Date.now(),
			width,
			height,
			waterY,
			terrainHeights: volcanoHeights,
			spawnPoints: [
				{ x: width * 0.18, y: baseGroundY - 70, team: "player" },
				{ x: width * 0.28, y: baseGroundY - 20, team: "player" },
				{ x: width * 0.72, y: baseGroundY - 20, team: "ai" },
				{ x: width * 0.82, y: baseGroundY - 70, team: "ai" },
			],
			mapObjects: [
				{ id: "m1", type: "landmine", x: width * 0.5, y: baseGroundY + 50 },
				{
					id: "c1",
					type: "health_crate",
					x: width * 0.5,
					y: baseGroundY - 100,
				},
			],
			waterBodies: [],
		};

		return [map1, map2, map3, map4];
	}

	public static getSavedMaps(): CustomMapData[] {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch {
			return [];
		}
	}

	public static saveMap(map: CustomMapData): void {
		map.updatedAt = Date.now();
		const saved = MapStorage.getSavedMaps();
		const existingIdx = saved.findIndex((m) => m.id === map.id);
		if (existingIdx !== -1) {
			saved[existingIdx] = map;
		} else {
			saved.push(map);
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
	}

	public static deleteMap(mapId: string): void {
		const saved = MapStorage.getSavedMaps().filter((m) => m.id !== mapId);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
	}

	public static renameMap(mapId: string, newName: string): void {
		const saved = MapStorage.getSavedMaps();
		const map = saved.find((m) => m.id === mapId);
		if (map) {
			map.name = newName;
			map.updatedAt = Date.now();
			localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
		}
	}

	public static cloneMap(mapId: string): CustomMapData | null {
		const saved = MapStorage.getSavedMaps();
		const original = saved.find((m) => m.id === mapId);
		if (!original) return null;

		const cloned: CustomMapData = {
			...original,
			id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			name: `${original.name} (Copy)`,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			terrainHeights: [...original.terrainHeights],
			spawnPoints: original.spawnPoints.map((sp) => ({ ...sp })),
			mapObjects: original.mapObjects.map((obj) => ({ ...obj })),
			waterBodies: original.waterBodies.map((wb) => ({ ...wb })),
			gridData: original.gridData ? [...original.gridData] : undefined,
			terrainMaterials: original.terrainMaterials
				? [...original.terrainMaterials]
				: undefined,
		};

		saved.push(cloned);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
		return cloned;
	}

	public static exportJSON(map: CustomMapData): void {
		const blob = new Blob([JSON.stringify(map, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${map.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.wormix.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	public static importJSON(file: File): Promise<CustomMapData> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const map = JSON.parse(e.target?.result as string) as CustomMapData;
					if (map.id && map.name && map.terrainHeights) {
						MapStorage.saveMap(map);
						resolve(map);
					} else {
						reject(new Error("Invalid map file format."));
					}
				} catch (err) {
					reject(err);
				}
			};
			reader.readAsText(file);
		});
	}
}
