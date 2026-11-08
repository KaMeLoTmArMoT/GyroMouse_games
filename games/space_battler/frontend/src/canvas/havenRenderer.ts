import { isCapitalShip } from "../engine/shieldGeometry";
import {
  SHIELD_HAVEN_SLOTS,
  type ShieldHavenSlotId,
  type ShieldHavenSystem,
  shieldHavenSlotPosition,
} from "../engine/shieldHaven";
import type { ShipState } from "../types/combat";

function isIncoming(guest: ShipState): boolean {
  return guest.isAlive && (guest.havenState === "seeking" || guest.havenState === "approaching");
}

function renderGuidance(
  ctx: CanvasRenderingContext2D,
  guest: ShipState,
  parent: ShipState,
  slot: ShieldHavenSlotId,
  time: number,
  color: string,
): void {
  const [x, y] = shieldHavenSlotPosition(parent, slot);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.65 + 0.15 * Math.sin(time * 4);
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([7, 5]);
  ctx.lineDashOffset = -time * 12;
  ctx.beginPath();
  ctx.moveTo(guest.pos[0], guest.pos[1]);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.restore();
}

export function renderHavenTethers(
  ctx: CanvasRenderingContext2D,
  ships: readonly ShipState[],
  time: number,
  selectedShipId?: string | null,
): void {
  const byId = new Map(ships.map((ship) => [ship.id, ship]));
  for (const guest of ships) {
    if (isIncoming(guest) && guest.havenParentId && guest.havenSlotId) {
      const parent = byId.get(guest.havenParentId);
      if (
        parent?.isAlive &&
        isCapitalShip(parent) &&
        (selectedShipId === guest.id || selectedShipId === parent.id) &&
        Object.hasOwn(SHIELD_HAVEN_SLOTS, guest.havenSlotId)
      ) {
        renderGuidance(ctx, guest, parent, guest.havenSlotId as ShieldHavenSlotId, time, "#67e8f9");
      }
    }
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
  haven: Pick<ShieldHavenSystem, "getLease">,
  time: number,
): void {
  if (!parent.isAlive || !isCapitalShip(parent)) return;
  const occupied = new Set<ShieldHavenSlotId>();
  const incoming = new Map<ShieldHavenSlotId, ShipState>();
  for (const guest of ships) {
    const lease = haven.getLease(guest.id);
    if (lease?.parentId !== parent.id) continue;
    occupied.add(lease.slotId);
    if (isIncoming(guest)) incoming.set(lease.slotId, guest);
  }
  for (const [slot, guest] of incoming) {
    renderGuidance(ctx, guest, parent, slot, time, "#fbbf24");
  }
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
    if (incoming.has(slot)) {
      ctx.save();
      ctx.strokeStyle = "#fbbf24";
      ctx.shadowColor = "#fbbf24";
      ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.7 + 0.2 * Math.sin(time * 4);
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = -time * 6;
      ctx.beginPath();
      ctx.arc(x, y, 10 + Math.sin(time * 4), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}
