# Debug Main Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Show Debug Path" setting that displays semi-transparent trail showing main path from start to finish, persisting across page refreshes.

**Architecture:** Simple floor decal approach using Three.js mesh positioned along main path cells. Setting stored in localStorage and integrated with existing settings system.

**Tech Stack:** TypeScript, Three.js, localStorage API

## Global Constraints

- Must persist across F5 refreshes using localStorage
- Must integrate with existing settings modal UI
- Must use existing main path data from MazeData
- Must work with all maze sizes and difficulties
- Must not impact gameplay performance
- Must be available in production to all players

---

### Task 1: Add localStorage Handling

**Files:**
- Modify: `G:\programming\GyroMouse_games\games\marble_maze\src\main.ts`

**Interfaces:**
- Produces: `loadDebugPathSetting(): boolean`, `saveDebugPathSetting(enabled: boolean): void`
- Produces: `debugPathEnabled: boolean` property

- [ ] **Step 1: Add debug path property and load method**

```typescript
// Add to Game class properties (around line 16)
private debugPathEnabled: boolean = false;

// Add load method after loadDifficulty()
private loadDebugPathSetting(): boolean {
  return localStorage.getItem('marble-maze-debug-path') === 'true';
}
```

- [ ] **Step 2: Add save method**

```typescript
// Add after saveDifficulty()
private saveDebugPathSetting(enabled: boolean) {
  localStorage.setItem('marble-maze-debug-path', enabled.toString());
}
```

- [ ] **Step 3: Load setting in constructor**

```typescript
// In constructor, after line 34
this.debugPathEnabled = this.loadDebugPathSetting();
```

- [ ] **Step 4: Update updateSettings to handle debug path**

```typescript
// Modify updateSettings method (around line 128)
private updateSettings(settings: Partial<InputSettings>, difficulty: Difficulty, debugPathEnabled?: boolean) {
  Object.assign(this.inputManager.settings, settings);
  if (difficulty !== this.currentDifficulty) {
    this.currentDifficulty = difficulty;
    this.saveDifficulty();
    this.generateNewLevel();
  }
  if (debugPathEnabled !== undefined && debugPathEnabled !== this.debugPathEnabled) {
    this.debugPathEnabled = debugPathEnabled;
    this.saveDebugPathSetting(debugPathEnabled);
    this.sceneManager.updateDebugPathVisibility(debugPathEnabled);
  }
}
```

- [ ] **Step 5: Pass debug path to scene manager**

```typescript
// In buildMazeMesh call (around line 90)
this.sceneManager.buildMazeMesh(this.currentMaze, this.debugPathEnabled);
```

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add games/marble_maze/src/main.ts
git commit -m "feat: add debug path localStorage handling"
```

---

### Task 2: Add UI Checkbox

**Files:**
- Modify: `G:\programming\GyroMouse_games\games\marble_maze\index.html`
- Modify: `G:\programming\GyroMouse_games\games\marble_maze\src\ui\hudManager.ts`

**Interfaces:**
- Consumes: Existing settings modal structure
- Produces: Debug path checkbox with event handlers
- Produces: Updated callbacks interface with debugPath parameter

- [ ] **Step 1: Add checkbox to HTML**

```html
<!-- Add to settings modal, after setting-seed group (around line 70)-->
<div class="modal-group">
  <label for="setting-debug-path">Show Debug Path</label>
  <input type="checkbox" id="setting-debug-path" class="modal-checkbox" style="width: 20px; height: 20px; cursor: pointer;" />
</div>
```

- [ ] **Step 2: Update callbacks interface**

```typescript
// Modify HudCallbacks interface (around line 4)
export interface HudCallbacks {
  onRestart: () => void;
  onNewRandom: () => void;
  onApplySeed: (seed: string) => void;
  onUpdateSettings: (settings: Partial<InputSettings>, difficulty: Difficulty, debugPathEnabled?: boolean) => void;
  onToggleMute: () => boolean;
}
```

- [ ] **Step 3: Load checkbox state in saveSettings**

```typescript
// Modify saveSettings method (around line 162)
private saveSettings() {
  const mode = (document.getElementById('setting-mode') as HTMLSelectElement).value as any;
  const mouseEnabled = (document.getElementById('setting-mouse-enable') as HTMLInputElement).checked;
  const difficulty = (document.getElementById('setting-difficulty') as HTMLSelectElement).value as Difficulty;
  const sensitivity = parseFloat((document.getElementById('setting-sensitivity') as HTMLInputElement).value);
  const customSeed = (document.getElementById('setting-seed') as HTMLInputElement).value.trim();
  const debugPathEnabled = (document.getElementById('setting-debug-path') as HTMLInputElement).checked;

  this.callbacks.onUpdateSettings(
    {
      mode,
      mouseEnabled,
      sensitivity
    },
    difficulty,
    debugPathEnabled
  );

  if (customSeed) {
    this.callbacks.onApplySeed(customSeed);
  }

  this.closeSettingsModal();
}
```

- [ ] **Step 4: Load saved state when opening settings**

```typescript
// Add to openSettingsModal method (around line 154)
public openSettingsModal() {
  this.settingsModal.classList.add('active');
  
  // Load debug path checkbox state
  const debugPathCheckbox = document.getElementById('setting-debug-path') as HTMLInputElement;
  if (debugPathCheckbox) {
    const isEnabled = localStorage.getItem('marble-maze-debug-path') === 'true';
    debugPathCheckbox.checked = isEnabled;
  }
}
```

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add games/marble_maze/index.html
git add games/marble_maze/src/ui/hudManager.ts
git commit -m "feat: add debug path UI checkbox"
```

