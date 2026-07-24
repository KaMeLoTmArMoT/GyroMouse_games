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

  private navigate2D(direction: 'up' | 'down' | 'left' | 'right') {
    this.refreshButtons();
    if (this.buttons.length === 0) return;

    const currentBtn = this.buttons[this.activeIndex];
    if (!currentBtn) {
      this.activeIndex = 0;
      this.updateHighlight();
      return;
    }

    const currRect = currentBtn.getBoundingClientRect();
    const currCx = currRect.left + currRect.width / 2;
    const currCy = currRect.top + currRect.height / 2;

    let bestIndex = -1;
    let minDistance = Infinity;

    this.buttons.forEach((btn, idx) => {
      if (idx === this.activeIndex) return;
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      let dx = cx - currCx;
      let dy = cy - currCy;

      let isCandidate = false;
      let dist = Infinity;

      if (direction === 'down' && dy > 4) {
        isCandidate = true;
        dist = dy * dy + 2.5 * (dx * dx);
      } else if (direction === 'up' && dy < -4) {
        isCandidate = true;
        dist = dy * dy + 2.5 * (dx * dx);
      } else if (direction === 'right' && dx > 4) {
        isCandidate = true;
        dist = dx * dx + 2.5 * (dy * dy);
      } else if (direction === 'left' && dx < -4) {
        isCandidate = true;
        dist = dx * dx + 2.5 * (dy * dy);
      }

      if (isCandidate && dist < minDistance) {
        minDistance = dist;
        bestIndex = idx;
      }
    });

    if (bestIndex !== -1) {
      this.activeIndex = bestIndex;
      this.updateHighlight();
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (!this.isActive || this.buttons.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      this.navigate2D('down');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      this.navigate2D('up');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      this.navigate2D('right');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      this.navigate2D('left');
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
