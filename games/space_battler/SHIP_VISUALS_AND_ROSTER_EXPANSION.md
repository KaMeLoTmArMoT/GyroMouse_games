# Space Battler — Ship Visual Detailing Plan & Future Roster Expansion

## Part 1: 4-Pass Procedural Hull Visual Upgrade (`shipRenderer.ts` & `ShipSilhouette`)

### Architectural Constraint (Zero Hitbox / Area Regression)
- The outer hull perimeter of all 4 classes (`strike_craft`, `corvette`, `cruiser`, `battleship`) is calibrated against `backend/tests/test_hull_geometry.py` (< 5% area delta between Terran & Alien, strictly inside the `1.40x` shield bubble).
- Currently, `drawTerranHull` and `drawAlienHull` draw the **exact same generic bridge square + single line** (Terran) or **single red dot + arc** (Alien) across all 4 ship classes!
- By keeping the calibrated outer silhouette intact and replacing the generic interior overlay with **class-specific multi-layered structural detailing**, we achieve 2x–3x richer visuals with zero hitbox/balance regressions.

---

### Pass 1: Strike Craft (`strike_craft`, `size = 11`) — Clean Micro-Detailing (1.5x)
*Goal: Crisp, readable details at small scale without visual clutter.*
- **Terran Viper Interceptor:**
  - Tinted armored canopy glass (`#0ea5e9` / `#38bdf8` diamond cockpit near prow).
  - Wing root panel seams & forward plasma gun barrel ports.
  - Twin compact recessed thruster nozzles at the tail (`-s * 0.72`) with dynamic velocity-scaled exhaust plumes.
- **Alien Raider Bio-Crescent:**
  - Forward-swept wing vein ribs (`accentColor` quadratic curves along both crescent arms).
  - Glowing crimson Cylon-style slit visor (`#ef4444`) near the inner prow curve.
  - Twin bio-plasma vents at the rear wing roots.

---

### Pass 2: Corvettes (`corvette`, `size = 20`) — Escort Detailing (2x Detail)
*Goal: Distinct engine pods, armor plating panels, PD turret barbettes, and sensor arrays.*
- **Terran Aegis Corvette:**
  - Segmented prow glacis plate and lateral sponson armor seams.
  - Recessed dorsal PD deck housing with circular mount rings under the two flak turrets.
  - Elevated aft sensor mast / radar crossbar and armored cockpit slit.
  - Dual heavy engine nacelles at the stern with inner core glow (`#bae6fd` inside `#0284c7` cowlings) and thruster trails.
- **Alien Sentinel Manta:**
  -Segmented carapace plates following the stingray wings with glowing crimson energy conduits connecting the central core to the dual PD mounts.
  - Tri-lobed bio-reactor core in the center with an outer containment ring.
  - Split crescent tail vents with orange-red ion glow.

---

### Pass 3: Cruisers (`cruiser`, `size = 34`) — Medium Warship Detailing (2.5x–3x Detail)
*Goal: Multi-tier deck plating, visible torpedo tube bays, reactor cores, and auxiliary thrusters.*
- **Terran Vanguard Cruiser:**
  - **Prow Torpedo Bay:** armored twin launch doors, recessed spinal loading trench, and hazard chevron accents (`#f59e0b` / `#0284c7`).
  - **Midship Superstructure:** stepped armored deck terrace, dorsal beam turret citadel ring, and lateral structural ribs.
  - **Command Bridge:** multi-tier aft command tower with illuminated bridge viewport strip.
  - **Propulsion Block:** main central drive nozzle flanked by two secondary maneuvering thrusters + radiator fins.
- **Alien Warship (Mandible Cruiser):**
  - **Mandible Torpedo Prow:** glowing plasma convergence rails between the twin forward mandibles.
  - **Bio-Mechanical Spine:** 4 pairs of curved skeletal rib segments along the hull flanks and a bright armored dorsal nexus around the main beam turret.
  - **Aft Propulsion:** 3 curved plasma exhaust vents along the rear crescent.

---