---

### Task 3: Add Debug Path Rendering

**Files:**
- Modify: `G:\programming\GyroMouse_games\games\marble_maze\src\graphics\sceneManager.ts`

**Interfaces:**
- Consumes: `mazeData.mainPath` array
- Consumes: `debugPathEnabled` boolean from buildMazeMesh
- Produces: `updateDebugPathVisibility(visible: boolean): void` method

- [ ] **Step 1: Add debug path properties**

```typescript
// Add to SceneManager class properties (around line 12)
private debugPathMesh: THREE.Mesh | null = null;
private debugPathMaterial: THREE.Material | null = null;
```

- [ ] **Step 2: Update buildMazeMesh signature**

```typescript
// Modify method signature (around line 25)
public buildMazeMesh(mazeData: MazeData, debugPathEnabled: boolean = false) {
```

- [ ] **Step 3: Add debug path creation method**

```typescript
// Add new method after buildMazeMesh
private createDebugPath(mazeData: MazeData) {
  if (!mazeData.mainPath || mazeData.mainPath.length === 0) {
    console.warn('[SCENE DEBUG] No main path available for debug rendering');
    return;
  }

  // Clean up existing debug path
  if (this.debugPathMesh) {
    this.scene.remove(this.debugPathMesh);
    this.debugPathMesh.geometry.dispose();
    this.debugPathMesh = null;
  }

  // Create material
  this.debugPathMaterial = new THREE.MeshBasicMaterial({
    color: 0x64C8FF,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide
  });

  // Create geometry for path segments
  const cellSize = mazeData.cellSize;
  const pathWidth = cellSize * 0.8;
  const pathLength = cellSize * 0.8;
  const geometries: THREE.BufferGeometry[] = [];

  for (const pathCell of mazeData.mainPath) {
    const worldX = (pathCell.x - mazeData.width / 2) * cellSize + cellSize / 2;
    const worldZ = (pathCell.z - mazeData.height / 2) * cellSize + cellSize / 2;
    
    const geometry = new THREE.PlaneGeometry(pathWidth, pathLength);
    geometry.rotateX(Math.PI / 2); // Make horizontal
    geometry.translate(worldX, 0.01, worldZ); // Slightly above floor
    geometries.push(geometry);
  }

  // Merge geometries for performance
  const mergedGeometry = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries);
  this.debugPathMesh = new THREE.Mesh(mergedGeometry, this.debugPathMaterial);
  this.debugPathMesh.visible = this.debugPathEnabled;
  this.scene.add(this.debugPathMesh);

  console.log(`[SCENE DEBUG] Created debug path with ${mazeData.mainPath.length} segments`);
}
```

- [ ] **Step 4: Add visibility update method**

```typescript
// Add new method
public updateDebugPathVisibility(visible: boolean) {
  if (this.debugPathMesh) {
    this.debugPathMesh.visible = visible;
  }
  this.debugPathEnabled = visible;
}
```

- [ ] **Step 5: Call createDebugPath in buildMazeMesh**

```typescript
// Add at end of buildMazeMesh method
if (debugPathEnabled) {
  this.createDebugPath(mazeData);
}
```

- [ ] **Step 6: Add THREE import for BufferGeometryUtils**

```typescript
// Add to imports at top
import * as THREE from 'three';
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils';
```

- [ ] **Step 7: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add games/marble_maze/src/graphics/sceneManager.ts
git commit -m "feat: add debug path rendering"
```

---

### Task 4: Test and Verify

**Files:**
- Test: Manual testing in browser

**Interfaces:**
- Consumes: All implemented features
- Produces: Verified working feature

- [ ] **Step 1: Run development server**

```bash
npm run dev
```

- [ ] **Step 2: Test enabling debug path**
1. Open game in browser
2. Click settings button
3. Check "Show Debug Path" checkbox
4. Click "Save & Apply"
5. Verify semi-transparent blue path appears on maze floor

- [ ] **Step 3: Test persistence**
1. Refresh page (F5)
2. Verify debug path still visible
3. Open settings
4. Verify checkbox still checked

- [ ] **Step 4: Test disabling**
1. Uncheck "Show Debug Path"
2. Click "Save & Apply"
3. Verify path disappears
4. Refresh page
5. Verify path still hidden

- [ ] **Step 5: Test with different mazes**
1. Generate new random maze
2. Verify path updates correctly
3. Try different difficulties
4. Verify path scales appropriately

- [ ] **Step 6: Visual verification**
1. Path follows main route correctly
2. Semi-transparent and not distracting
3. Visible on all terrain types
4. Doesn't interfere with gameplay

- [ ] **Step 7: Console log verification**
1. Open browser console
2. Look for `[SCENE DEBUG]` messages
3. Verify path segment count matches expectations

- [ ] **Step 8: Commit verification results**

```bash
git add docs/superpowers/plans/2026-07-22-debug-main-path-implementation.md
git commit -m "test: verify debug path feature working"
```

---

## Self-Review Checklist

✅ **Spec coverage:** All requirements covered in tasks
✅ **Placeholder scan:** No TBD/TODO/implement later placeholders
✅ **Type consistency:** All method signatures consistent across tasks
✅ **File paths:** All paths are exact and absolute
✅ **Code completeness:** Every step has complete code examples
✅ **Testing:** Comprehensive manual testing plan included

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-07-22-debug-main-path-implementation.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** - Dispatch fresh subagent per task with two-stage review
2. **Inline Execution** - Execute tasks in this session using executing-plans with checkpoints

**Which approach?**