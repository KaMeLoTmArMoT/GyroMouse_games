export interface MenuNavOptions {
  container: HTMLElement;
  buttonSelector?: string;
  onSelect?: (btn: HTMLElement) => void;
}

export class MenuNav {
  private container: HTMLElement;
  private buttonSelector: string;
  private buttons: HTMLElement[] = [];
  private activeIndex: number = 0;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private isActive: boolean = false;

  constructor(options: MenuNavOptions) {
    this.container = options.container;
    this.buttonSelector = options.buttonSelector || 'button, a.btn, a.icon-btn, a.nav-btn';
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  public activate() {
    this.refreshButtons();
    if (this.buttons.length === 0) return;
    
    this.activeIndex = 0;
    this.isActive = true;
    this.updateHighlight();
    window.addEventListener('keydown', this.boundKeyDown, true);
  }

  public deactivate() {
    this.isActive = false;
    window.removeEventListener('keydown', this.boundKeyDown, true);
    this.buttons.forEach((btn) => {
      btn.classList.remove('kbd-active');
      btn.style.outline = '';
      btn.style.boxShadow = '';
    });
  }

  private refreshButtons() {
    const rawList = Array.from(this.container.querySelectorAll<HTMLElement>(this.buttonSelector));
    this.buttons = rawList.filter((btn) => {
      const style = window.getComputedStyle(btn);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  private updateHighlight() {
    this.buttons.forEach((btn, idx) => {
      if (idx === this.activeIndex) {
        btn.classList.add('kbd-active');
        btn.style.outline = '2px solid #38bdf8';
        btn.style.boxShadow = '0 0 15px rgba(56, 189, 248, 0.6)';
        btn.focus();
      } else {
        btn.classList.remove('kbd-active');
        btn.style.outline = '';
        btn.style.boxShadow = '';
      }
    });
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this.isActive || this.buttons.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      this.activeIndex = (this.activeIndex + 1) % this.buttons.length;
      this.updateHighlight();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      this.activeIndex = (this.activeIndex - 1 + this.buttons.length) % this.buttons.length;
      this.updateHighlight();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const currentBtn = this.buttons[this.activeIndex];
      if (currentBtn) {
        currentBtn.click();
      }
    }
  }
}
