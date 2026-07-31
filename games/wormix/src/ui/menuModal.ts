import { LobbyConfig, CustomMapData, AIDifficulty, GameMode } from '../types';
import { MapStorage } from '../editor/mapStorage';

export class MenuModal {
  private overlayEl: HTMLElement;

  public config: LobbyConfig = {
    teamSize: 2,
    wormHealth: 100,
    gameMode: 'deathmatch',
    mapId: 'random',
    aiDifficulty: 'normal',
    matchType: 'ai'
  };

  private onStartMatchCallback: (config: LobbyConfig, mapData?: CustomMapData) => void;
  private onOpenEditorCallback: () => void;
  private onOpenMapManagerCallback: () => void;

  constructor(
    onStartMatch: (config: LobbyConfig, mapData?: CustomMapData) => void,
    onOpenEditor: () => void,
    onOpenMapManager: () => void
  ) {
    this.onStartMatchCallback = onStartMatch;
    this.onOpenEditorCallback = onOpenEditor;
    this.onOpenMapManagerCallback = onOpenMapManager;

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
          width: 560px;
          max-width: 92vw;
          background: rgba(30, 41, 59, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 24px;
          padding: 28px;
          box-shadow: 0 25px 60px -12px rgba(0, 0, 0, 0.7);
          max-height: 90vh;
          overflow-y: auto;
        }
        .wormix-menu-card::-webkit-scrollbar { width: 6px; }
        .wormix-menu-card::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }

        .menu-title {
          font-size: 28px;
          font-weight: 800;
          text-align: center;
          margin-bottom: 20px;
          background: linear-gradient(135deg, #38bdf8, #818cf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        /* ── Action button rows ── */
        .menu-action-row {
          display: flex;
          gap: 10px;
          margin-bottom: 12px;
        }
        .menu-action-btn {
          flex: 1;
          padding: 14px 12px;
          border-radius: 14px;
          border: none;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-family: inherit;
        }
        .menu-action-btn:hover {
          transform: translateY(-2px);
        }
        .btn-quick {
          background: linear-gradient(135deg, #16a34a, #22c55e);
          color: white;
          box-shadow: 0 4px 14px rgba(34, 197, 94, 0.35);
        }
        .btn-custom {
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: white;
          box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3);
        }
        .btn-custom .chevron {
          display: inline-block;
          transition: transform 0.2s ease;
          font-size: 12px;
          margin-left: 2px;
        }
        .btn-custom.expanded .chevron {
          transform: rotate(90deg);
        }
        .btn-editor {
          background: linear-gradient(135deg, #7c3aed, #8b5cf6);
          color: white;
        }
        .btn-mapmanager {
          background: linear-gradient(135deg, #0891b2, #22d3ee);
          color: white;
        }
        .btn-start {
          background: linear-gradient(135deg, #059669, #10b981);
          color: white;
          box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
        }
        .btn-start:hover {
          box-shadow: 0 6px 20px rgba(16, 185, 129, 0.45);
        }

        /* ── Divider ── */
        .menu-divider {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
        }
        .menu-divider::before,
        .menu-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
        }
        .menu-divider span {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          color: #64748b;
          white-space: nowrap;
        }

        /* ── Settings rows ── */
        .menu-settings {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 12px;
        }
        .menu-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.04);
        }
        .menu-label {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          white-space: nowrap;
        }

        /* ── Pill group ── */
        .pill-group {
          display: flex;
          gap: 4px;
          background: rgba(0, 0, 0, 0.25);
          border-radius: 8px;
          padding: 3px;
        }
        .pill {
          padding: 5px 12px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          color: #94a3b8;
          background: transparent;
          transition: background 0.15s, color 0.15s;
          white-space: nowrap;
        }
        .pill:hover {
          color: #e2e8f0;
          background: rgba(255, 255, 255, 0.08);
        }
        .pill.active {
          background: rgba(99, 102, 241, 0.5);
          color: #f1f5f9;
          box-shadow: 0 1px 4px rgba(99, 102, 241, 0.3);
        }

        /* ── Dropdown (kept for Game Mode & Map) ── */
        .menu-select {
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #f8fafc;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          max-width: 220px;
        }
        .menu-select option {
          background: #1e293b;
          color: #f8fafc;
        }
      </style>

      <div class="wormix-menu-card">
        <div class="menu-title">🐛💥 WORMIX</div>

        <!-- Row 1: Quick Play + Custom Match -->
        <div class="menu-action-row">
          <button class="menu-action-btn btn-quick" id="btnQuickPlay">🎮 Quick Play</button>
          <button class="menu-action-btn btn-custom" id="btnCustomMatch">⚔️ Custom Match <span class="chevron">▸</span></button>
        </div>

        <!-- Custom match settings (collapsed by default) -->
        <div id="customSettings" style="display:none;">
          <div class="menu-divider"><span>Match Settings</span></div>

          <div class="menu-settings">
            <div class="menu-row">
              <span class="menu-label">🤖 Match Type</span>
              <div class="pill-group" data-setting="matchType">
                <button class="pill active" data-value="ai">🤖 AI</button>
                <button class="pill" data-value="pvp">👥 PvP</button>
              </div>
            </div>

            <div class="menu-row" id="rowDifficulty">
              <span class="menu-label">🎯 Difficulty</span>
              <div class="pill-group" data-setting="difficulty">
                <button class="pill" data-value="easy">🐣 Easy</button>
                <button class="pill active" data-value="normal">🎯 Normal</button>
                <button class="pill" data-value="hard">🔥 Hard</button>
              </div>
            </div>

            <div class="menu-row">
              <span class="menu-label">👥 Team Size</span>
              <div class="pill-group" data-setting="teamSize">
                <button class="pill" data-value="1">1v1</button>
                <button class="pill active" data-value="2">2v2</button>
                <button class="pill" data-value="3">3v3</button>
              </div>
            </div>

            <div class="menu-row">
              <span class="menu-label">❤️ Health</span>
              <div class="pill-group" data-setting="health">
                <button class="pill" data-value="50">50</button>
                <button class="pill active" data-value="100">100</button>
                <button class="pill" data-value="150">150</button>
                <button class="pill" data-value="200">200</button>
              </div>
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
              <span class="menu-label">🗺️ Map</span>
              <select class="menu-select" id="selectMap"></select>
            </div>
          </div>
        </div>

        <!-- Start Match (own row, synced visibility with customSettings) -->
        <div class="menu-action-row" id="startMatchRow" style="display:none;">
          <button class="menu-action-btn btn-start" id="btnStartLobbyMatch">⚔️ START MATCH</button>
        </div>

        <!-- Row 2: Map Editor + Map Manager -->
        <div class="menu-action-row">
          <button class="menu-action-btn btn-editor" id="btnOpenEditorModal">🛠️ Map Editor</button>
          <button class="menu-action-btn btn-mapmanager" id="btnOpenMapManager">🗂️ Map Manager</button>
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

    const presets = MapStorage.getPresetMaps(window.innerWidth, window.innerHeight);
    presets.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      select.appendChild(opt);
    });

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

