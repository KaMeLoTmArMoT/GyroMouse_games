import { LobbyConfig, CustomMapData } from '../types';
import { MapStorage } from '../editor/mapStorage';

export class MenuModal {
  private overlayEl: HTMLElement;

  public config: LobbyConfig = {
    teamSize: 2,
    wormHealth: 100,
    gameMode: 'deathmatch',
    mapId: 'random',
    aiDifficulty: 'normal'
  };

  private onStartMatchCallback: (config: LobbyConfig, mapData?: CustomMapData) => void;
  private onOpenEditorCallback: () => void;
  private onOpenSettingsCallback: () => void;

  constructor(
    onStartMatch: (config: LobbyConfig, mapData?: CustomMapData) => void,
    onOpenEditor: () => void,
    onOpenSettings: () => void
  ) {
    this.onStartMatchCallback = onStartMatch;
    this.onOpenEditorCallback = onOpenEditor;
    this.onOpenSettingsCallback = onOpenSettings;

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'wormixMenuModal';
    this.overlayEl.className = 'wormix-menu-backdrop';

    this.setupDOM();
  }

  private setupDOM(): void {
    this.overlayEl.innerHTML = `

      <style>
        .wormix-menu-backdrop {
          position: fixed;
          inset: 0;
          z-index: 5500;
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(16px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Outfit', system-ui, sans-serif;
          color: #f8fafc;
        }
        .wormix-menu-card {
          width: 540px;
          max-width: 90vw;
          background: rgba(30, 41, 59, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 24px;
          padding: 28px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
        }
        .menu-title {
          font-size: 28px;
          font-weight: 800;
          text-align: center;
          margin-bottom: 20px;
          background: linear-gradient(135deg, #38bdf8, #818cf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .menu-grid {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .menu-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(255, 255, 255, 0.05);
          padding: 10px 14px;
          border-radius: 12px;
        }
        .menu-label {
          font-size: 14px;
          font-weight: 600;
          color: #94a3b8;
        }
        .menu-select {
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: #f8fafc;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .menu-action-btn {
          width: 100%;
          padding: 14px;
          border-radius: 14px;
          border: none;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .btn-primary {
          background: linear-gradient(135deg, #16a34a, #22c55e);
          color: white;
          box-shadow: 0 4px 14px rgba(34, 197, 94, 0.4);
        }
        .btn-secondary {
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: white;
        }
        .btn-purple {
          background: linear-gradient(135deg, #7c3aed, #8b5cf6);
          color: white;
        }
        .btn-primary:hover, .btn-secondary:hover, .btn-purple:hover {
          transform: translateY(-2px);
        }
      </style>
      <div class="wormix-menu-card">
        <div class="menu-title">🐛💥 WORMIX</div>
        <div class="menu-grid">
          <button class="menu-action-btn btn-primary" id="btnQuickPlay">🎮 QUICK PLAY</button>
          
          <div class="menu-row">
            <span class="menu-label">👥 Team Size</span>
            <select class="menu-select" id="selectTeamSize">
              <option value="1">1 vs 1</option>
              <option value="2" selected>2 vs 2</option>
              <option value="3">3 vs 3</option>
            </select>
          </div>

          <div class="menu-row">
            <span class="menu-label">❤️ Worm Health</span>
            <select class="menu-select" id="selectHealth">
              <option value="50">50 HP</option>
              <option value="100" selected>100 HP</option>
              <option value="150">150 HP</option>
              <option value="200">200 HP</option>
            </select>
          </div>

          <div class="menu-row">
            <span class="menu-label">🏆 Game Mode</span>
            <select class="menu-select" id="selectGameMode">
              <option value="deathmatch" selected>Classic Deathmatch</option>
              <option value="rising_water">🌊 Rising Water (Sudden Death)</option>
              <option value="fort_warfare">🏰 Fort Warfare</option>
            </select>
          </div>

          <div class="menu-row">
            <span class="menu-label">🗺️ Selected Map</span>
            <select class="menu-select" id="selectMap"></select>
          </div>

          <button class="menu-action-btn btn-secondary" id="btnStartLobbyMatch">⚔️ START CUSTOM MATCH</button>
          <button class="menu-action-btn btn-purple" id="btnOpenEditorModal">🛠️ MAP EDITOR</button>
          <button class="menu-action-btn" id="btnOpenSettingsModal" style="background:rgba(255,255,255,0.1); color:#94a3b8">⚙️ SETTINGS</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlayEl);
    this.populateMapSelect();
    this.bindEvents();
  }

  private populateMapSelect(): void {
    const select = this.overlayEl.querySelector('#selectMap') as HTMLSelectElement;
    if (!select) return;

    select.innerHTML = `<option value="random">🎲 Random Procedural</option>`;

    // Add Presets
    const presets = MapStorage.getPresetMaps(window.innerWidth, window.innerHeight);
    presets.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });

    // Add Custom Saved Maps
    const saved = MapStorage.getSavedMaps();
    saved.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `⭐ ${s.name}`;
      select.appendChild(opt);
    });
  }

  private bindEvents(): void {
    const el = this.overlayEl;

    el.querySelector('#btnQuickPlay')?.addEventListener('click', () => {
      this.hide();
      this.onStartMatchCallback(this.config);
    });

    el.querySelector('#btnStartLobbyMatch')?.addEventListener('click', () => {
      const teamSize = parseInt((el.querySelector('#selectTeamSize') as HTMLSelectElement).value, 10);
      const wormHealth = parseInt((el.querySelector('#selectHealth') as HTMLSelectElement).value, 10);
      const gameMode = (el.querySelector('#selectGameMode') as HTMLSelectElement).value as any;
      const mapId = (el.querySelector('#selectMap') as HTMLSelectElement).value;

      this.config.teamSize = teamSize;
      this.config.wormHealth = wormHealth;
      this.config.gameMode = gameMode;
      this.config.mapId = mapId;

      let mapData: CustomMapData | undefined;
      if (mapId !== 'random') {
        const presets = MapStorage.getPresetMaps(window.innerWidth, window.innerHeight);
        const saved = MapStorage.getSavedMaps();
        mapData = [...presets, ...saved].find((m) => m.id === mapId);
      }

      this.hide();
      this.onStartMatchCallback(this.config, mapData);
    });

    el.querySelector('#btnOpenEditorModal')?.addEventListener('click', () => {
      this.hide();
      this.onOpenEditorCallback();
    });

    el.querySelector('#btnOpenSettingsModal')?.addEventListener('click', () => {
      this.onOpenSettingsCallback();
    });
  }

  public toggle(): void {
    if (this.overlayEl.style.display === 'none' || !this.overlayEl.style.display) {
      this.show();
    } else {
      this.hide();
    }
  }

  public show(): void {
    this.populateMapSelect();
    this.overlayEl.style.display = 'flex';
  }

  public hide(): void {
    this.overlayEl.style.display = 'none';
  }
}