### Pass 4: Battleships (`battleship`, `size = 46`) — Capital Dreadnought Detailing (3x Detail)
*Goal: Imposing flagship presence with spinal accelerator coils, broadside casemates, multi-tier citadel, and quad engine banks.*
- **Terran Leviathan Battleship:**
  - **Spinal Railgun Accelerator Trench:** open longitudinal barrel trench from midship to prow lined with 4 pairs of glowing electromagnetic capacitor coils (`#38bdf8` / `#facc15`).
  - **Port & Starboard Broadside Casemates:** reinforced octagonal armor blisters, blast shields, and power conduits feeding the lateral laser batteries.
  - **Multi-Tier Command Citadel:** stepped fortress superstructure with armored bridge windows, communication antennae, and reactor heat vents.
  - **Quadruple Main Thruster Bank:** 4 heavy industrial engine nozzles at the stern (`-s * 1.2`) with layered cyan/white plasma cores + lateral RCS thruster ports.
- **Alien Basestar Dreadnought:**
  - **Spinal Singularity Canal:** central energy trough with sequential crimson/amber accelerator arcs leading to the heavy prow mount.
  - **Lateral Bio-Casemates:** organic armored nodes on port and starboard wings connected by branching vein networks to the central core.
  - **Central Command Eye & Concentric Rings:** multi-layered pulsing core with segmented orbital rings, rib lattice across the wide wings, and 4 rear ion-plasma thrusters.

---

## Part 2: Approved Future Ship Roster Expansion (8 New Hulls / Subclasses)

1. **Broadside Missile Frigate (`missile_frigate`)**
   - *Role:* Mid-range saturation support.
   - *Mechanics:* Launches salvos of light homing missiles from port and starboard lateral VLS cells (`baseArc` on both sides), overwhelming enemy PD screens through sheer missile count.

2. **Twin-Broadside Dreadnought (`broadside_dreadnought`)**
   - *Role:* Heavy line-breaker brawler.
   - *Mechanics:* Lacks a nose spinal mount, but carries **2 heavy main-caliber turrets on the Port side and 2 on the Starboard side**. AI seeks to drive a wedge between enemy formations to fire devastating double broadsides on both flanks simultaneously.

3. **Plasma Volley Flanker (`plasma_corvette`)**
   - *Role:* Close-range anti-capital flanker.
   - *Mechanics:* Fast armored corvette that fires a wide fan/salvo of **3, 5, or 8 plasma bolts** in a single burst (`spread angle`), punishing large slow hulls when flanking their broadside or stern.

4. **Aegis Shield Tender / Support Frigate (`shield_tender`)**
   - *Role:* Defensive fleet sustainer ("Warden / Healer").
   - *Mechanics:* Stays behind friendly capitals and projects a shield-restoration beam or protective field that boosts ally shield regeneration / deflects incoming damage. High-value priority target for enemy strike craft.

5. **Siege Rail-Monitor (`siege_monitor`)**
   - *Role:* Extreme-range artillery sniper ("Glass Cannon").
   - *Mechanics:* Minimal shields/armor and very slow turn rate, but massive range (`1800u+`) with high-velocity piercing slugs that bleed a percentage of damage directly through shields into armor.

6. **Light Drone Carrier (`drone_carrier`)**
   - *Role:* Backline attrition carrier.
   - *Mechanics:* Holds maximum stand-off distance and periodically spawns/replenishes a fresh flight of 3 light attack drones every 12–15 seconds as long as the carrier survives.

7. **Heavy Torpedo Bomber (`torpedo_bomber` — Strike Craft subclass)**
   - *Role:* Anti-capital heavy strike craft.
   - *Mechanics:* Slower than interceptors, ignores enemy fighters, and targets exclusively **large capital ships** (`battleship`, `dreadnought`) with compact armor-piercing micro-torpedoes.

8. **Missile Strike Craft (`missile_fighter` — Strike Craft subclass)**
   - *Role:* Anti-medium / anti-escort strike craft.
   - *Mechanics:* Agile strike craft armed with light guided agile missiles that prioritize **medium and small ships** (`cruiser`, `corvette`, enemy strike craft).

