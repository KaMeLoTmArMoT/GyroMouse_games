import type { ShipState } from "../types/combat";

/** A cache instance owns one resolution and one static hull drawing implementation. */
export class ShipSpriteCache {
  private sprites = new Map<ShipState["hullClass"], Map<ShipState["team"], OffscreenCanvas>>();
  private readonly size: number;
  private readonly drawHull: (
    ctx: OffscreenCanvasRenderingContext2D,
    hullClass: ShipState["hullClass"],
    team: ShipState["team"],
    size: number,
  ) => void;

  constructor(
    size: number,
    drawHull: (
      ctx: OffscreenCanvasRenderingContext2D,
      hullClass: ShipState["hullClass"],
      team: ShipState["team"],
      size: number,
    ) => void,
  ) {
    this.size = size;
    this.drawHull = drawHull;
  }

  /** Returns null when offscreen rendering is unavailable; callers can use vector rendering. */
  get(hullClass: ShipState["hullClass"], team: ShipState["team"]): OffscreenCanvas | null {
    const cached = this.sprites.get(hullClass)?.get(team);
    if (cached) return cached;
    if (typeof OffscreenCanvas === "undefined") return null;

    const canvas = new OffscreenCanvas(this.size, this.size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    this.drawHull(ctx, hullClass, team, this.size);
    let teams = this.sprites.get(hullClass);
    if (!teams) {
      teams = new Map();
      this.sprites.set(hullClass, teams);
    }
    teams.set(team, canvas);
    return canvas;
  }

  clear(): void {
    this.sprites.clear();
  }
}
