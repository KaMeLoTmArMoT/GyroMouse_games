export type ControlMode = "gyromouse" | "pointer" | "keyboard" | "both";

export interface InputSettings {
	mode: ControlMode;
	mouseEnabled: boolean;
	sensitivity: number;
	deadzone: number;
	maxTiltDeg: number;
	invertX: boolean;
	invertY: boolean;
}

export interface GyroInputState {
	pointer?: { x: number; y: number; dx?: number; dy?: number };
	tilt?: { roll: number; pitch: number }; // -1.0 to 1.0 or degrees
	buttons?: {
		primary?: boolean;
		secondary?: boolean;
		pause?: boolean;
		calibrate?: boolean;
	};
}

export interface SteeringOptions {
	deadzone?: number; // Default: 0.05
	sensitivity?: number; // Default: 1.0
	invertX?: boolean;
	invertY?: boolean;
}

export class SharedInputManager {
	public settings: InputSettings = {
		mode: "keyboard",
		mouseEnabled: false,
		sensitivity: 1.0,
		deadzone: 0.05,
		maxTiltDeg: 12,
		invertX: false,
		invertY: false,
	};

	private targetTiltX: number = 0;
	private targetTiltZ: number = 0;

	public currentTiltX: number = 0;
	public currentTiltZ: number = 0;

	public keysPressed: Set<string> = new Set();
	public mouseX: number = window.innerWidth / 2;
	public mouseY: number = window.innerHeight / 2;
	public normalizedDx: number = 0;
	public normalizedDy: number = 0;

	// Zero-point calibration (Re-Center)
	public zeroRoll: number = 0;
	public zeroPitch: number = 0;
	public rawRoll: number = 0;
	public rawPitch: number = 0;
	public hasGyroData: boolean = false;

	private tiltIndicatorDot: HTMLElement | null = null;
	private ws: WebSocket | null = null;

	constructor() {
		window.addEventListener("pointermove", this.onPointerMove.bind(this));
		window.addEventListener("mousemove", this.onPointerMove.bind(this));
		window.addEventListener("keydown", this.onKeyDown.bind(this));
		window.addEventListener("keyup", this.onKeyUp.bind(this));
		window.addEventListener("blur", () => this.keysPressed.clear());

		this.createTiltIndicator();
		this.connectWebSocket();
	}

