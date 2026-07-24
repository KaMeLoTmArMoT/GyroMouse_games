import { SharedInputManager } from './inputManager';

export abstract class BaseGame {
  public input: SharedInputManager;
  public isPaused: boolean = false;
  public isStarted: boolean = false;
  public isGameOver: boolean = false;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;

  constructor() {
    this.input = new SharedInputManager();
    this.boundKeyDown = this.handleKeyDownInternal.bind(this);
    this.boundKeyUp = this.handleKeyUpInternal.bind(this);

    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
  }

  private handleKeyDownInternal(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.code === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      this.onEscape();
      return;
    }

    if (e.key === ' ' || e.code === 'Space' || e.key === 'Space') {
      e.preventDefault();
      this.onSpace();
      return;
    }

    this.onKeyDown(e);
  }

  private handleKeyUpInternal(e: KeyboardEvent) {
    this.onKeyUp(e);
  }

  /**
   * Called when Escape key is pressed. Default behavior toggles pause.
   * Can be overridden by subclasses if custom logic is needed.
   */
  protected onEscape() {
    this.togglePause();
  }

  /**
   * Called when Space key is pressed. Can be overridden by subclasses.
   */
  protected onSpace() {}

  /**
   * Hook for unhandled keydown events. Override if needed.
   */
  protected onKeyDown(_e: KeyboardEvent) {}

  /**
   * Hook for keyup events. Override if needed.
   */
  protected onKeyUp(_e: KeyboardEvent) {}

  /**
   * Toggles pause state. Subclasses can override to manage UI overlays.
   */
  public togglePause(forceState?: boolean) {
    this.isPaused = forceState !== undefined ? forceState : !this.isPaused;
  }

  /**
   * Cleanup listeners on game tear down.
   */
  public destroy() {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
  }
}
