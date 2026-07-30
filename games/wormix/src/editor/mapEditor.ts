import {
  CustomMapData,
  MapObjectType,
  CELL_AIR,
  CELL_GRASS,
  CELL_DIRT,
  CELL_STONE,
  CELL_SAND,
  CELL_WATER,
  CELL_ACID
} from '../types';
import { TerrainManager } from '../terrain/terrainManager';
import { MapStorage } from './mapStorage';

export type EditorSpawnType = 'red_spawn_1' | 'red_spawn_2' | 'blue_spawn_1' | 'blue_spawn_2';
export type EditorToolType = 'brush' | MapObjectType | EditorSpawnType;

export class MapEditor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private containerEl: HTMLElement;

  public activeMap: CustomMapData;
  public terrainInstance: TerrainManager;
  private isDrawing: boolean = false;
  private currentTool: EditorToolType = 'brush';
  private currentCellType: number = CELL_GRASS;
  private brushRadius: number = 18;

  public physicsEnabled: boolean = true;
  public previewMode: boolean = false;
  private savedSnapshot: Uint8Array | null = null;

  private onTestPlayCallback: (map: CustomMapData) => void;
  private onExitCallback: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    onTestPlay: (map: CustomMapData) => void,
    onExit: () => void,
    initialMap?: CustomMapData
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onTestPlayCallback = onTestPlay;
    this.onExitCallback = onExit;

    this.containerEl = document.createElement('div');
    this.containerEl.id = 'mapEditorUI';
    this.containerEl.className = 'wormix-editor-overlay';

    this.terrainInstance = new TerrainManager(canvas.width, canvas.height);
    if (initialMap) {
      this.activeMap = initialMap;
      if (initialMap.gridData && initialMap.gridData.length === this.terrainInstance.grid.length) {
        this.terrainInstance.grid.set(initialMap.gridData);
        this.terrainInstance.rebuildSurfaceCache();
      } else if (initialMap.terrainHeights) {
        this.terrainInstance.buildTerrainFromHeights(
          initialMap.terrainHeights,
          initialMap.waterY,
          initialMap.terrainMaterials,
          initialMap.gridData
        );
      }
    } else {
      this.activeMap = this.createBlankMap('New Custom Map');
    }
    this.saveSnapshot();
    this.setupUI();
    this.bindEvents();
  }

  public saveSnapshot(): void {
    this.savedSnapshot = new Uint8Array(this.terrainInstance.grid);
  }

  public restoreSnapshot(): void {
    if (this.savedSnapshot) {
      this.terrainInstance.grid.set(this.savedSnapshot);
      this.terrainInstance.rebuildSurfaceCache();
    }
  }

  private createBlankMap(name: string): CustomMapData {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const waterY = h - 40;
    const heights = new Array(w).fill(h * 0.65);

    return {
      id: `custom_${Date.now()}`,
      name,
      createdAt: Date.now(),
      width: w,
      height: h,
      waterY,
      terrainHeights: heights,
      spawnPoints: [
        { x: w * 0.2, y: h * 0.65 - 14, team: 'player' },
        { x: w * 0.35, y: h * 0.65 - 14, team: 'player' },
        { x: w * 0.65, y: h * 0.65 - 14, team: 'ai' },
        { x: w * 0.8, y: h * 0.65 - 14, team: 'ai' }
      ],
      mapObjects: [
        { id: 'b1', type: 'barrel', x: w * 0.25, y: h * 0.65 - 14 },
        { id: 'm1', type: 'landmine', x: w * 0.75, y: h * 0.65 - 14 },
        { id: 'c1', type: 'health_crate', x: w * 0.5, y: h * 0.65 - 14 }
      ],
      waterBodies: []
    };
  }

  private setupUI(): void {
    this.containerEl.innerHTML = `
      <style>
        .wormix-editor-overlay {
          position: absolute;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 6000;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          justify-content: center;
          padding: 8px 14px;
          background: rgba(15, 23, 42, 0.92);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 18px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
          color: white;
          font-family: 'Outfit', system-ui, sans-serif;
          user-select: none;
          max-width: 95vw;
          transition: all 0.2s ease;
        }
        .wormix-editor-overlay.preview-active .editor-hide-in-preview {
          display: none !important;
        }
        .editor-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .editor-btn {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #f8fafc;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .editor-btn:hover {
          background: rgba(255, 255, 255, 0.25);
          transform: translateY(-1px);
        }
        .editor-btn.active {
          background: #2563eb !important;
          border-color: #60a5fa !important;
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.8) !important;
          transform: scale(1.05);
        }
        .editor-divider {
          width: 1px;
          height: 22px;
          background: rgba(255, 255, 255, 0.2);
          margin: 0 2px;
        }
      </style>
      <div class="editor-group editor-hide-in-preview">
        <button class="editor-btn active" id="btnMatGrass" style="background:#15803d">Grass</button>
        <button class="editor-btn" id="btnMatDirt" style="background:#78350f">Dirt</button>
        <button class="editor-btn" id="btnMatStone" style="background:#64748b">Stone</button>
        <button class="editor-btn" id="btnMatSand" style="background:#f59e0b">Sand</button>
        <button class="editor-btn" id="btnWater" style="background:#0284c7">🌊 Water</button>
        <button class="editor-btn" id="btnAcid" style="background:#22c55e">🧪 Acid</button>
        <button class="editor-btn" id="btnMatEraser" style="background:#ef4444">Eraser</button>
      </div>
      <div class="editor-divider editor-hide-in-preview"></div>
      <div class="editor-group editor-hide-in-preview">
        <button class="editor-btn" id="btnRed1">🔴 Red #1</button>
        <button class="editor-btn" id="btnRed2">🔴 Red #2</button>
        <button class="editor-btn" id="btnBlue1">🔵 Blue #1</button>
        <button class="editor-btn" id="btnBlue2">🔵 Blue #2</button>
      </div>
      <div class="editor-divider editor-hide-in-preview"></div>
      <div class="editor-group editor-hide-in-preview">
        <button class="editor-btn" id="btnBarrel">🛢️ Barrel</button>
        <button class="editor-btn" id="btnMine">💣 Mine</button>
        <button class="editor-btn" id="btnCrate">🧰 Crate</button>
      </div>
      <div class="editor-divider editor-hide-in-preview"></div>
      <div class="editor-group">
        <button class="editor-btn" id="btnTogglePhysics" style="background:#0284c7">⏸️ Pause Flow</button>
        <button class="editor-btn editor-hide-in-preview" id="btnResetPhysics" style="background:#d97706">🔄 Reset Grid</button>
        <button class="editor-btn" id="btnTogglePreview" style="background:#6366f1">👁️ Preview</button>
      </div>
      <div class="editor-divider editor-hide-in-preview"></div>
      <div class="editor-group editor-hide-in-preview">
        <button class="editor-btn" id="btnSaveMap" style="background:#16a34a">💾 Save</button>
        <button class="editor-btn" id="btnTestPlay" style="background:#8b5cf6">▶️ Test Play</button>
        <button class="editor-btn" id="btnExitEditor" style="background:#dc2626">✕ Exit</button>
      </div>
    `;

    document.body.appendChild(this.containerEl);
  }

  private highlightActiveButton(activeId: string): void {
    const btns = this.containerEl.querySelectorAll('.editor-btn');
    btns.forEach((btn) => {
      if (btn.id === activeId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  private bindEvents(): void {
    const el = this.containerEl;

    // Materials
    el.querySelector('#btnMatGrass')?.addEventListener('click', () => {
      this.currentTool = 'brush';
      this.currentCellType = CELL_GRASS;
      this.highlightActiveButton('btnMatGrass');
    });

    el.querySelector('#btnMatDirt')?.addEventListener('click', () => {
      this.currentTool = 'brush';
      this.currentCellType = CELL_DIRT;
      this.highlightActiveButton('btnMatDirt');
    });

    el.querySelector('#btnMatStone')?.addEventListener('click', () => {
      this.currentTool = 'brush';
      this.currentCellType = CELL_STONE;
      this.highlightActiveButton('btnMatStone');
    });

    el.querySelector('#btnMatSand')?.addEventListener('click', () => {
      this.currentTool = 'brush';
      this.currentCellType = CELL_SAND;
      this.highlightActiveButton('btnMatSand');
    });

    el.querySelector('#btnWater')?.addEventListener('click', () => {
      this.currentTool = 'brush';
      this.currentCellType = CELL_WATER;
      this.highlightActiveButton('btnWater');
    });

    el.querySelector('#btnAcid')?.addEventListener('click', () => {
      this.currentTool = 'brush';
      this.currentCellType = CELL_ACID;
      this.highlightActiveButton('btnAcid');
    });

    el.querySelector('#btnMatEraser')?.addEventListener('click', () => {
      this.currentTool = 'brush';
      this.currentCellType = CELL_AIR;
      this.highlightActiveButton('btnMatEraser');
    });

    // Worm Spawns
    el.querySelector('#btnRed1')?.addEventListener('click', () => {
      this.currentTool = 'red_spawn_1';
      this.highlightActiveButton('btnRed1');
    });

    el.querySelector('#btnRed2')?.addEventListener('click', () => {
      this.currentTool = 'red_spawn_2';
      this.highlightActiveButton('btnRed2');
    });

    el.querySelector('#btnBlue1')?.addEventListener('click', () => {
      this.currentTool = 'blue_spawn_1';
      this.highlightActiveButton('btnBlue1');
    });

    el.querySelector('#btnBlue2')?.addEventListener('click', () => {
      this.currentTool = 'blue_spawn_2';
      this.highlightActiveButton('btnBlue2');
    });

    // Map Objects
    el.querySelector('#btnBarrel')?.addEventListener('click', () => {
      this.currentTool = 'barrel';
      this.highlightActiveButton('btnBarrel');
    });

    el.querySelector('#btnMine')?.addEventListener('click', () => {
      this.currentTool = 'landmine';
      this.highlightActiveButton('btnMine');
    });

    el.querySelector('#btnCrate')?.addEventListener('click', () => {
      this.currentTool = 'health_crate';
      this.highlightActiveButton('btnCrate');
    });

    // Physics Controls & Preview Toggle
    const physBtn = el.querySelector('#btnTogglePhysics');
    physBtn?.addEventListener('click', () => {
      this.physicsEnabled = !this.physicsEnabled;
      if (physBtn) {
        physBtn.textContent = this.physicsEnabled ? '⏸️ Pause Flow' : '▶️ Resume Flow';
        (physBtn as HTMLElement).style.background = this.physicsEnabled ? '#0284c7' : '#16a34a';
      }
    });

    el.querySelector('#btnResetPhysics')?.addEventListener('click', () => {
      this.restoreSnapshot();
    });

    const prevBtn = el.querySelector('#btnTogglePreview');
    prevBtn?.addEventListener('click', () => {
      this.previewMode = !this.previewMode;
      if (this.previewMode) {
        this.containerEl.classList.add('preview-active');
        if (prevBtn) {
          prevBtn.textContent = '✏️ Edit Mode';
          (prevBtn as HTMLElement).style.background = '#2563eb';
        }
      } else {
        this.containerEl.classList.remove('preview-active');
        if (prevBtn) {
          prevBtn.textContent = '👁️ Preview';
          (prevBtn as HTMLElement).style.background = '#6366f1';
        }
      }
    });

    // Actions
    el.querySelector('#btnSaveMap')?.addEventListener('click', () => this.saveCurrentMap());
    el.querySelector('#btnTestPlay')?.addEventListener('click', () => {
      this.syncGridToMapData();
      this.onTestPlayCallback(this.activeMap);
    });
    el.querySelector('#btnExitEditor')?.addEventListener('click', () => this.exit());

    // Mouse Canvas Painting
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.previewMode) return;
      this.isDrawing = true;
      this.paintAt(e.clientX, e.clientY);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.previewMode) return;
      if (this.isDrawing) {
        this.paintAt(e.clientX, e.clientY);
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isDrawing = false;
    });
  }

  private paintAt(mouseX: number, mouseY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor(mouseX - rect.left);
    const y = Math.floor(mouseY - rect.top);

    if (this.currentTool === 'brush') {
      this.terrainInstance.spawnElementStream(x, y, this.currentCellType, this.brushRadius);
    } else if (this.currentTool === 'red_spawn_1') {
      const groundY = this.terrainInstance.getSurfaceY(x) - 14;
      this.activeMap.spawnPoints[0] = { x, y: groundY, team: 'player' };
    } else if (this.currentTool === 'red_spawn_2') {
      const groundY = this.terrainInstance.getSurfaceY(x) - 14;
      this.activeMap.spawnPoints[1] = { x, y: groundY, team: 'player' };
    } else if (this.currentTool === 'blue_spawn_1') {
      const groundY = this.terrainInstance.getSurfaceY(x) - 14;
      this.activeMap.spawnPoints[2] = { x, y: groundY, team: 'ai' };
    } else if (this.currentTool === 'blue_spawn_2') {
      const groundY = this.terrainInstance.getSurfaceY(x) - 14;
      this.activeMap.spawnPoints[3] = { x, y: groundY, team: 'ai' };
    } else if (this.currentTool === 'barrel' || this.currentTool === 'landmine' || this.currentTool === 'health_crate') {
      const groundY = this.terrainInstance.getSurfaceY(x) - 14;
      this.activeMap.mapObjects.push({
        id: `obj_${Date.now()}_${Math.random()}`,
        type: this.currentTool as MapObjectType,
        x,
        y: groundY
      });
    }
  }

  private syncGridToMapData(): void {
    this.activeMap.gridData = Array.from(this.terrainInstance.grid);
  }

  private saveCurrentMap(): void {
    const name = prompt('Enter a name for your custom map:', this.activeMap.name) || 'My Custom Map';
    this.activeMap.name = name;
    this.syncGridToMapData();
    MapStorage.saveMap(this.activeMap);
    alert(`Map "${name}" saved to LocalStorage!`);
  }

  public render(): void {
    // 1. Update Cellular Automata Physics Engine in real-time inside Editor
    if (this.physicsEnabled || this.previewMode) {
      this.terrainInstance.updatePhysics();
    }

    // 2. Render Cellular Automata Grid
    this.terrainInstance.draw(this.ctx);

    const ctx = this.ctx;

    // 3. Render Spawns (P1, P2, AI1, AI2)
    this.activeMap.spawnPoints.forEach((sp, idx) => {
      if (!sp) return;
      ctx.save();
      ctx.fillStyle = sp.team === 'player' ? '#ef4444' : '#3b82f6';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(sp.team === 'player' ? `P${idx + 1}` : `AI${idx - 1}`, sp.x, sp.y + 4);
      ctx.restore();
    });

    // 4. Render Objects (Barrels, Mines, Crates) resting on ground
    this.activeMap.mapObjects.forEach((obj) => {
      ctx.save();
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      const icon = obj.type === 'barrel' ? '🛢️' : obj.type === 'landmine' ? '💣' : '🧰';
      ctx.fillText(icon, obj.x, obj.y + 6);
      ctx.restore();
    });
  }

  public exit(): void {
    if (this.containerEl.parentNode) {
      this.containerEl.parentNode.removeChild(this.containerEl);
    }
    this.onExitCallback();
  }
}
