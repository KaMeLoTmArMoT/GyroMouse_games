import { MenuNav } from "../../../../shared/menuNav";
import type { ShellType, TargetStructure } from "../physics/artilleryPhysics";

export class ArtilleryHUD {
	private radarCanvas: HTMLCanvasElement;
	private radarCtx: CanvasRenderingContext2D;

	private hudLevel: HTMLElement;
	private hudCoins: HTMLElement;
	private hudShells: HTMLElement;
	private spotterText: HTMLElement;
	private pitchVal: HTMLElement;
	private yawVal: HTMLElement;
	private powerVal: HTMLElement;

	private stageBadge: HTMLElement;
	private stage1Controls: HTMLElement;
	private stage2Controls: HTMLElement;
	private powerBarFill: HTMLElement;

	// Castle Integrity Breakdown Elements
	private integrityPct: HTMLElement;
	private integrityBarFill: HTMLElement;
	private hpTowerLeft: HTMLElement;
	private hpGate: HTMLElement;
	private hpKeep: HTMLElement;
	private hpTowerRight: HTMLElement;

	// Mode & Sandbox Controls
	public btnModeToggle: HTMLElement;
	public btnSandboxRebuild: HTMLElement;

	// Combo Banner
	private comboBanner: HTMLElement;

	// Arsenal Selection Buttons
	public shellOptions: Map<ShellType, HTMLElement> = new Map();
	public selectedShellType: ShellType = "BASIC";

	private modalOverlay: HTMLElement;
	private modalTitle: HTMLElement;
	private modalDesc: HTMLElement;
	private modalBtn: HTMLElement;
	private modalMenuNav: MenuNav;

	constructor() {
		this.radarCanvas = document.getElementById(
			"radar-canvas",
		) as HTMLCanvasElement;
		this.radarCtx = this.radarCanvas.getContext("2d")!;

		this.hudLevel = document.getElementById("hud-level")!;
		this.hudCoins = document.getElementById("hud-coins")!;
		this.hudShells = document.getElementById("hud-shells")!;
		this.spotterText = document.getElementById("spotter-text")!;
		this.pitchVal = document.getElementById("pitch-val")!;
		this.yawVal = document.getElementById("yaw-val")!;
		this.powerVal = document.getElementById("power-val")!;

		this.stageBadge = document.getElementById("stage-badge")!;
		this.stage1Controls = document.getElementById("stage-1-controls")!;
		this.stage2Controls = document.getElementById("stage-2-controls")!;
		this.powerBarFill = document.getElementById("power-bar-fill")!;

		this.integrityPct = document.getElementById("integrity-pct")!;
		this.integrityBarFill = document.getElementById("integrity-bar-fill")!;
		this.hpTowerLeft = document.getElementById("hp-tower-left")!;
		this.hpGate = document.getElementById("hp-gate")!;
		this.hpKeep = document.getElementById("hp-keep")!;
		this.hpTowerRight = document.getElementById("hp-tower-right")!;

		this.btnModeToggle = document.getElementById("btn-mode-toggle")!;
		this.btnSandboxRebuild = document.getElementById("btn-sandbox-rebuild")!;
		this.comboBanner = document.getElementById("combo-banner")!;

		// Bind Arsenal Shell Store Buttons
		const basicOpt = document.getElementById("shell-opt-basic");
		const clusterOpt = document.getElementById("shell-opt-cluster");
		const iceOpt = document.getElementById("shell-opt-ice");
		const grappleOpt = document.getElementById("shell-opt-grapple");

		if (basicOpt) this.shellOptions.set("BASIC", basicOpt);
		if (clusterOpt) this.shellOptions.set("CLUSTER", clusterOpt);
		if (iceOpt) this.shellOptions.set("ICE", iceOpt);
		if (grappleOpt) this.shellOptions.set("GRAPPLE", grappleOpt);

		this.modalOverlay = document.getElementById("game-modal")!;
		this.modalTitle = document.getElementById("modal-title")!;
		this.modalDesc = document.getElementById("modal-desc")!;
		this.modalBtn = document.getElementById("modal-btn")!;
		this.modalMenuNav = new MenuNav({ container: this.modalOverlay });
	}

	public showModal(
		title: string,
		desc: string,
		btnText: string,
		onBtnClick: () => void,
	) {
		this.modalTitle.innerText = title;
		this.modalDesc.innerText = desc;
		this.modalBtn.innerText = btnText;
		this.modalOverlay.classList.add("active");
		this.modalMenuNav.activate();

		this.modalBtn.onclick = () => {
			this.modalOverlay.classList.remove("active");
			this.modalMenuNav.deactivate();
			onBtnClick();
		};
	}

