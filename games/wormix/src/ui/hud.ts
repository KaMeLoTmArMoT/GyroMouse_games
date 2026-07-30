import { TurnPhase, WeaponInfo } from '../types';
import { Worm } from '../entities/worm';

export const WEAPON_LIST: WeaponInfo[] = [
  { id: 'bazooka', name: 'Bazooka', icon: '🚀', description: 'Heavy explosive missile, affected by wind', affectedByWind: true },
  { id: 'grenade', name: 'Grenade', icon: '💣', description: 'Bounces off terrain, 3s fuse explosion', affectedByWind: false },
  { id: 'cluster', name: 'Cluster Bomb', icon: '💥', description: 'Splits into 5 mini-bombs on impact', affectedByWind: true },
  { id: 'acid_bomb', name: 'Acid Bomb', icon: '🧪', description: 'Releases acid that dissolves terrain', affectedByWind: false },
  { id: 'sand_bomb', name: 'Sand Bomb', icon: '⏳', description: 'Creates a sand mound on impact', affectedByWind: false },
  { id: 'portal_gun', name: 'Portal Gun', icon: '🌀', description: 'Places Orange/Blue portals on terrain', affectedByWind: false },
  { id: 'shotgun', name: 'Shotgun', icon: '🔫', description: 'Direct line-of-fire double shot', affectedByWind: false }
];

