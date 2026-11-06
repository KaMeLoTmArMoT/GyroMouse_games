import { isCapitalShip } from "../engine/shieldGeometry";
import {
  SHIELD_HAVEN_SLOTS,
  type ShieldHavenSlotId,
  type ShieldHavenSystem,
  shieldHavenSlotPosition,
} from "../engine/shieldHaven";
import type { ShipState } from "../types/combat";

export function renderHavenTethers(
  ctx: CanvasRenderingContext2D,
  ships: readonly ShipState[],
  time: number,
): void {
  const byId = new Map(ships.map((ship) => [ship.id, ship]));
  for (const guest of ships) {
    if (!guest.isAlive || guest.havenState !== "tethered" || !guest.havenParentId) continue;
    const parent = byId.get(guest.havenParentId);
    if (!parent?.isAlive) continue;

    const color = guest.team === 0 ? "#67e8f9" : "#fb7185";
    const dx = guest.pos[0] - parent.pos[0];
    const dy = guest.pos[1] - parent.pos[1];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = guest.team === 0 ? "#a5f3fc" : "#fbbf24";
    ctx.globalAlpha = 0.45 + 0.1 * Math.sin(time * 4);
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -time * 4;
    ctx.beginPath();
    ctx.moveTo(parent.pos[0], parent.pos[1]);
    ctx.lineTo(guest.pos[0], guest.pos[1]);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const progress = (time * 0.5 + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(parent.pos[0] + dx * progress, parent.pos[1] + dy * progress, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

export function renderHavenSlots(
  ctx: CanvasRenderingContext2D,
  parent: ShipState,
  ships: readonly ShipState[],
  haven: ShieldHavenSystem,
): void {
  if (!parent.isAlive || !isCapitalShip(parent)) return;
  const occupied = new Set(
    ships
      .map((ship) => haven.getLease(ship.id))
      .filter((lease) => lease?.parentId === parent.id)
      .map((lease) => lease?.slotId),
  );
  ctx.save();
  ctx.strokeStyle = parent.team === 0 ? "#67e8f9" : "#fb7185";
  ctx.shadowColor = ctx.strokeStyle;
  ctx.lineWidth = 1.2;
  for (const slot of Object.keys(SHIELD_HAVEN_SLOTS) as ShieldHavenSlotId[]) {
    const [x, y] = shieldHavenSlotPosition(parent, slot);
    const active = occupied.has(slot);
    ctx.globalAlpha = active ? 0.85 : 0.25;
    ctx.shadowBlur = active ? 8 : 0;
    ctx.setLineDash(active ? [] : [3, 3]);
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