	public hideModal() {
		this.modalOverlay.classList.remove("active");
		this.modalMenuNav.deactivate();
	}

	public updateStats(
		levelDisplay: string,
		coins: number,
		selectedShellName: string,
	) {
		this.hudLevel.innerText = levelDisplay;
		this.hudCoins.innerText = `🪙 ${coins}`;
		this.hudShells.innerText = selectedShellName;
	}

	public updateCastleIntegrity(integrity: {
		totalHpRatio: number;
		towerLeft: number;
		towerRight: number;
		gate: number;
		keep: number;
	}) {
		this.integrityPct.innerText = `${integrity.totalHpRatio}%`;
		this.integrityBarFill.style.width = `${Math.max(0, integrity.totalHpRatio)}%`;
		this.hpTowerLeft.innerText = `${integrity.towerLeft}%`;
		this.hpGate.innerText = `${integrity.gate}%`;
		this.hpKeep.innerText = `${integrity.keep}%`;
		this.hpTowerRight.innerText = `${integrity.towerRight}%`;
	}

	public selectShellType(type: ShellType) {
		this.selectedShellType = type;
		this.shellOptions.forEach((btn, t) => {
			if (t === type) {
				btn.classList.add("active");
			} else {
				btn.classList.remove("active");
			}
		});
	}

	public triggerComboBanner(text: string) {
		this.comboBanner.innerText = text;
		this.comboBanner.classList.add("active");
		setTimeout(() => {
			this.comboBanner.classList.remove("active");
		}, 1800);
	}

	public setStage(stage: 1 | 2) {
		if (stage === 1) {
			this.stageBadge.innerText = "STAGE 1: COARSE TURRET AIM";
			this.stage1Controls.style.display = "flex";
			this.stage2Controls.style.display = "none";
		} else {
			this.stageBadge.innerText = "STAGE 2: CHARGE & LOCK POWER";
			this.stage1Controls.style.display = "none";
			this.stage2Controls.style.display = "flex";
		}
	}

	public updateAimDisplay(pitchDeg: number, yawDeg: number) {
		this.pitchVal.innerText = `${pitchDeg.toFixed(1)}°`;
		const yawDir = yawDeg > 0 ? "R" : yawDeg < 0 ? "L" : "";
		this.yawVal.innerText = `${Math.abs(yawDeg).toFixed(1)}° ${yawDir}`.trim();
	}

	public updateAimValues(pitchDeg: number, yawDeg: number) {
		this.updateAimDisplay(pitchDeg, yawDeg);
	}

	public updatePowerBar(powerMps: number, powerRatio: number) {
		this.powerVal.innerText = `${powerMps.toFixed(1)} m/s`;
		this.powerBarFill.style.width = `${Math.max(0, Math.min(100, powerRatio * 100))}%`;
	}

	public setSpotterMessage(text: string) {
		this.spotterText.innerText = text;
	}

	public drawRadar(targets: Map<string, TargetStructure> | TargetStructure[]) {
		const ctx = this.radarCtx;
		const w = this.radarCanvas.width;
		const h = this.radarCanvas.height;
		const cx = w / 2;
		const cy = h / 2;

		ctx.clearRect(0, 0, w, h);

		ctx.strokeStyle = "rgba(239, 68, 68, 0.2)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(cx, cy, w * 0.2, 0, Math.PI * 2);
		ctx.arc(cx, cy, w * 0.4, 0, Math.PI * 2);
		ctx.stroke();

		const angle = (Date.now() / 1000) % (Math.PI * 2);
		ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(cx + Math.cos(angle) * (w / 2), cy + Math.sin(angle) * (h / 2));
		ctx.stroke();

		ctx.fillStyle = "#38bdf8";
		ctx.beginPath();
		ctx.arc(cx, cy, 4, 0, Math.PI * 2);
		ctx.fill();

		const radarScale = (w * 0.4) / 100.0;
		const targetList =
			targets instanceof Map ? Array.from(targets.values()) : targets;

		targetList.forEach((t) => {
			const relX = t.position.x;
			const relZ = t.position.z;

			const rx = cx + relX * radarScale;
			const ry = cy - relZ * radarScale;

			ctx.fillStyle = t.isDestroyed
				? "#6b7280"
				: t.isFrozen
					? "#38bdf8"
					: "#ef4444";
			ctx.beginPath();
			ctx.arc(rx, ry, t.isDestroyed ? 3 : 5, 0, Math.PI * 2);
			ctx.fill();
		});
	}

	public drawRadarMap(targets: any, _history?: any, _yaw?: any, _wind?: any) {
		this.drawRadar(targets);
	}
}
