import { CustomMapData } from '../types';
import { MapStorage } from '../editor/mapStorage';

export class MapManager {
  private overlayEl: HTMLElement;

  private onEditMapCallback: (map: CustomMapData) => void;
  private onCloseCallback: () => void;

  constructor(onEditMap: (map: CustomMapData) => void, onClose: () => void) {
    this.onEditMapCallback = onEditMap;
    this.onCloseCallback = onClose;

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'wormixMapManager';
    this.overlayEl.className = 'wormix-map-manager-backdrop';
  }

  public show(): void {
    this.setupDOM();
    this.overlayEl.style.display = 'flex';
  }

  public hide(): void {
    this.overlayEl.style.display = 'none';
    if (this.overlayEl.parentNode) {
      this.overlayEl.parentNode.removeChild(this.overlayEl);
    }
  }

  private formatDate(ts: number): string {
    const d = new Date(ts);
    const month = d.toLocaleString('default', { month: 'short' });
    const day = d.getDate();
    const year = d.getFullYear();
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return `Today ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return `Yesterday ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    return `${month} ${day}, ${year}`;
  }

  private renderThumbnail(map: CustomMapData): string {
    const thumbW = 220;
    const thumbH = 90;
    const canvas = document.createElement('canvas');
    canvas.width = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d')!;

    // Dark background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, thumbW, thumbH);

    const heights = map.terrainHeights;
    if (!heights || heights.length === 0) return canvas.toDataURL();

    const scaleX = thumbW / map.width;
    const scaleY = thumbH / map.height;
    const waterScreenY = map.waterY * scaleY;

    // Water fill (below water level)
    ctx.fillStyle = 'rgba(14, 116, 144, 0.4)';
    ctx.fillRect(0, waterScreenY, thumbW, thumbH - waterScreenY);

    // Terrain silhouette fill
    ctx.beginPath();
    ctx.moveTo(0, thumbH);
    for (let i = 0; i < heights.length; i++) {
      const x = i * scaleX;
      const y = heights[i] * scaleY;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(thumbW, thumbH);
    ctx.closePath();

    // Terrain gradient: green top, brown middle, gray bottom
    const grad = ctx.createLinearGradient(0, 0, 0, thumbH);
    grad.addColorStop(0, '#22c55e');
    grad.addColorStop(0.35, '#15803d');
    grad.addColorStop(0.5, '#78350f');
    grad.addColorStop(0.75, '#64748b');
    grad.addColorStop(1, '#334155');
    ctx.fillStyle = grad;
    ctx.fill();

    // Terrain top edge line
    ctx.beginPath();
    for (let i = 0; i < heights.length; i++) {
      const x = i * scaleX;
      const y = heights[i] * scaleY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Spawn point dots
    if (map.spawnPoints) {
      map.spawnPoints.forEach((sp) => {
        ctx.beginPath();
        ctx.arc(sp.x * scaleX, sp.y * scaleY, 3, 0, Math.PI * 2);
        ctx.fillStyle = sp.team === 'player' ? '#ef4444' : '#3b82f6';
        ctx.fill();
      });
    }

    return canvas.toDataURL();
  }

  private setupDOM(): void {
    this.overlayEl.innerHTML = `
      <style>
        .wormix-map-manager-backdrop {
          position: fixed;
          inset: 0;
          z-index: 5800;
          background: rgba(15, 23, 42, 0.88);
          backdrop-filter: blur(20px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Outfit', system-ui, sans-serif;
          color: #f8fafc;
          overflow-y: auto;
        }
        .mm-card-main {
          width: 820px;
          max-width: 95vw;
          max-height: 90vh;
          overflow-y: auto;
          background: rgba(30, 41, 59, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 24px;
          padding: 28px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
        }
        .mm-card-main::-webkit-scrollbar { width: 6px; }
        .mm-card-main::-webkit-scrollbar-track { background: transparent; }
        .mm-card-main::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
        .mm-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .mm-title {
          font-size: 24px;
          font-weight: 800;
          background: linear-gradient(135deg, #38bdf8, #818cf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .mm-close-btn {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #94a3b8;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          font-size: 18px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .mm-close-btn:hover { background: rgba(239, 68, 68, 0.3); color: #f8fafc; border-color: #ef4444; }
        .mm-section-label {
          font-size: 13px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          margin: 18px 0 10px 0;
        }
        .mm-section-label:first-of-type { margin-top: 0; }
        .mm-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 14px;
        }
        .mm-map-card {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          overflow: hidden;
          transition: all 0.2s ease;
          position: relative;
        }
        .mm-map-card:hover {
          border-color: rgba(56, 189, 248, 0.4);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }
        .mm-map-card.create-new {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 180px;
          cursor: pointer;
          border: 2px dashed rgba(255, 255, 255, 0.2);
          background: rgba(15, 23, 42, 0.4);
        }
        .mm-map-card.create-new:hover {
          border-color: #22c55e;
          background: rgba(34, 197, 94, 0.08);
        }
        .mm-create-icon { font-size: 32px; margin-bottom: 8px; }
        .mm-create-text { font-size: 13px; font-weight: 700; color: #22c55e; }
        .mm-thumb {
          width: 100%;
          aspect-ratio: 220 / 90;
          object-fit: cover;
          display: block;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .mm-card-body {
          padding: 10px 12px;
        }
        .mm-card-name {
          font-size: 14px;
          font-weight: 700;
          color: #f1f5f9;
          margin-bottom: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mm-card-name-input {
          width: 100%;
          font-size: 14px;
          font-weight: 700;
          color: #f1f5f9;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid #3b82f6;
          border-radius: 6px;
          padding: 2px 6px;
          outline: none;
          font-family: 'Outfit', system-ui, sans-serif;
          margin-bottom: 4px;
        }
        .mm-card-date {
          font-size: 11px;
          color: #64748b;
          margin-bottom: 8px;
        }
        .mm-card-actions {
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
        }
        .mm-action-btn {
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          background: rgba(255, 255, 255, 0.08);
          color: #cbd5e1;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          font-family: 'Outfit', system-ui, sans-serif;
        }
        .mm-action-btn:hover { background: rgba(255, 255, 255, 0.18); color: #f8fafc; transform: translateY(-1px); }
        .mm-action-btn.edit { background: rgba(37, 99, 235, 0.25); border-color: rgba(59, 130, 246, 0.4); color: #93c5fd; }
        .mm-action-btn.edit:hover { background: rgba(37, 99, 235, 0.45); }
        .mm-action-btn.clone { background: rgba(124, 58, 237, 0.2); border-color: rgba(139, 92, 246, 0.3); color: #c4b5fd; }
        .mm-action-btn.clone:hover { background: rgba(124, 58, 237, 0.4); }
        .mm-action-btn.rename { background: rgba(245, 158, 11, 0.2); border-color: rgba(251, 191, 36, 0.3); color: #fcd34d; }
        .mm-action-btn.rename:hover { background: rgba(245, 158, 11, 0.4); }
        .mm-action-btn.delete { background: rgba(220, 38, 38, 0.2); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5; }
        .mm-action-btn.delete:hover { background: rgba(220, 38, 38, 0.45); }
        .mm-action-btn.export { background: rgba(22, 163, 74, 0.2); border-color: rgba(34, 197, 94, 0.3); color: #86efac; }
        .mm-action-btn.export:hover { background: rgba(22, 163, 74, 0.4); }
        .mm-preset-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(4px);
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 10px;
          font-weight: 700;
          color: #64748b;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .mm-import-bar {
          display: flex;
          gap: 10px;
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .mm-import-btn {
          padding: 8px 16px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          background: rgba(255, 255, 255, 0.08);
          color: #94a3b8;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          font-family: 'Outfit', system-ui, sans-serif;
        }
        .mm-import-btn:hover { background: rgba(255, 255, 255, 0.15); color: #f8fafc; }
        .mm-empty-msg {
          text-align: center;
          padding: 30px;
          color: #475569;
          font-size: 14px;
        }
      </style>
      <div class="mm-card-main">
        <div class="mm-header">
          <div class="mm-title">🗂️ Map Manager</div>
          <button class="mm-close-btn" id="mm-close">✕</button>
        </div>
        <div class="mm-section-label">Custom Maps</div>
        <div class="mm-grid" id="mm-custom-grid"></div>
        <div class="mm-section-label">Preset Maps</div>
        <div class="mm-grid" id="mm-preset-grid"></div>
        <div class="mm-import-bar">
          <button class="mm-import-btn" id="mm-import-btn">📥 Import .wormix.json</button>
        </div>
        <input type="file" id="mm-file-input" accept=".json,.wormix.json" style="display:none" />
      </div>
    `;

    document.body.appendChild(this.overlayEl);

    // Close button
    this.overlayEl.querySelector('#mm-close')?.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback();
    });

    // Click backdrop to close
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.hide();
        this.onCloseCallback();
      }
    });

    // Import button
    const fileInput = this.overlayEl.querySelector('#mm-file-input') as HTMLInputElement;
    this.overlayEl.querySelector('#mm-import-btn')?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => this.handleImport(e));

    this.populateCards();
  }

  private populateCards(): void {
    const customGrid = this.overlayEl.querySelector('#mm-custom-grid') as HTMLElement;
    const presetGrid = this.overlayEl.querySelector('#mm-preset-grid') as HTMLElement;
    if (!customGrid || !presetGrid) return;

    customGrid.innerHTML = '';
    presetGrid.innerHTML = '';

    // "Create New" card
    const createCard = document.createElement('div');
    createCard.className = 'mm-map-card create-new';
    createCard.innerHTML = `
      <div class="mm-create-icon">➕</div>
      <div class="mm-create-text">Create New Map</div>
    `;
    createCard.addEventListener('click', () => {
      this.hide();
      this.onEditMapCallback({
        id: `custom_${Date.now()}`,
        name: 'New Custom Map',
        createdAt: Date.now(),
        width: window.innerWidth,
        height: window.innerHeight,
        waterY: window.innerHeight - 40,
        terrainHeights: new Array(window.innerWidth).fill(window.innerHeight * 0.65),
        spawnPoints: [
          { x: window.innerWidth * 0.2, y: window.innerHeight * 0.65 - 14, team: 'player' },
          { x: window.innerWidth * 0.35, y: window.innerHeight * 0.65 - 14, team: 'player' },
          { x: window.innerWidth * 0.65, y: window.innerHeight * 0.65 - 14, team: 'ai' },
          { x: window.innerWidth * 0.8, y: window.innerHeight * 0.65 - 14, team: 'ai' }
        ],
        mapObjects: [],
        waterBodies: []
      });
    });
    customGrid.appendChild(createCard);

    // Custom saved maps
    const savedMaps = MapStorage.getSavedMaps();
    if (savedMaps.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mm-empty-msg';
      empty.textContent = 'No saved maps yet. Create one or import a .wormix.json file.';
      empty.style.gridColumn = '1 / -1';
      customGrid.appendChild(empty);
    } else {
      savedMaps.forEach((map) => {
        customGrid.appendChild(this.createMapCard(map, false));
      });
    }

    // Preset maps
    const presets = MapStorage.getPresetMaps(window.innerWidth, window.innerHeight);
    presets.forEach((map) => {
      presetGrid.appendChild(this.createMapCard(map, true));
    });
  }

  private createMapCard(map: CustomMapData, isPreset: boolean): HTMLElement {
    const card = document.createElement('div');
    card.className = 'mm-map-card';

    const thumbDataUrl = this.renderThumbnail(map);
    const dateStr = this.formatDate(map.createdAt);
    const updateStr = map.updatedAt ? ` · Edited ${this.formatDate(map.updatedAt)}` : '';

    let actionsHtml = '';
    if (isPreset) {
      actionsHtml = `
        <button class="mm-action-btn edit" data-action="view">👁️ View</button>
        <button class="mm-action-btn clone" data-action="clone">📋 Clone as Custom</button>
      `;
    } else {
      actionsHtml = `
        <button class="mm-action-btn edit" data-action="edit">✏️ Edit</button>
        <button class="mm-action-btn clone" data-action="clone">📋 Clone</button>
        <button class="mm-action-btn rename" data-action="rename">✏️ Rename</button>
        <button class="mm-action-btn export" data-action="export">💾 Export</button>
        <button class="mm-action-btn delete" data-action="delete">🗑️ Delete</button>
      `;
    }

    card.innerHTML = `
      ${isPreset ? '<div class="mm-preset-badge">PRESET</div>' : ''}
      <img class="mm-thumb" src="${thumbDataUrl}" alt="${map.name}" />
      <div class="mm-card-body">
        <div class="mm-card-name" title="${map.name}">${map.name}</div>
        <div class="mm-card-date">Created ${dateStr}${updateStr}</div>
        <div class="mm-card-actions">${actionsHtml}</div>
      </div>
    `;

    // Bind action buttons
    card.querySelectorAll('.mm-action-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action;
        this.handleCardAction(action!, map, isPreset, card);
      });
    });

    return card;
  }

  private handleCardAction(action: string, map: CustomMapData, isPreset: boolean, card: HTMLElement): void {
    switch (action) {
      case 'edit':
      case 'view': {
        // If preset, clone first then edit the clone
        if (isPreset) {
          const cloned = this.cloneFromPreset(map);
          if (cloned) {
            this.hide();
            this.onEditMapCallback(cloned);
          }
        } else {
          this.hide();
          this.onEditMapCallback(map);
        }
        break;
      }
      case 'clone': {
        if (isPreset) {
          // Clone preset into custom storage
          const cloned = this.cloneFromPreset(map);
          if (cloned) {
            MapStorage.saveMap(cloned);
            this.populateCards();
          }
        } else {
          const cloned = MapStorage.cloneMap(map.id);
          if (cloned) this.populateCards();
        }
        break;
      }
      case 'rename': {
        const nameEl = card.querySelector('.mm-card-name');
        if (!nameEl) return;

        const currentName = map.name;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'mm-card-name-input';
        input.value = currentName;
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        const finalize = () => {
          const newName = input.value.trim() || currentName;
          if (newName !== currentName) {
            MapStorage.renameMap(map.id, newName);
          }
          this.populateCards();
        };

        input.addEventListener('blur', finalize);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') {
            input.value = currentName;
            input.blur();
          }
        });
        break;
      }
      case 'delete': {
        if (confirm(`Delete "${map.name}"? This cannot be undone.`)) {
          MapStorage.deleteMap(map.id);
          this.populateCards();
        }
        break;
      }
      case 'export': {
        MapStorage.exportJSON(map);
        break;
      }
    }
  }

  private cloneFromPreset(preset: CustomMapData): CustomMapData {
    const cloned: CustomMapData = {
      ...preset,
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${preset.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      terrainHeights: [...preset.terrainHeights],
      spawnPoints: preset.spawnPoints.map((sp) => ({ ...sp })),
      mapObjects: preset.mapObjects.map((obj) => ({ ...obj })),
      waterBodies: preset.waterBodies.map((wb) => ({ ...wb })),
      gridData: preset.gridData ? [...preset.gridData] : undefined,
      terrainMaterials: preset.terrainMaterials ? [...preset.terrainMaterials] : undefined
    };
    return cloned;
  }

  private handleImport(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    MapStorage.importJSON(file)
      .then(() => {
        this.populateCards();
      })
      .catch((err) => {
        alert(`Import failed: ${err.message}`);
      });

    // Reset file input so the same file can be re-imported
    input.value = '';
  }
}