    // ── Pill group selection ──
    el.querySelectorAll('.pill-group').forEach((group) => {
      group.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement).closest('.pill') as HTMLElement | null;
        if (!target) return;

        group.querySelectorAll('.pill').forEach((p) => p.classList.remove('active'));
        target.classList.add('active');

        const setting = (group as HTMLElement).dataset.setting;
        if (setting === 'matchType') {
          this.config.matchType = target.dataset.value as 'ai' | 'pvp';
          const diffRow = el.querySelector('#rowDifficulty') as HTMLElement;
          if (diffRow) diffRow.style.display = this.config.matchType === 'pvp' ? 'none' : 'flex';
        } else if (setting === 'difficulty') {
          this.config.aiDifficulty = target.dataset.value as AIDifficulty;
        } else if (setting === 'teamSize') {
          this.config.teamSize = parseInt(target.dataset.value!, 10);
        } else if (setting === 'health') {
          this.config.wormHealth = parseInt(target.dataset.value!, 10);
        }
      });
    });

    // ── Quick Play ──
    el.querySelector('#btnQuickPlay')?.addEventListener('click', () => {
      this.hide();
      this.onStartMatchCallback(this.config);
    });

    // ── Custom Match toggle ──
    const customSettings = el.querySelector('#customSettings') as HTMLElement;
    const startMatchRow = el.querySelector('#startMatchRow') as HTMLElement;
    const btnCustom = el.querySelector('#btnCustomMatch') as HTMLElement;

    el.querySelector('#btnCustomMatch')?.addEventListener('click', () => {
      const isOpen = customSettings.style.display !== 'none';
      customSettings.style.display = isOpen ? 'none' : 'block';
      startMatchRow.style.display = isOpen ? 'none' : 'flex';
      btnCustom.classList.toggle('expanded', !isOpen);
    });

    // ── Start Custom Match ──
    el.querySelector('#btnStartLobbyMatch')?.addEventListener('click', () => {
      this.startCustomMatch();
    });

    // ── Map Editor ──
    el.querySelector('#btnOpenEditorModal')?.addEventListener('click', () => {
      this.hide();
      this.onOpenEditorCallback();
    });

    // ── Map Manager ──
    el.querySelector('#btnOpenMapManager')?.addEventListener('click', () => {
      this.hide();
      this.onOpenMapManagerCallback();
    });
  }

  private startCustomMatch(): void {
    const el = this.overlayEl;

    const gameMode = (el.querySelector('#selectGameMode') as HTMLSelectElement).value as GameMode;
    const mapId = (el.querySelector('#selectMap') as HTMLSelectElement).value;

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
    // Reset custom settings to collapsed
    const customSettings = this.overlayEl.querySelector('#customSettings') as HTMLElement;
    const startMatchRow = this.overlayEl.querySelector('#startMatchRow') as HTMLElement;
    const btnCustom = this.overlayEl.querySelector('#btnCustomMatch') as HTMLElement;
    if (customSettings) customSettings.style.display = 'none';
    if (startMatchRow) startMatchRow.style.display = 'none';
    if (btnCustom) btnCustom.classList.remove('expanded');
  }

  public hide(): void {
    this.overlayEl.style.display = 'none';
  }
}
