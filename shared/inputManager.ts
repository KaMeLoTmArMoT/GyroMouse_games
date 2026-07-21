export type ControlMode = 'gyromouse' | 'keyboard' | 'both';

export interface InputSettings {
  mode: ControlMode;
  mouseEnabled: boolean;
  sensitivity: number;
  deadzone: number;
  maxTiltDeg: number;
  invertX: boolean;
  invertY: boolean;
}

export class SharedInputManager {
  public settings: InputSettings = {
    mode: 'keyboard',
    mouseEnabled: false,
    sensitivity: 1.0,
    deadzone: 0.05,
    maxTiltDeg: 12,
    invertX: false,
    invertY: false
  };

  private targetTiltX: number = 0;
  private targetTiltZ: number = 0;

  public currentTiltX: number = 0;
  public currentTiltZ: number = 0;

  private keysPressed: Set<string> = new Set();
  public mouseX: number = window.innerWidth / 2;
  public mouseY: number = window.innerHeight / 2;
  public normalizedDx: number = 0;
  public normalizedDy: number = 0;

  private tiltIndicatorDot: HTMLElement | null = null;

  constructor() {
    window.addEventListener('pointermove', this.onPointerMove.bind(this));
    window.addEventListener('mousemove', this.onPointerMove.bind(this));
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));

    this.createTiltIndicator();
  }

  private createTiltIndicator() {
    let dot = document.getElementById('tilt-indicator-dot');
    if (!dot) {
      dot = document.createElement('div');
      dot.id = 'tilt-indicator-dot';
      dot.style.position = 'absolute';
      dot.style.width = '14px';
      dot.style.height = '14px';
      dot.style.borderRadius = '50%';
      dot.style.background = '#38bdf8';
      dot.style.boxShadow = '0 0 12px #38bdf8';
      dot.style.transform = 'translate(-50%, -50%)';
      dot.style.pointerEvents = 'none';
      dot.style.zIndex = '99';
      dot.style.display = 'none';
      document.body.appendChild(dot);
    }
    this.tiltIndicatorDot = dot;
  }

  private onPointerMove(e: MouseEvent | PointerEvent) {
    if (!this.settings.mouseEnabled) return;

    this.mouseX = e.clientX;
    this.mouseY = e.clientY;

    if (this.tiltIndicatorDot) {
      this.tiltIndicatorDot.style.display = 'block';
      this.tiltIndicatorDot.style.left = `${this.mouseX}px`;
      this.tiltIndicatorDot.style.top = `${this.mouseY}px`;
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    this.keysPressed.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keysPressed.delete(e.code);
  }

  public update(dt: number) {
    let rawDx = 0;
    let rawDy = 0;

    const maxTiltRad = (this.settings.maxTiltDeg * Math.PI) / 180;

    if (this.settings.mouseEnabled && (this.settings.mode === 'gyromouse' || this.settings.mode === 'both')) {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      let normX = (this.mouseX - centerX) / (centerX || 1);
      let normY = (this.mouseY - centerY) / (centerY || 1);

      const dist = Math.hypot(normX, normY);
      if (dist < this.settings.deadzone) {
        normX = 0;
        normY = 0;
      } else {
        const scale = (dist - this.settings.deadzone) / (1 - this.settings.deadzone);
        normX = (normX / dist) * scale;
        normY = (normY / dist) * scale;
      }

      this.normalizedDx = normX;
      this.normalizedDy = normY;

      rawDx += normX * this.settings.sensitivity;
      rawDy += normY * this.settings.sensitivity;
    } else {
      if (this.tiltIndicatorDot) {
        this.tiltIndicatorDot.style.display = 'none';
      }
    }

    if (this.settings.mode === 'keyboard' || this.settings.mode === 'both') {
      if (this.keysPressed.has('ArrowRight') || this.keysPressed.has('KeyD')) rawDx += 1.0;
      if (this.keysPressed.has('ArrowLeft') || this.keysPressed.has('KeyA')) rawDx -= 1.0;
      if (this.keysPressed.has('ArrowDown') || this.keysPressed.has('KeyS')) rawDy += 1.0;
      if (this.keysPressed.has('ArrowUp') || this.keysPressed.has('KeyW')) rawDy -= 1.0;
    }

    rawDx = Math.max(-1, Math.min(1, rawDx));
    rawDy = Math.max(-1, Math.min(1, rawDy));

    if (this.settings.invertX) rawDx *= -1;
    if (this.settings.invertY) rawDy *= -1;

    // Direct tilt mapping matching intuitive roll directions
    this.targetTiltX = rawDy * maxTiltRad;
    this.targetTiltZ = rawDx * maxTiltRad;

    const lerpFactor = Math.min(1.0, dt * 5.0);
    this.currentTiltX += (this.targetTiltX - this.currentTiltX) * lerpFactor;
    this.currentTiltZ += (this.targetTiltZ - this.currentTiltZ) * lerpFactor;
  }
}
