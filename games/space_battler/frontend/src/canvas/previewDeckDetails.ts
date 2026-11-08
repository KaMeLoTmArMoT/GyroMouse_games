import { rotatePoint } from "../engine/math2d";
import type { ShipState, Vector2 } from "../types/combat";

interface DeckDetail {
  points: Vector2[];
  height: number;
  visor?: boolean;
  ribs?: Vector2[][];
}

/** Small armor plates follow the existing deck artwork and leave the weapon mounts clear. */
export function previewDeckDetails(ship: ShipState): DeckDetail[] {
  const details: DeckDetail[] = [];
  const add = (points: Vector2[], height: number, visor = false) =>
    details.push({ points, height, visor });
  const paired = (points: Vector2[], height: number, ribs?: [number[], number, number]) => {
    for (const side of [-1, 1]) {
      const plate: DeckDetail = { points: points.map(([x, y]) => [x, y * side]), height };
      if (ribs) {
        const [xs, inner, outer] = ribs;
        plate.ribs = xs.map((x) => [
          [x, inner * side],
          [x + 0.015, inner * side],
          [x - 0.015, outer * side],
          [x - 0.03, outer * side],
        ]);
      }
      details.push(plate);
    }
  };

  switch (ship.hullClass) {
    case "dreadnought":
      add(
        [
          [-0.19, -0.13],
          [0.03, -0.13],
          [0.08, -0.08],
          [0.08, 0.08],
          [0.03, 0.13],
          [-0.19, 0.13],
        ],
        0.07,
        true,
      );
      paired(
        [
          [-0.55, 0.52],
          [-0.42, 0.5],
          [0.08, 0.5],
          [0.14, 0.52],
          [0.07, 0.61],
          [-0.48, 0.61],
        ],
        0.045,
        [[-0.35, -0.15, 0.05], 0.52, 0.57],
      );
      paired(
        [
          [0.08, 0.14],
          [0.7, 0.13],
          [0.82, 0.24],
          [0.2, 0.31],
        ],
        0.035,
      );
      break;
    case "battleship":
      paired(
        [
          [-0.5, 0.4],
          [-0.38, 0.4],
          [0.06, 0.4],
          [0.2, 0.45],
          [0.12, 0.52],
          [-0.43, 0.54],
        ],
        0.045,
        [[-0.35, -0.15, 0.05], 0.41, 0.48],
      );
      paired(
        [
          [0.38, 0.2],
          [0.73, 0.2],
          [0.67, 0.28],
          [0.37, 0.33],
        ],
        0.03,
      );
      break;
    case "cruiser":
      paired(
        [
          [-0.42, 0.29],
          [-0.32, 0.27],
          [0.26, 0.27],
          [0.36, 0.32],
          [0.22, 0.36],
          [-0.39, 0.4],
        ],
        0.035,
        [[-0.3, -0.1, 0.1], 0.3, 0.35],
      );
      paired(
        [
          [0.46, 0.1],
          [0.78, 0.1],
          [0.68, 0.23],
          [0.46, 0.25],
        ],
        0.03,
      );
      break;
    case "carrier":
      paired(
        [
          [-0.32, 0.25],
          [0.4, 0.23],
          [0.55, 0.26],
          [0.35, 0.3],
          [-0.32, 0.3],
        ],
        0.025,
      );
      break;
    case "tender":
      paired(
        [
          [-0.48, 0.5],
          [-0.03, 0.5],
          [0.05, 0.55],
          [-0.48, 0.55],
        ],
        0.03,
      );
      break;
    case "corvette":
      paired(
        [
          [0.03, 0.29],
          [0.28, 0.28],
          [0.36, 0.32],
          [0.22, 0.38],
          [-0.02, 0.38],
        ],
        0.03,
      );
      break;
    case "missile_frigate":
      add(
        [
          [0.44, -0.07],
          [0.63, -0.05],
          [0.72, 0],
          [0.63, 0.05],
          [0.44, 0.07],
          [0.39, 0],
        ],
        0.045,
        true,
      );
      paired(
        [
          [-0.49, 0.3],
          [-0.37, 0.28],
          [0.15, 0.27],
          [0.25, 0.3],
          [0.12, 0.34],
          [-0.46, 0.36],
        ],
        0.025,
      );
      break;
    case "strike_craft":
      paired(
        [
          [-0.35, 0.22],
          [0.15, 0.09],
          [0.27, 0.1],
          [-0.3, 0.28],
        ],
        0.025,
      );
      break;
  }
  return details;
}

export function deckDetailCenter(detail: DeckDetail, size: number): Vector2 {
  const [x, y] = detail.points.reduce(([x, y], point) => [x + point[0], y + point[1]], [0, 0]);
  return [(x * size) / detail.points.length, (y * size) / detail.points.length];
}

/** Extrude each plate in screen-vertical direction, with beveled, lit top edges. */
export function drawPreviewDeckDetail(
  ctx: CanvasRenderingContext2D,
  ship: ShipState,
  detail: DeckDetail,
  depth: number,
): void {
  const s = ship.size;
  const alien = ship.team !== 0;
  const [ux, uy] = rotatePoint([0, -detail.height * s * depth], -ship.heading);
  const points = detail.points.map(([x, y]) => [x * s, y * s] as Vector2);
  ctx.save();
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 + ux, y2 + uy);
    ctx.lineTo(x1 + ux, y1 + uy);
    ctx.closePath();
    ctx.fillStyle = alien ? "#4b1d29" : "#1c3748";
    ctx.fill();
  }
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x + ux, y + uy);
    else ctx.lineTo(x + ux, y + uy);
  });
  ctx.closePath();
  ctx.fillStyle = alien ? "#80404b" : "#3b586a";
  ctx.fill();
  ctx.strokeStyle = alien ? "#df8188" : "#8ab5c5";
  ctx.lineWidth = Math.max(0.35, s * 0.009);
  ctx.stroke();
  if (detail.ribs) {
    const [rx, ry] = rotatePoint([0, -0.012 * s * depth], -ship.heading);
    for (const rib of detail.ribs) {
      const trace = (dx: number, dy: number) => {
        ctx.beginPath();
        rib.forEach(([x, y], i) => {
          if (i === 0) ctx.moveTo(x * s + ux + dx, y * s + uy + dy);
          else ctx.lineTo(x * s + ux + dx, y * s + uy + dy);
        });
        ctx.closePath();
      };
      ctx.strokeStyle = alien ? "#4b1d29" : "#1c3748";
      ctx.lineWidth = Math.max(0.5, s * 0.018);
      trace(0, 0);
      ctx.stroke();
      ctx.fillStyle = alien ? "#e39aa1" : "#a6cedb";
      trace(rx, ry);
      ctx.fill();
    }
  }
  if (detail.visor) {
    const maxX = Math.max(...points.map(([x]) => x));
    const [, centerY] = deckDetailCenter(detail, s);
    ctx.strokeStyle = alien ? "#ffb07d" : "#b9efff";
    ctx.lineWidth = Math.max(0.5, s * 0.018);
    ctx.beginPath();
    ctx.moveTo(maxX - s * 0.025 + ux, centerY - s * 0.05 + uy);
    ctx.lineTo(maxX - s * 0.025 + ux, centerY + s * 0.05 + uy);
    ctx.stroke();
  }
  ctx.restore();
}
