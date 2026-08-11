import { CrateManager } from "./crates";
import type { KeyColor } from "./entities";
import { DungeonLevel } from "./level";
import { TileType } from "./types";
import { SeededRandom } from "./utils/seedrandom";

export type RoomShape = "rectangle" | "oval" | "diamond" | "cross";

export interface Room {
	x: number;
	y: number;
	width: number;
	height: number;
	centerX: number;
	centerY: number;
	shape: RoomShape;
}

interface BSPNode {
	x: number;
	y: number;
	width: number;
	height: number;
	leftChild?: BSPNode;
	rightChild?: BSPNode;
	room?: Room;
}

export class DungeonGenerator {
	public static generate(
		width: number = 40,
		height: number = 30,
		seed: string = "void-1",
	): DungeonLevel {
		const rng = new SeededRandom(seed);
		const level = new DungeonLevel(width, height);
		level.entities.clear();
		level.crateManager = new CrateManager();

		// Fill map with WALL tiles initially
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				level.setTile(x, y, TileType.WALL);
			}
		}

		// BSP Partitioning
		const root: BSPNode = { x: 1, y: 1, width: width - 2, height: height - 2 };
		const rooms: Room[] = [];
		const minLeafSize = 8;

		const splitNode = (node: BSPNode) => {
			if (node.width <= minLeafSize * 2 && node.height <= minLeafSize * 2) {
				return;
			}

			// Decide split direction
			let splitHorizontally = rng.nextBool() === 1;
			if (node.width / node.height >= 1.5) splitHorizontally = false;
			else if (node.height / node.width >= 1.5) splitHorizontally = true;

			const max = (splitHorizontally ? node.height : node.width) - minLeafSize;
			if (max <= minLeafSize) return;

			const splitPos = rng.nextInt(minLeafSize, max);

			if (splitHorizontally) {
				node.leftChild = {
					x: node.x,
					y: node.y,
					width: node.width,
					height: splitPos,
				};
				node.rightChild = {
					x: node.x,
					y: node.y + splitPos,
					width: node.width,
					height: node.height - splitPos,
				};
			} else {
				node.leftChild = {
					x: node.x,
					y: node.y,
					width: splitPos,
					height: node.height,
				};
				node.rightChild = {
					x: node.x + splitPos,
					y: node.y,
					width: node.width - splitPos,
					height: node.height,
				};
			}

			splitNode(node.leftChild);
			splitNode(node.rightChild);
		};

		splitNode(root);

		// Shapes palette
		const shapes: RoomShape[] = ["rectangle", "oval", "diamond", "cross"];

		// Create rooms in leaf nodes
		const createRooms = (node: BSPNode) => {
			if (node.leftChild || node.rightChild) {
				if (node.leftChild) createRooms(node.leftChild);
				if (node.rightChild) createRooms(node.rightChild);
			} else {
				// Leaf node: create a room
				const roomWidth = rng.nextInt(
					Math.max(4, Math.floor(node.width * 0.65)),
					node.width - 2,
				);
				const roomHeight = rng.nextInt(
					Math.max(4, Math.floor(node.height * 0.65)),
					node.height - 2,
				);
				const roomX = rng.nextInt(
					node.x + 1,
					node.x + node.width - roomWidth - 1,
				);
				const roomY = rng.nextInt(
					node.y + 1,
					node.y + node.height - roomHeight - 1,
				);

				const shape = rng.choice(shapes);

				const room: Room = {
					x: roomX,
					y: roomY,
					width: roomWidth,
					height: roomHeight,
					centerX: Math.floor(roomX + roomWidth / 2),
					centerY: Math.floor(roomY + roomHeight / 2),
					shape,
				};

				node.room = room;
				rooms.push(room);

				// Carve room floor based on shape
				DungeonGenerator.carveRoomShape(level, room);
			}
		};

		createRooms(root);

		// Connect rooms with corridors
		const connectNodes = (node: BSPNode) => {
			if (!node.leftChild || !node.rightChild) return;

			connectNodes(node.leftChild);
			connectNodes(node.rightChild);

			const leftRoom = getLeafRoom(node.leftChild);
			const rightRoom = getLeafRoom(node.rightChild);

			if (leftRoom && rightRoom) {
				DungeonGenerator.carveCorridor(
					level,
					leftRoom.centerX,
					leftRoom.centerY,
					rightRoom.centerX,
					rightRoom.centerY,
					rng,
				);
			}
		};

		connectNodes(root);

		function getLeafRoom(n: BSPNode): Room | undefined {
			if (n.room) return n.room;
			if (n.leftChild) {
				const r = getLeafRoom(n.leftChild);
				if (r) return r;
			}
			if (n.rightChild) {
				return getLeafRoom(n.rightChild);
			}
			return undefined;
		}

		// Ensure we have rooms
		if (rooms.length > 0) {
			// Spawn room (first room)
			const spawnRoom = rooms[0];
			level.spawnTile = { x: spawnRoom.centerX, y: spawnRoom.centerY };

			// Exit room (furthest room from spawn)
			let maxDist = -1;
			let exitRoom = rooms[rooms.length - 1];

			for (const r of rooms) {
				const dist = Math.hypot(
					r.centerX - spawnRoom.centerX,
					r.centerY - spawnRoom.centerY,
				);
				if (dist > maxDist) {
					maxDist = dist;
					exitRoom = r;
				}
			}

			level.exitTile = { x: exitRoom.centerX, y: exitRoom.centerY };
			level.setTile(exitRoom.centerX, exitRoom.centerY, TileType.EXIT_LOCKED);

			// Scatter 3 Keys (Red, Blue, Green) in distinct candidate rooms
			const candidateRooms = rooms.filter(
				(r) => r !== spawnRoom && r !== exitRoom,
			);

			// Shuffle candidates deterministically using rng
			for (let i = candidateRooms.length - 1; i > 0; i--) {
				const j = rng.nextInt(0, i);
				const temp = candidateRooms[i];
				candidateRooms[i] = candidateRooms[j];
				candidateRooms[j] = temp;
			}

			const keyColors: KeyColor[] = ["red", "blue", "green"];
			for (let k = 0; k < keyColors.length; k++) {
				const targetRoom = candidateRooms[k] || rooms[(k + 1) % rooms.length];
				const color = keyColors[k];
				const keyId = `key_${color}`;

				// Ensure key tile is walkable FLOOR
				level.setTile(targetRoom.centerX, targetRoom.centerY, TileType.KEY);
				level.entities.addKey(
					keyId,
					targetRoom.centerX,
					targetRoom.centerY,
					color,
				);
			}

			// Generate 1-2 Pitfall & Crate Puzzles in candidate rooms
			DungeonGenerator.placePitfallPuzzles(level, candidateRooms, rng);
		}

		return level;
	}

	private static placePitfallPuzzles(
		level: DungeonLevel,
		candidateRooms: Room[],
		rng: SeededRandom,
	): void {
		if (!level.crateManager) return;

		let crateCount = 0;
		const offsets = [
			{ hx: 0, hy: -1, cx: 0, cy: -2 },
			{ hx: 0, hy: 1, cx: 0, cy: 2 },
			{ hx: -1, hy: 0, cx: -2, cy: 0 },
			{ hx: 1, hy: 0, cx: 2, cy: 0 },
		];

		for (const room of candidateRooms) {
			if (crateCount >= 2) break;

			const offset = rng.choice(offsets);
			const holeX = room.centerX + offset.hx;
			const holeY = room.centerY + offset.hy;
			const crateX = room.centerX + offset.cx;
			const crateY = room.centerY + offset.cy;

			// Verify floor tiles
			if (
				level.getTile(holeX, holeY) === TileType.FLOOR &&
				level.getTile(crateX, crateY) === TileType.FLOOR
			) {
				level.setTile(holeX, holeY, TileType.HOLE);
				level.crateManager.addCrate(`crate_${crateCount + 1}`, crateX, crateY);
				crateCount++;
			}
		}
	}

	private static carveRoomShape(level: DungeonLevel, room: Room): void {
		const cx = room.centerX;
		const cy = room.centerY;
		const halfW = room.width / 2;
		const halfH = room.height / 2;

		for (let ry = room.y; ry < room.y + room.height; ry++) {
			for (let rx = room.x; rx < room.x + room.width; rx++) {
				const dx = (rx + 0.5 - cx) / halfW;
				const dy = (ry + 0.5 - cy) / halfH;

				let inside = false;

				switch (room.shape) {
					case "rectangle":
						inside = true;
						break;
					case "oval":
						inside = dx * dx + dy * dy <= 1.05;
						break;
					case "diamond":
						inside = Math.abs(dx) + Math.abs(dy) <= 1.1;
						break;
					case "cross":
						inside = Math.abs(dx) <= 0.45 || Math.abs(dy) <= 0.45;
						break;
				}

				if (inside) {
					level.setTile(rx, ry, TileType.FLOOR);
				}
			}
		}

		// Ensure center of room is always carved FLOOR for connectivity
		level.setTile(cx, cy, TileType.FLOOR);
	}

	private static carveCorridor(
		level: DungeonLevel,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		rng: SeededRandom,
	): void {
		let currX = x1;
		let currY = y1;

		if (rng.nextBool() === 1) {
			while (currX !== x2) {
				level.setTile(currX, currY, TileType.FLOOR);
				currX += Math.sign(x2 - currX);
			}
			while (currY !== y2) {
				level.setTile(currX, currY, TileType.FLOOR);
				currY += Math.sign(y2 - currY);
			}
		} else {
			while (currY !== y2) {
				level.setTile(currX, currY, TileType.FLOOR);
				currY += Math.sign(y2 - currY);
			}
			while (currX !== x2) {
				level.setTile(currX, currY, TileType.FLOOR);
				currX += Math.sign(x2 - currX);
			}
		}
		level.setTile(currX, currY, TileType.FLOOR);
	}
}