export class HUD {
  public draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: TurnPhase,
    activeWorm: Worm | null,
    activeWeaponIndex: number,
    chargePower: number,
    isCharging: boolean,
    windX: number,
    turnTimer: number,
    playerTeamHp: number,
    aiTeamHp: number,
    isPcMode: boolean
  ): void {
    ctx.save();

    // 1. Top Bar: Team Health & Wind Compass & Turn Timer
    this.drawTopBar(ctx, width, playerTeamHp, aiTeamHp, windX, turnTimer);

    // 2. Center Turn Phase Banner
    this.drawPhaseBanner(ctx, width, phase, isPcMode);

    // 3. Trajectory Sighting Arc (When Aiming or Charging)
    if (activeWorm && activeWorm.isAlive && (phase === 'AIM_FIRE' || phase === 'MOVE')) {
      const powerToDraw = isCharging ? chargePower : 0.6;
      this.drawTrajectoryArc(ctx, activeWorm, powerToDraw, windX, WEAPON_LIST[activeWeaponIndex].affectedByWind);
    }

    // 4. Power Charge Meter (When holding Space)
    if (isCharging && activeWorm) {
      this.drawPowerMeter(ctx, width, height, chargePower);
    }

    // 5. Weapon Selection Toolbar (Bottom)
    if (phase === 'WEAPON_SELECT' || phase === 'AIM_FIRE' || phase === 'MOVE') {
      this.drawWeaponToolbar(ctx, width, height, activeWeaponIndex, phase === 'WEAPON_SELECT');
    }

    ctx.restore();
  }

  private drawTopBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    playerHp: number,
    aiHp: number,
    windX: number,
    timer: number
  ): void {
    // Red Team (Player) HP
    ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.font = 'bold 16px Outfit, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`🔴 RED TEAM: ${playerHp} HP`, 20, 30);

    // Blue Team (AI) HP
    ctx.fillStyle = 'rgba(59, 130, 246, 0.85)';
    ctx.textAlign = 'right';
    ctx.fillText(`🔵 BLUE TEAM: ${aiHp} HP`, width - 20, 30);

    // Center Timer & Wind Gauge
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(width / 2 - 110, 10, 220, 45, 12);
    ctx.fill();
    ctx.stroke();

    // Timer Clock
    ctx.fillStyle = timer <= 10 ? '#ef4444' : '#facc15';
    ctx.font = 'bold 20px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`⏱️ ${Math.ceil(timer)}s`, width / 2 - 45, 38);

    // Wind Indicator Arrow
    const windSpeed = Math.abs(Math.round(windX * 10));
    const windArrow = windX > 0 ? '→' : windX < 0 ? '←' : '•';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px Outfit, sans-serif';
    ctx.fillText(`WIND ${windArrow} ${windSpeed}`, width / 2 + 40, 38);
  }

  private drawPhaseBanner(
    ctx: CanvasRenderingContext2D,
    width: number,
    phase: TurnPhase,
    isPcMode: boolean
  ): void {
    if (phase === 'GAME_OVER' || phase === 'PROJECTILE_FLIGHT') return;

    let bannerText = '';
    let hintText = '';

    if (phase === 'MOVE') {
      bannerText = 'STEP 1: MOVEMENT PHASE';
      hintText = isPcMode
        ? 'WASD to Move/Jump • Space or Click to Select Weapon'
        : 'A/D to Walk • W to Jump • Space to Select Weapon';
    } else if (phase === 'WEAPON_SELECT') {
      bannerText = 'STEP 2: WEAPON SELECT';
      hintText = isPcMode
        ? 'A/D / Arrows to Cycle • Space to Equip • S to Back'
        : 'A/D / Arrows to Cycle • Space to Equip • S to Back';
    } else if (phase === 'AIM_FIRE') {
      bannerText = 'STEP 3: AIM & FIRE';
      hintText = isPcMode
        ? 'W/S or Mouse to Aim • Hold SPACE to Charge & Release to FIRE!'
        : 'W/S or Gyro Pitch to Aim • Hold SPACE to Charge & Release to FIRE!';
    }

    if (!bannerText) return;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(width / 2 - 220, 65, 440, 42, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 14px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(bannerText, width / 2, 82);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px Outfit, sans-serif';
    ctx.fillText(hintText, width / 2, 98);
  }

  private drawTrajectoryArc(
    ctx: CanvasRenderingContext2D,
    worm: Worm,
    power: number,
    windX: number,
    affectedByWind: boolean
  ): void {
    const tip = worm.getCannonTip();
    const rad = (worm.aimAngle * Math.PI) / 180;
    const speed = power * 22.0;

    let vx = Math.cos(rad) * speed;
    let vy = Math.sin(rad) * speed;
    let px = tip.x;
    let py = tip.y;

    ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, py);

    for (let step = 0; step < 25; step++) {
      if (affectedByWind) vx += windX * 0.05;
      vy += 0.45; // Gravity
      px += vx;
      py += vy;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawPowerMeter(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    chargePower: number
  ): void {
    const barW = 300;
    const barH = 22;
    const barX = width / 2 - barW / 2;
    const barY = height - 120;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(barX - 4, barY - 4, barW + 8, barH + 8, 8);
    ctx.fill();
    ctx.stroke();

    const powerGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    powerGrad.addColorStop(0, '#22c55e');
    powerGrad.addColorStop(0.6, '#eab308');
    powerGrad.addColorStop(1, '#ef4444');

    ctx.fillStyle = powerGrad;
    ctx.fillRect(barX, barY, barW * chargePower, barH);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 13px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`POWER: ${Math.round(chargePower * 100)}%`, width / 2, barY + 16);
  }

  private drawWeaponToolbar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    activeIndex: number,
    isSelecting: boolean
  ): void {
    const cardW = 60;
    const cardH = 50;
    const gap = 8;
    const totalW = WEAPON_LIST.length * (cardW + gap) - gap;
    const startX = width / 2 - totalW / 2;
    const startY = height - 70;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.beginPath();
    ctx.roundRect(startX - 12, startY - 8, totalW + 24, cardH + 16, 14);
    ctx.fill();

    WEAPON_LIST.forEach((w, i) => {
      const x = startX + i * (cardW + gap);
      const isSelected = i === activeIndex;

      ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255, 255, 255, 0.05)';
      ctx.strokeStyle = isSelected ? (isSelecting ? '#facc15' : '#38bdf8') : 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = isSelected ? 2 : 1;

      ctx.beginPath();
      ctx.roundRect(x, startY, cardW, cardH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(w.icon, x + cardW / 2, startY + 28);

      ctx.font = '9px Outfit, sans-serif';
      ctx.fillStyle = isSelected ? '#ffffff' : '#9ca3af';
      ctx.fillText(w.name, x + cardW / 2, startY + 44);
    });
  }
}