	private connectWebSocket() {
		try {
			this.ws = new WebSocket("ws://127.0.0.1:5006");
			this.ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					if (data.type === "GYRO_INPUT" && data.payload) {
						this.processGyroInput(data.payload);
					}
				} catch (_e) {}
			};
			this.ws.onclose = () => setTimeout(() => this.connectWebSocket(), 2000);
			this.ws.onerror = () => {};
		} catch (_e) {}
	}

	public isKeyPressed(keyOrCode: string): boolean {
		if (keyOrCode === "Escape" || keyOrCode === "Esc") {
			return (
				this.keysPressed.has("Escape") ||
				this.keysPressed.has("Esc") ||
				this.keysPressed.has("KeyEscape")
			);
		}
		if (keyOrCode === "Space" || keyOrCode === " ") {
			return (
				this.keysPressed.has("Space") ||
				this.keysPressed.has(" ") ||
				this.keysPressed.has("Spacebar")
			);
		}
		return this.keysPressed.has(keyOrCode);
	}

	/**
	 * Re-centers gyro calibration zero point to current raw roll & pitch.
	 */
	public reCenter(): void {
		this.zeroRoll = this.rawRoll;
		this.zeroPitch = this.rawPitch;
	}

	/**
	 * Receives external gyro input payload (WebSocket or local adapter)
	 */
	public processGyroInput(payload: GyroInputState): void {
		if (payload.tilt) {
			this.rawRoll = payload.tilt.roll;
			this.rawPitch = payload.tilt.pitch;
			this.hasGyroData = true;
		}

		if (payload.pointer) {
			this.mouseX = payload.pointer.x;
			this.mouseY = payload.pointer.y;
		}

		if (payload.buttons?.calibrate === true) {
			this.reCenter();
		}
	}

	/**
	 * Returns normalized steering value { x: [-1.0..1.0], y: [-1.0..1.0] }
	 */
	public getSteeringValue(options?: SteeringOptions): { x: number; y: number } {
		const deadzone = options?.deadzone ?? this.settings.deadzone ?? 0.05;
		const sensitivity =
			options?.sensitivity ?? this.settings.sensitivity ?? 1.0;
		const invertX = options?.invertX ?? this.settings.invertX ?? false;
		const invertY = options?.invertY ?? this.settings.invertY ?? false;

		let roll = 0;
		let pitch = 0;

		if (this.hasGyroData) {
			roll = this.rawRoll - this.zeroRoll;
			pitch = this.rawPitch - this.zeroPitch;
		} else {
			// Keyboard fallback
			if (this.keysPressed.has("ArrowRight") || this.keysPressed.has("KeyD"))
				roll += 1.0;
			if (this.keysPressed.has("ArrowLeft") || this.keysPressed.has("KeyA"))
				roll -= 1.0;
			if (this.keysPressed.has("ArrowDown") || this.keysPressed.has("KeyS"))
				pitch += 1.0;
			if (this.keysPressed.has("ArrowUp") || this.keysPressed.has("KeyW"))
				pitch -= 1.0;
		}

		// Apply deadzone scaling
		const applyDeadzone = (val: number): number => {
			const absVal = Math.abs(val);
			if (absVal < deadzone) return 0;
			const scaled = (absVal - deadzone) / (1.0 - deadzone);
			return Math.sign(val) * scaled;
		};

		const scaledRoll = applyDeadzone(roll);
		const scaledPitch = applyDeadzone(pitch);

		const x = Math.max(
			-1,
			Math.min(1, scaledRoll * sensitivity * (invertX ? -1 : 1)),
		);
		const y = Math.max(
			-1,
			Math.min(1, scaledPitch * sensitivity * (invertY ? -1 : 1)),
		);

		return { x, y };
	}

	private createTiltIndicator() {
		let dot = document.getElementById("tilt-indicator-dot");
		if (!dot) {
			dot = document.createElement("div");
			dot.id = "tilt-indicator-dot";
			dot.style.position = "absolute";
			dot.style.width = "14px";
			dot.style.height = "14px";
			dot.style.borderRadius = "50%";
			dot.style.background = "#38bdf8";
			dot.style.boxShadow = "0 0 12px #38bdf8";
			dot.style.transform = "translate(-50%, -50%)";
			dot.style.pointerEvents = "none";
			dot.style.zIndex = "99";
			dot.style.display = "none";
			document.body.appendChild(dot);
		}
		this.tiltIndicatorDot = dot;
	}

	private onPointerMove(e: MouseEvent | PointerEvent) {
		if (!this.settings.mouseEnabled) return;

		this.mouseX = e.clientX;
		this.mouseY = e.clientY;

		if (this.tiltIndicatorDot) {
			this.tiltIndicatorDot.style.display = "block";
			this.tiltIndicatorDot.style.left = `${this.mouseX}px`;
			this.tiltIndicatorDot.style.top = `${this.mouseY}px`;
		}
	}

	private onKeyDown(e: KeyboardEvent) {
		if (e.code) this.keysPressed.add(e.code);
		if (e.key) this.keysPressed.add(e.key);

		if (e.code === "KeyC") {
			this.reCenter();
		}
	}

	private onKeyUp(e: KeyboardEvent) {
		if (e.code) this.keysPressed.delete(e.code);
		if (e.key) this.keysPressed.delete(e.key);
	}

	public update(dt: number) {
		let rawDx = 0;
		let rawDy = 0;

		const maxTiltRad = (this.settings.maxTiltDeg * Math.PI) / 180;

		if (this.hasGyroData) {
			const steering = this.getSteeringValue();
			rawDx = steering.x;
			rawDy = steering.y;
		} else if (
			this.settings.mouseEnabled &&
			(this.settings.mode === "gyromouse" || this.settings.mode === "both")
		) {
			const centerX = window.innerWidth / 2;
			const centerY = window.innerHeight / 2;

			let normX = (this.mouseX - centerX) / (centerX || 1);
			let normY = (this.mouseY - centerY) / (centerY || 1);

			const dist = Math.hypot(normX, normY);
			if (dist < this.settings.deadzone) {
				normX = 0;
				normY = 0;
			} else {
				const scale =
					(dist - this.settings.deadzone) / (1 - this.settings.deadzone);
				normX = (normX / dist) * scale;
				normY = (normY / dist) * scale;
			}

			this.normalizedDx = normX;
			this.normalizedDy = normY;

			rawDx += normX * this.settings.sensitivity;
			rawDy += normY * this.settings.sensitivity;
		} else {
			if (this.tiltIndicatorDot) {
				this.tiltIndicatorDot.style.display = "none";
			}
		}

		if (
			!this.hasGyroData &&
			(this.settings.mode === "keyboard" || this.settings.mode === "both")
		) {
			if (this.keysPressed.has("ArrowRight") || this.keysPressed.has("KeyD"))
				rawDx += 1.0;
			if (this.keysPressed.has("ArrowLeft") || this.keysPressed.has("KeyA"))
				rawDx -= 1.0;
			if (this.keysPressed.has("ArrowDown") || this.keysPressed.has("KeyS"))
				rawDy += 1.0;
			if (this.keysPressed.has("ArrowUp") || this.keysPressed.has("KeyW"))
				rawDy -= 1.0;
		}

		rawDx = Math.max(-1, Math.min(1, rawDx));
		rawDy = Math.max(-1, Math.min(1, rawDy));

		if (!this.hasGyroData && this.settings.invertX) rawDx *= -1;
		if (!this.hasGyroData && this.settings.invertY) rawDy *= -1;

		// Direct tilt mapping matching intuitive roll directions
		this.targetTiltX = rawDy * maxTiltRad;
		this.targetTiltZ = rawDx * maxTiltRad;

		const lerpFactor = Math.min(1.0, dt * 5.0);
		this.currentTiltX += (this.targetTiltX - this.currentTiltX) * lerpFactor;
		this.currentTiltZ += (this.targetTiltZ - this.currentTiltZ) * lerpFactor;
	}
}
