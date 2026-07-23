import { ImpactRecord, TargetStructure } from '../physics/artilleryPhysics';
import { MenuNav } from '../../../../shared/menuNav';

export class ArtilleryHUD {
  private radarCanvas: HTMLCanvasElement;
  private radarCtx: CanvasRenderingContext2D;

  private hudLevel: HTMLElement;
  private hudTargets: HTMLElement;
  private hudShells: HTMLElement;
  private spotterText: HTMLElement;
  private pitchVal: HTMLElement;
  private yawVal: HTMLElement;
  private powerVal: HTMLElement;

  private stageBadge: HTMLElement;
  private stage1Controls: HTMLElement;
  private stage2Controls: HTMLElement;
  private powerBarFill: HTMLElement;

  private modalOverlay: HTMLElement;
  private modalTitle: HTMLElement;
  private modalDesc: HTMLElement;
  private modalBtn: HTMLElement;
  private modalMenuNav: MenuNav;

  constructor() {
    this.radarCanvas = document.getElementById('radar-canvas') as HTMLCanvasElement;
    this.radarCtx = this.radarCanvas.getContext('2d')!;

    this.hudLevel = document.getElementById('hud-level')!;
    this.hudTargets = document.getElementById('hud-targets')!;
    this.hudShells = document.getElementById('hud-shells')!;
    this.spotterText = document.getElementById('spotter-text')!;
    this.pitchVal = document.getElementById('pitch-val')!;
    this.yawVal = document.getElementById('yaw-val')!;
    this.powerVal = document.getElementById('power-val')!;

    this.stageBadge = document.getElementById('stage-badge')!;
    this.stage1Controls = document.getElementById('stage-1-controls')!;
    this.stage2Controls = document.getElementById('stage-2-controls')!;
    this.powerBarFill = document.getElementById('power-bar-fill')!;

    this.modalOverlay = document.getElementById('game-modal')!;
    this.modalTitle = document.getElementById('modal-title')!;
    this.modalDesc = document.getElementById('modal-desc')!;
    this.modalBtn = document.getElementById('modal-btn')!;
    this.modalMenuNav = new MenuNav({ container: this.modalOverlay });
  }

  public updateStats(level: number, hitTargets: number, totalTargets: number, shellsLeft: number) {
    this.hudLevel.innerText = `${level}`;
    this.hudTargets.innerText = `${hitTargets} / ${totalTargets}`;
    this.hudShells.innerText = `${shellsLeft}`;
  }

  public updateAimValues(pitchDeg: number, yawDeg: number) {
    this.pitchVal.innerText = `${pitchDeg.toFixed(1)}°`;
    this.yawVal.innerText = `${yawDeg.toFixed(1)}°`;
  }

  public setStage(stage: 1 | 2) {
    if (stage === 1) {
      this.stageBadge.innerText = 'STAGE 1: COARSE TURRET AIM';
      this.stageBadge.style.background = 'rgba(239, 68, 68, 0.2)';
      this.stageBadge.style.color = '#f87171';

      this.stage1Controls.style.display = 'flex';
      this.stage2Controls.style.display = 'none';
    } else {
      this.stageBadge.innerText = 'STAGE 2: CHARGE POWER (P1 UP/DOWN) & WIND TUNE (P2 L/R)';
      this.stageBadge.style.background = 'rgba(245, 158, 11, 0.2)';
      this.stageBadge.style.color = '#fbbf24';

      this.stage1Controls.style.display = 'none';
      this.stage2Controls.style.display = 'flex';
    }
  }

  public updatePowerBar(powerMps: number, powerRatio: number) {
    const pct = Math.max(0, Math.min(100, powerRatio * 100));
    this.powerBarFill.style.width = `${pct}%`;
    if (this.powerVal) {
      this.powerVal.innerText = `${powerMps.toFixed(1)} m/s (${Math.round(pct)}%)`;
    }
  }

  public setSpotterMessage(msg: string) {
    this.spotterText.innerText = msg;
  }

  public drawRadarMap(
    targets: Map<string, TargetStructure>,
    impactHistory: ImpactRecord[],
    currentYaw: number,
    windVector: { x: number; z: number }
  ) {
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    const centerX = w / 2;
    const centerY = h - 15;
    const scale = 1.3;

    ctx.clearRect(0, 0, w, h);

    // Background circle grid
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
    ctx.lineWidth = 1;

    [25, 55, 85, 115].forEach((r) => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, Math.PI, 0, false);
      ctx.stroke();
    });

    // Cannon Aim Line (positive currentYaw points towards +X Right)
    const yawRad = (currentYaw * Math.PI) / 180;
    const lineLen = 120;
    const aimX = centerX + Math.sin(yawRad) * lineLen;
    const aimY = centerY - Math.cos(yawRad) * lineLen;

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(aimX, aimY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Wind Vector Indicator
    if (Math.hypot(windVector.x, windVector.z) > 0.1) {
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w - 25, 25);
      ctx.lineTo(w - 25 + windVector.x * 3, 25 - windVector.z * 3);
      ctx.stroke();

      ctx.fillStyle = '#a855f7';
      ctx.font = '9px monospace';
      ctx.fillText('WIND', w - 34, 14);
    }

    // Past Impact Craters
    impactHistory.forEach((imp) => {
      const rx = centerX + imp.position.x * scale;
      const ry = centerY - imp.position.z * scale;

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Draw Targets
    targets.forEach((t) => {
      const rx = centerX + t.position.x * scale;
      const ry = centerY - t.position.z * scale;

      if (t.isDestroyed) {
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.arc(rx, ry, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#ef4444';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 6;
        ctx.fillRect(rx - 4, ry - 4, 8, 8);
        ctx.shadowBlur = 0;
      }
    });

    // Cannon icon at origin
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  public showModal(title: string, desc: string, btnText: string, onBtnClick: () => void) {
    this.modalTitle.innerText = title;
    this.modalDesc.innerText = desc;
    this.modalBtn.innerText = btnText;
    this.modalOverlay.classList.add('active');
    this.modalMenuNav.activate();

    this.modalBtn.onclick = () => {
      this.modalOverlay.classList.remove('active');
      this.modalMenuNav.deactivate();
      onBtnClick();
    };
  }
}
