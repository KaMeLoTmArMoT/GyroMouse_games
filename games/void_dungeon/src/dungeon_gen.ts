import { DungeonLevel } from "./level";
import { TileType } from "./types";
import { SeededRandom } from "./utils/seedrandom";

export interface Room {
	x: number;
	y: number;
	width: number;
	height: number;
	centerX: number;
	centerY: number;
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
			if (node.width / node.height >= 1.5)
				splitHorizontally = false; // split vertically if wide
			else if (node.height / node.width >= 1.5) splitHorizontally = true; // split horizontally if tall

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

		// Create rooms in leaf nodes
		const createRooms = (node: BSPNode) => {
			if (node.leftChild || node.rightChild) {
				if (node.leftChild) createRooms(node.leftChild);
				if (node.rightChild) createRooms(node.rightChild);
			} else {
				// Leaf node: create a room
				const roomWidth = rng.nextInt(
					Math.max(4, Math.floor(node.width * 0.6)),
					node.width - 2,
				);
				const roomHeight = rng.nextInt(
					Math.max(4, Math.floor(node.height * 0.6)),
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

				const room: Room = {
					x: roomX,
					y: roomY,
					width: roomWidth,
					height: roomHeight,
					centerX: Math.floor(roomX + roomWidth / 2),
					centerY: Math.floor(roomY + roomHeight / 2),
				};

				node.room = room;
				rooms.push(room);

				// Carve room floor tiles
				for (let ry = room.y; ry < room.y + room.height; ry++) {
					for (let rx = room.x; rx < room.x + room.width; rx++) {
						level.setTile(rx, ry, TileType.FLOOR);
					}
				}
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

		// Helper to find a leaf room
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
		}

		return level;
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
			// Move horizontally first, then vertically
			while (currX !== x2) {
				level.setTile(currX, currY, TileType.FLOOR);
				currX += Math.sign(x2 - currX);
			}
			while (currY !== y2) {
				level.setTile(currX, currY, TileType.FLOOR);
				currY += Math.sign(y2 - currY);
			}
		} else {
			// Move vertically first, then horizontally
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
