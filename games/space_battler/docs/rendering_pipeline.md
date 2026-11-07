# Space Battler Canvas 2D rendering

## Current frame pipeline

`frontend/src/canvas/TacticalCanvas.tsx` advances the simulation and visual effects in the animation loop when running and focused. It clears and fills the canvas, then applies camera translation and zoom before drawing in world coordinates. In painter's order, the main layers are the tactical grid and indicators; effects, beams, explosions, particles and flak; projectiles; haven tethers; ships; selection and guidance overlays; shield impacts and sparks. `effects.ts`, `projectileRenderer.ts`, `havenRenderer.ts`, and `shipRenderer.ts` own the corresponding drawing details. The ship preview uses a separate `renderShipPreview` path, including a screen-offset lower hull and preview lighting.

`viewport.ts` converts the canvas bounds through the camera into a world-space rectangle with 180 world units of padding. Conservative disc and segment bounding-box tests skip many offscreen ships, projectiles, beams and effects. Ships use the larger of twice their size and their shield envelope; selected ships bypass that test so their long-range overlays remain visible. Docked ships are skipped. Not every layer is culled: for example, haven tethers and some tactical overlays are drawn independently. Culling affects rendering, not simulation updates.

`glowSprites.ts` lazily creates a 64×64 radial gradient on an HTML canvas for each color. `drawGlowLine` rotates and stretches its middle slice along a segment and draws the two half-sprite caps at its ends; a zero-length segment makes a round glow. Beams, projectile effects and shield impacts can reuse these sprites instead of repeatedly rendering a blurred line. Other effects still use their own gradients or shadows.

## Phase 2: pre-rendered hull sprites

The battlefield uses `ShipSpriteCache` for all eight static hulls; the preview retains procedural vectors and its lighting and offset lower hull. A cache instance takes a fixed bitmap size and a static-hull drawing callback; `get(hullClass, team)` lazily creates an `OffscreenCanvas` once per pair. Unsupported offscreen rendering retains the vector fallback. `shipRenderer.ts` bounds the instances to 32, keyed by hull, team, exact ship size, raster resolution and hardpoint layout (offsets, base radii and weapon types). Thus cached deck sockets follow the current loadout without baking turret aiming or firing into the sprite. Size-specific rasterization preserves fixed-width strokes. Sprites are centered with 1.6× hull-size padding plus four world units, at least three pixels per world unit; higher camera scales select power-of-two resolution tiers. Smooth rotation/scaling keeps heading and world size unchanged. `clear()` invalidates an instance when its drawing implementation or palette changes.

The static drawing path excludes carrier recess lights, tender lights, the alien battleship eye and speed-dependent Terran detail plumes. Those remain live overlays; plume roots are covered by nozzle geometry and corvette plumes retain their hull clip. Engine glow and coolant trails stay behind the hull; damage, independently aimed turrets and muzzle flashes, selection cones, shield and haven arcs, and HP/status bars retain their frame-time rendering. Do not bake a whole `renderShip` or `renderShipPreview` result into a shared sprite.

### Adding hulls and skins

1. Add the hull's procedural geometry and faction-specific palette in `shipRenderer.ts`, with hardpoints and shield envelope consistent with the simulation. Keep the vector path working for previews and fallback.
2. Separate truly static geometry from time-, speed-, health-, loadout- and instance-dependent details before opting that hull into the cache. Preserve draw order, clipping, gradients, line widths and local origin; use the vector path for hulls that have not been split.
3. For custom faction skins, ensure the cache identity includes every visual variant. The current `(hullClass, team)` key only works when a team has one fixed skin and hull layout; use a separate cache instance per fixed skin or extend the key and invalidation before allowing variants on the same team. Clear affected caches when assets or palettes change.
4. Compare cached and vector output for both factions at multiple headings, zoom levels and sizes, including damage, firing, shield havens, ingress, debris and preview states. Check edges, transparency, shadows and animations; retain vector rendering wherever fidelity differs.

### Fidelity and memory budget

Choose sprite resolution and transparent padding to include the full hull, strokes and shadows without clipping. Rasterize at a representative scale and compare at the maximum supported zoom; fixed-width strokes and per-ship size variation may require size-specific keys or a vector fallback rather than scaling one bitmap. Avoid caching a preview's dynamic lighting as a static battle hull. Smooth bitmap rotation and scaling can soften fine details, so only enable a class after visual comparison.

An RGBA bitmap costs approximately `width × height × 4` bytes: 128×128 is 64 KiB and 256×256 is 256 KiB per hull/team entry, excluding browser overhead. For eight hull classes and two teams this is roughly 1 MiB or 4 MiB respectively; additional skins, resolutions or layout variants multiply that cost. Allocate lazily, clear obsolete caches, and budget for canvas/browser overhead and any future eviction policy before adding unbounded variants.
