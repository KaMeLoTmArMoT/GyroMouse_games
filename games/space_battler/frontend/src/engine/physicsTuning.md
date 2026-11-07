# Wave 11A physics tuning and distance audit

## Flak screening provenance

The old 600u filter was duplicated in cached target safety, uncached target safety,
hostile-flak detection, and swarm courage. It had no relationship to equipped guns.
`CORVETTE_FLAK_THREAT_RADIUS` now derives the nominal profile metric, while
`flakThreatRadius(ship)` evaluates live mounts and hull size:

`max(flak range + mount offset length + barrel length + blast radius + 6 × hull radius)`

The current corvette gives approximately **581.66u** (420 + √32 + 6 + 30 + 120).
The final six hull radii are an explicit tactical maneuver margin, rather than a
fixed world-space distance. The denial band uses three radii instead (~521.66u).
Weapon refits, blast changes, and scaled hulls therefore change both bands. Missing
flak gives zero threat radius. Cached and uncached screening use the same live metric;
the fighter obstacle prefilter expands to cover it rather than truncating at 800u.

## Boundary model

- Anticipation width is 25% of the configured arena radius.
- Outside the edge, intensity is `1 + (excess / (arena radius × 0.15))²`.
- Shields lose 10% of maximum per second times intensity; collapsed shields expose
  hull to 30 DPS times intensity. Armor cannot absorb radiation. Mid-step shield
  collapse only exposes hull for the unshielded portion of the step.
- Normal shield regeneration is suppressed while exposed; recharge delay restarts.
  The fixed-step hazard pass follows support transfers and movement/contact resolution.
- Return navigation compares direct and ±30°/±60° routes using projected radiation,
  turning time, capital collider clearance, live weapon ranges/arcs and DPS. Extra
  radiation can be accepted when it costs less hull than the hostile corridor.
- Return intent runs through normal turning and acceleration; obstacle/wreck routing
  follows it. There is no extra inward acceleration or velocity/position rebound.
  `ARENA_HARD_PULL_RADIUS` and configureArena's second argument remain legacy
  telemetry/benchmark markers only, with no physical effect.

## Wreck model

Fragment mass is parent hull-class mass × `(fragment radius / profile radius)²`,
matching the simulation's 2D collider area. Impact damage is
`0.5 × fragment mass × relative speed^1.5`, measured before contact removes closing
momentum. Shield, armor, then hull absorb overflow. The wreck loses the same impact
energy from its existing hull durability and disintegrates at zero. Contact latching
prevents repeated damage from the same sustained contact; separated re-impacts count.
Neutral wreck/environment damage does not credit an opposing team's weapon DPS.

## Remaining audited distances

These are distinct pre-existing tactical/layout parameters, not flak reach. Changing
their balance is outside these physics tasks:

| Location | Values | Meaning / future scale dependency |
| --- | --- | --- |
| navigationContext / shipNavigationSystem | 400u | Fighter support/isolation neighborhood; cached and fallback checks agree. |
| flightControl / shipNavigationSystem | 600u, 900u | Pursuit theaters and escort tethers; should be tuned as doctrine horizons, not silently equated to flak reach. |
| fighterMissionSystem | 520u, 800u | Rally station and general obstacle neighborhood; flak candidates now expand beyond that neighborhood when needed. |
| shieldGeometry / collisionContactSolver | 300u, 420u, 210u | Capital separation and its broadphase half-envelope; must be revised together if separation changes. |
| flightControl / shieldGeometry | 15u, 30u, 90u | Wreck corridors, shield margins, escort/exhaust clearance; already added to actual hull/envelope sizes, but fixed additive margins remain. |
| simulation | 75 HP, 16–18s | Fragment durability/lifetime, gameplay tuning rather than a spatial filter. |

Future tuning analysis should identify a distance's owner (weapon reach, physical
clearance, temporal maneuver horizon, or layout), inspect every cached/fallback and
broadphase consumer, and test changed range/size before altering its numeric value.
