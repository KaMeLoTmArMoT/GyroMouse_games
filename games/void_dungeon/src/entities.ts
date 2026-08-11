import { TILE_SIZE } from "./types";

export type KeyColor = "red" | "blue" | "green";

export const KEY_COLOR_HEX: Record<KeyColor, string> = {
	red: "#ef4444",
	blue: "#38bdf8",
	green: "#22c55e",
};

export interface KeyEntity {
	id: string;
	tileX: number;
	tileY: number;
	color: KeyColor;
	collected: boolean;
}

export class EntityManager {
	public keys: KeyEntity[] = [];

	public addKey(
		id: string,
		tileX: number,
		tileY: number,
		color: KeyColor,
	): void {
		this.keys.push({ id, tileX, tileY, color, collected: false });
	}

	public clear(): void {
		this.keys = [];
	}

	public renderKeys(
		ctx: CanvasRenderingContext2D,
		isTileVisible: (tx: number, ty: number) => boolean,
		time: number,
	): void {
		for (const key of this.keys) {
			if (key.collected) continue;

			// Render only if currently visible (or in debug reveal mode)
			if (!isTileVisible(key.tileX, key.tileY)) continue;

			const px = (key.tileX + 0.5) * TILE_SIZE;
			const py = (key.tileY + 0.5) * TILE_SIZE;

			// Floating bobbing motion
			const floatY = Math.sin(time * 4 + key.tileX) * 3;

			ctx.save();
			ctx.translate(px, py + floatY);

			// Key Glow
			const hexColor = KEY_COLOR_HEX[key.color];
			ctx.shadowColor = hexColor;
			ctx.shadowBlur = 10;

			// Draw Pixel Key Graphic
			ctx.fillStyle = hexColor;
			ctx.beginPath();
			ctx.arc(0, -4, 5, 0, Math.PI * 2); // Ring top
			ctx.fill();

			ctx.fillStyle = "#ffffff";
			ctx.beginPath();
			ctx.arc(0, -4, 2, 0, Math.PI * 2); // Ring hole
			ctx.fill();

			ctx.fillStyle = hexColor;
			ctx.fillRect(-1.5, -1, 3, 10); // Key shaft
			ctx.fillRect(0, 4, 3, 2); // Tooth 1
			ctx.fillRect(0, 7, 3, 2); // Tooth 2

			ctx.restore();
		}
	}
}
