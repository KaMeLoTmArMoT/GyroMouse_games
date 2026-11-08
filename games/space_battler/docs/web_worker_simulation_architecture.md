# Web Worker simulation architecture and scaling roadmap

Updated 2026-11-08. Phases 1–3 have implemented protocol, host and presentation
components: `simulationWorkerProtocol.ts`, `simulation.worker.ts`,
`simulationWorkerHost.ts`, `simulationWorkerClient.ts`, `snapshotInterpolation.ts`,
`simulationPresenter.ts` and `workerPresentationEvents.ts`. The host uses a
three-buffer transferable pool and the presentation pipeline recycles buffers.
The App now wires the Worker client into the tactical presentation; that parallel
integration still requires its verification. Each buffer holds **2048 ships,
4096 projectiles, 16384 mounts and 1024 events**. Capacity is a transport limit,
not a combat balance setting.

The sections below preserve the Wave 15B.10 investigation at revision `03cfcf9`
(engine optimizations through `f7c0f32`). Its measurements, proposals and
acceptance gates are historical/design context, not a claim that every proposed
feature or browser-performance gate has been delivered.

## 1. Decision and feasibility

**Move the entire authoritative combat simulation into one dedicated module
Worker. Keep Canvas 2D, visual effects, audio and React on the main thread.
Start with pooled transferable render snapshots and interpolation; add
SharedArrayBuffer only if browser transport measurements justify it.**

Offloading removes the simulation's long main-thread tasks. It does not make a
110–130 ms calculation fit into a 16.67 ms budget. Smooth 60/120 FPS rendering
and real-time 60 Hz simulation are separate acceptance criteria:

| Evidence / assumption | Tick cost | Maximum ticks/wall-second, excluding transport | Achievable simulation speed at 1/60 s per tick |
| --- | ---: | ---: | ---: |
| User-observed 170v170 | 70–84 ms | 11.9–14.3 | 0.198–0.238x |
| User-observed 200v200 | 110–130 ms | 7.7–9.1 | 0.128–0.152x |
| This investigation, first 200v200 run | 150.91 ms mean | 6.63 | 0.110x |
| This investigation, repeat | 190.87 ms mean | 5.24 | 0.087x |

The observed 400-ship budget needs approximately 6.6–7.8x less work to achieve
real-time 60 Hz, before packaging; this experiment needs 9.1–11.5x. A Worker
therefore makes large battles **responsive slow simulation**, not automatically
real-time battles. Main-thread rendering must independently fit within 16.67 ms
at 60 FPS or 8.33 ms at 120 FPS. Neither rate has been browser-verified here.

Retain the calibrated 1/60-second integration step, weapon profiles, navigation
cadences, speeds, shield/hull geometry and arena. Decouple wall-clock tick
delivery and snapshot publication from integration frequency. A proposed
10 Hz publisher can still publish results of unchanged 60 Hz integration when
CPU permits; changing integration to `dt = 0.1` would change combat and is not
part of this design. Lower publication frequency cannot resolve compute debt.

## 2. Current ownership and migration seams

The requested `simulation.step()` corresponds to
`ClientCombatSimulation.update(dt)` in `frontend/src/engine/simulation.ts`.
It accumulates time and calls private `tick(1 / 60)`, with up to 240 catch-up
ticks per call while retaining the remaining accumulator. At 110 ms/tick, that
upper bound permits roughly 26 seconds of uninterrupted work.

The original synchronous path advanced `sim.update(dt * speed)` inside
`requestAnimationFrame` and rendered the same mutable objects. The implemented
presenter also accepts a Worker client, now wired by the App.
Render delta is capped at 0.033 seconds and focus loss/hidden documents suspend
advancement. The original App directly owned telemetry, stepping and battle reset;
those ownership seams are addressed by the live wiring work.

Moving just the method invocation is insufficient:

| Current dependency | Required Worker boundary |
| --- | --- |
| `sim.ships`, projectiles, obstacles, active beams | Read-only presentation snapshots on main; authoritative objects in Worker |
| `setGroupOrder`, `orders` and crew settings | Explicit commands; no main-thread mutation of combat objects |
| Fighter mission visuals | Export `getFighterWingVisuals()` results, not the mission-system class |
| Haven slots and UI `shieldHaven.getLease()` | Export lease/reservation DTOs; renderer reads a lease lookup |
| `carrierFabricationProgress()` | Compute in Worker and publish progress; its module-local WeakMap is absent in main-thread clones |
| `observer instanceof FleetBreakdown`, clipboard export | Observer stays in Worker; request formatted breakdown with request ID and authoritative tick |
| Beam/impact/fire/destruction/victory callbacks | Worker-local callback adapters produce serializable events |
| Effects `impactDecals` keyed by `ShipState` object | Stable presentation objects keyed by entity ID/generation, or ID-keyed decals |

Keep constructor, `addShip`, `setGroupOrder`, `update` and callbacks synchronous
for existing engine tests and headless tools. Add a transport/controller around
the engine, not asynchronous behavior to the engine API. The following diagram
illustrates the intended boundary; see the status above for implemented files:

```text
App / input / menus                 Dedicated simulation Worker
  BattleController  -- commands -->  Worker host / tick-boundary command queue
  presentation store <-- snapshots -- ClientCombatSimulation + FleetBreakdown
  frame event inbox  <-- event batches -- callbacks / telemetry adapters
       |
       +-- rAF: acquire snapshots, interpolate, drain eligible effects, draw
       +-- 10 Hz: publish coherent telemetry to React
       +-- main-thread Web Audio and clipboard
```

Use Vite's statically analyzable construction, from the controller module:

```ts
new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" });
```

Build the fleet in the Worker from fleet slots, map and crew settings, using the
same builder and ordering as today. The engine's transitive imports must remain
DOM/audio-free; browser audio and canvas modules are not Worker dependencies.
The initial snapshot must include ingress information queued during `addShip`.
Worker creation, start readiness and errors are explicit controller states.

## 3. Scheduling without an infinite catch-up queue

The Worker owns both the authoritative tick counter and playback clock. Main
`rAF` sends no per-frame `advance(dt)` messages. A Worker task performs one fixed
tick, packages completed output if due, then yields to its event loop. Use a
timer/task scheduler, not a recursively chained microtask or unbounded loop:
message handlers must get opportunities to process pause and orders.

Initially the host can call `update(1 / 60)` once per task on a fresh engine with
no other delta input. A later explicit one-fixed-tick seam may expose the same
private tick body for a host, preserving `update(dt)` and its accumulator tests.
Never feed elapsed wall time into the existing 240-tick catch-up loop in the
Worker. Once ticks are cheaper, small bounded multi-tick tasks can be considered
only with between-tick command checks and measured responsiveness.

Clock rules:

- **Under capacity:** schedule against absolute wall-clock deadlines at requested
  speed, avoiding cumulative `setTimeout` drift. Each tick still advances 1/60 s.
- **Over capacity:** finish ticks sequentially, yield and immediately schedule the
  next when due. Bound scheduler debt (for example, one pending tick); rebase the
  pacing deadline instead of accumulating an ever-growing wall-time backlog.
  This discards a wall-clock real-time target, not an already-computed combat
  tick. Publish requested and achieved speed separately.
- **Pause, builder tab, blur or hidden document:** main sends a suspension state
  command. Preserve explicit user pause separately from automatic suspension,
  apply at a tick boundary, and reset wall deadlines on resume. Do not catch up
  hidden time. Keep current winner semantics: only the existing stalemate state
  stops engine advancement; do not silently stop decisive-victory remnants.
- **Manual step:** serialize the current two-tick action; acknowledge only when
  both complete (or the engine's terminal condition prevents further ticks).
- **Time scale:** changes desired wall-clock pacing, never the integration `dt`.
  At overload even 5x is a request, not a promise of attained speed.

Pause is not preemptive: an in-progress 130 ms tick can delay the acknowledgement
by that tick's duration plus scheduling/packaging. The UI can show pending pause
immediately and remain interactive. Sub-tick interruption or parallel phases
requires a separate engine redesign and is not solved by posting more messages.

## 4. Snapshot transport and memory

### Comparison

| Mechanism | Data movement and cost | Ownership / constraints | Decision |
| --- | --- | --- | --- |
| Structured clone of whole states | Traverses nested ships, turrets, weapons, vectors and projectiles; allocates receiver objects and creates GC pressure | Simple, but functions/WeakMaps cannot be cloned and class behavior is not restored | Correctness prototype or diagnostic export only |
| Transferable `ArrayBuffer` + typed views | Packing is O(entities + mounts); transferring backing bytes is zero-copy; envelope still uses clone/message scheduling | Sender buffer becomes detached; require a pool and explicit recycle | Production starting point; works without cross-origin isolation |
| `SharedArrayBuffer` + typed views | Same packing work, but both threads access the shared backing bytes | Atomic slot ownership/publication; secure context and cross-origin isolation | Optional measured optimization after transferable path |
| Snapshot interpolation | O(visible/interpolated entities) presentation work; independent of the transport choice | Requires two coherent snapshots and a delayed presentation clock | Required with every production transport |

The task's **5–10 ms serialization latency for 400 ships + 300 projectiles is a
planning estimate**, not a measured browser result. Our local `structuredClone`
calls took around 4 ms for full snapshots (§7). Browser `postMessage` adds
sender serialization, delivery scheduling, receiver deserialization and GC;
measure these stages and frame impact separately. Do not add two local clone
times and claim a measured browser round trip.

### Render-only schema

Keep double-precision JS object state in the simulation; pack an independent
presentation schema. `Float32Array` is reasonable for display coordinates/angles
after visual validation; use `Float64` where precision is needed. No quantized
value feeds back into combat. Commands and parity checks use original numbers.

- Header: schema version, battle/round epoch, snapshot sequence, tick,
  simulation time, counts, metadata revision, last applied command sequence,
  event watermark and per-tick performance summary.
- Ships: numeric handle and generation; position/velocity/heading; shield,
  armor and hull status; alive/docked/debris flags; haven amplification,
  parent/slot, navigation/mission target and phase; mount span.
- Mounts: local aim angle, cooldown, firing time and target handle/kind.
- Projectiles: handle/generation, position/velocity, lifetime, HP and target;
  owner/team/type and weapon-profile handle as necessary for guidance and UI.
- Supplemental DTOs: moving map obstacles, beam endpoints, wing membership and
  phase, leases, carrier fabrication progress and team summaries/rolling DPS.
- Metadata, sent once or on change: string IDs/names, hull/team/group, sizes,
  maxima, hardpoints, exact arcs and immutable per-instance loadout descriptions.
  Preserve projectile shot-time weapon variants; a canonical weapon-name lookup
  is insufficient for a refitted weapon.

An illustrative **incomplete** packing budget is 400 × 96 bytes of ship rows +
300 × 48 bytes of projectile rows + 900 × 24 bytes of mount rows = 74,400 bytes
(72.7 KiB), or 223,200 bytes for three slots. These are design allowances, not
actual strides or a measured fleet mount count. Auxiliary DTOs, metadata and
full selected-entity telemetry must be budgeted after the consumer audit.
At 60 publications/s that illustrative payload is 4.46 MB/s; full object
snapshots here are about 0.9–1.0 MB of JSON text per publication. JSON byte size
is only a scale proxy, not structured-clone wire size or heap allocation size.

Do not hard-cap storage at 400 ships/300 projectiles: the experiment reached
389 projectiles; fabrication, wrecks and retained dead ships increase records.
Grow presentation capacity through an acknowledged new-buffer/metadata revision,
retain the last complete snapshot until ready, and never truncate combat state.
Reuse numeric handles only with generation checks; reset/continuation IDs and
projectile IDs must not connect unrelated interpolation endpoints.

### Transferable pool protocol

Use at least three snapshot buffers: previous and current remain on main for
interpolation while another is Worker-owned for packing. Send the buffer as part
of the message payload and in the transfer list. Recycle the oldest only after
the frame and any telemetry decoding have stopped using its views; all sender
views are detached after transfer. React must not retain views into recycled
buffers. Maintain stable main-thread display objects or immutable telemetry DTOs.

When there is no free buffer, continue simulation and skip/coalesce **snapshot
publication**, not simulation ticks or essential events. A receiver processes
metadata/events even when superseding a visual snapshot. Its message handler
stores pending output and schedules no React render per message. At frame start
promote coherent latest output, recycle superseded buffers, and retain a bounded
previous/current pair. Audit stale-epoch messages before using their contents.

### Shared memory protocol and deployment

Only enable SAB when `isSecureContext`, `crossOriginIsolated` and constructor
availability agree in both page and Worker. A typical deployment requires:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Serve these on the standalone app and production deployment, not just Vite dev.
Cross-origin resources need compatible CORS/CORP behavior. The repository's LAN
HTTP dev use is especially relevant: a private IP over HTTP is not generally a
secure context, unlike localhost; transferable transport remains necessary.
Do not change shared hub headers without checking its other pages/assets.

Use an `Int32Array` control header with atomic slot states
`FREE -> WRITING -> READY -> READING -> FREE` and slot sequences. Worker claims
a free slot with `Atomics.compareExchange`, writes all non-atomic payload fields,
then publishes READY with an atomic store. Main atomically claims a ready slot
before reading, and pins both interpolation endpoints until no longer needed.
The writer must never overwrite a READING slot. Keep state/sequence transitions
and superseding an unclaimed READY slot in one specified ownership protocol.
When all slots are pinned, skip publication; do not block the main thread.

This avoids torn snapshots including Float64 fields by preventing concurrent
payload access. Reading a published index alone, or naive double buffering that
the writer wraps around while a frame reads, is insufficient. `Atomics.wait`
must never be used on the browser main thread; timers/messages are enough for
the first Worker scheduler. SAB shares memory, not ShipState class instances,
WeakMap contents, or a magically zero-cost packing operation. Keep commands and
initial event batches as messages; a shared event ring is unnecessary initially.

## 5. Interpolation and presentation timing

Snapshots carry authoritative simulation times `t0`, `t1` and sequence numbers.
Maintain a delayed presentation time bracketed by the retained snapshots:

```text
alpha = clamp((presentationTime - t0) / (t1 - t0), 0, 1)
position = previous.position + alpha * (current.position - previous.position)
heading = previous.heading + alpha * shortestAngle(current.heading - previous.heading)
```

Interpolate position, heading, turret aiming and suitable beam endpoints.
Health, leases, docking, spawn, death and victory are discrete transitions,
applied at their presentation timestamp; never average `isAlive` or assignments.
No interpolation across reset/continuation epochs, handle generations, warp
teleports or dock/undock discontinuities. New entities have no fabricated prior
path. Camera following, culling and hit-testing use the displayed pose, returning
only the authoritative ID to the UI. Inspector telemetry is latest authoritative
state, with its tick clearly distinguished from the delayed pose.

At real-time 60 Hz, approximately one publication interval of delay supplies a
previous/current bracket (16.67 ms if published every tick). At overload, two
adjacent ticks still differ by 1/60 simulated second but may arrive 130 ms apart.
Do not advance the presentation clock at requested 1x in that situation: it
would exhaust the bracket in one frame and then freeze. Estimate achieved
simulation-time/wall-time rate from completed snapshots, interpolate with an
arrival-cadence delay, and use simulation stamps for correctness. At 130 ms
arrival spacing this means roughly 130 ms display delay and visibly slow motion,
even though the canvas can draw 60/120 frames per second.

Bound delay and interpolation history. On jitter/underrun hold the newest
completed state rather than extrapolating missiles through targets or inventing
collisions. After a long gap resynchronize to completed output. Deterministic
combat cannot promise perfectly smooth object motion under arbitrary stalls.
Pause acknowledgement flushes to the final completed pose and stops the combat
presentation clock; cosmetic UI animation may continue. Reset clears both
snapshots, old effects, selections as appropriate and interpolation clocks.

`VisualEffectsManager.update()` currently uses scaled render `dt`. In the new
path, combat-linked lifetimes/trails advance by actual presentation-time delta,
not `wallDt * requestedSpeed` when overloaded. Keep intended cosmetic clocks
(such as ingress gates) distinct. Event positions come from the event instant;
ongoing shield impacts and beams can follow displayed entity handles.

## 6. Deterministic commands and events

### Commands: UI to Worker

Small discriminated messages carry `protocolVersion`, `epoch`, monotonic
`commandSeq`, command kind and payload. Proposed kinds cover initialization,
full `GroupOrder` updates, supported doctrine/settings changes, playback speed,
explicit pause, automatic suspension, manual two-tick step, reset, remnant
continuation and requested telemetry/breakdown exports. Selection, camera, audio
mute and menu navigation remain local presentation state.

The host applies mutating commands **between complete ticks**, in sequence
order. The acknowledgement includes `commandSeq`, `appliedBeforeTick` (or the
completed tick for a paused/read command), epoch and any result. Commands received
while paused still apply and publish/acknowledge without requiring combat to
resume. Reject stale epochs and invalid protocol versions; show pending orders
until acknowledged rather than presenting guessed state as authoritative.

`GroupOrder` currently contains only `groupId`, priority and stance; `orders` is
a `Map<number, GroupOrder>` shared by numeric group ID across both teams. Preserve
that behavior in this migration. Adding a team-scoped order key would be a
separate functional change. Crew veterancy is currently assigned during battle
assembly; preserve its lifecycle rather than inventing midbattle profile edits.

Delivery time is not deterministic across runs. For reproducible replay record
the **acknowledged applied tick and sequence**, then replay those commands at
the same boundaries. An optional target-tick request must have a defined late
arrival policy (reject or apply-next and record actual tick); wall timestamps or
the main thread's stale snapshot tick cannot guarantee identical live timing.

Use epoch barriers for reset and continuation: acknowledge the new epoch with
its initial snapshot/metadata, discard old pending output and events, and never
blend across rounds even when survivor IDs are unchanged. A stable Worker can
reset its engine/observer or continue its own instance; do not transfer a live
engine between threads. Dispose/terminate on controller teardown, handling
React StrictMode effect setup/cleanup without double-started loops. On Worker
error keep UI responsive and offer reconstruction from initialization + recorded
commands; render snapshots are not sufficient recovery checkpoints.

### Events: Worker to UI

Attach adapters to existing callbacks; copy scalar/vector values **at emission**
instead of keeping mutable ShipState references. Each event carries epoch,
strictly increasing event sequence, tick, simulation time, type and minimal
payload. Needed payloads include:

- Beam/fire and flak: exact endpoints/position, width/radius, team, weapon type,
  handle, channel identity and duration semantics.
- Impact/damage: ship handle, impact origin/angle/position, event-time shield
  envelope and armor/hull layer flags; actual damage amount for any damage-number
  consumer comes from the existing observer/damage path, not guessed HP deltas.
- Destruction: event-time position, heading, size, hull/team and velocity so an
  explosion can be made even when the ship is absent from the latest snapshot.
- Projectile retirement: final pose, identity, type and expiry/intercept/impact
  reason. Current effects infer expiry by comparing projectile arrays; with
  skipped snapshots a projectile can spawn and disappear unseen, so that
  inference must become an explicit retirement event.
- Combat audio, ingress and victory: existing cue semantics, time/team/position
  and winner. Avoid replaying the same audio from both a callback event and the
  existing `audioEvents` queue.

Buffer events during a tick and publish a sequenced batch on completion; do not
post one message per hit. Main message handlers enqueue batches only. Once per
`rAF`, drain eligible events in sequence at the presentation timestamp, then
update effects and audio. Keep future events until their displayed transition;
never render delayed alive ships with prematurely triggered destruction effects.
Paused manual steps also deliver events, unlike reliance on running frames.

Snapshots are latest-wins; essential events are not. Use watermarks/acknowledged
event sequences independent of snapshot recycling, preventing omission or double
playback if a visual snapshot is skipped. Browser messages are ordered on one
channel, but epoch changes, multiple output types and frame deferral still need
explicit sequence handling. On metadata dependencies, defer an event until its
revision is available or make its visual payload self-contained.

Define separate retention policies: losses/victory/order acknowledgements and
accounting remain reliable; aggregate/throttle cosmetic damage numbers, sparks
and repetitive sounds with measured bounded budgets. Publish a cumulative
critical ledger/summary to reconcile after suspension. If a bounded essential
inbox cannot be drained, pause production before the next tick and report
backpressure rather than silently dropping essential transitions; allow for a
whole tick's burst. Do not reuse the current 256-entry audio queue as a reliable
all-combat-event log. Observers continue synchronous accounting in the Worker;
render/audio coalescing never changes damage, targeting or victory.

### Determinism boundaries already present

Engine state uses identity-sensitive caches: beam channels key on mounts;
navigation/fire-control contexts key on arrays; steering, carrier fabrication,
launch corridors and contact IDs use WeakMaps. Keep those objects in one Worker
for their entire lifecycle. Cloning ships each tick back into a simulation loses
state and changes combat. A render snapshot is not a savegame; future checkpoint
support must explicitly serialize every hidden state/cadence/channel/counter.

Navigation allocations use stable ID sorting and candidate order affects ties.
Retain phase order: mission/support preparation, simultaneous movement decisions,
contacts, common firing decisions, all shots, projectile resolution, harmonic
support/radiation, cleanup and winner/observer update. A multi-Worker per-ship
split would need barriers and deterministic reductions over shared assignments,
locks and contact mutation; it is not the initial offload plan.

Combat-log IDs use `Math.random()` in `addCombatLog`. Thus byte-for-byte full
public-state determinism, including those IDs, is not currently guaranteed.
For migration parity compare authoritative combat state and normalize only log
IDs; compare log contents/times separately. If exact event/log replay IDs are
required, introduce deterministic sequence-based IDs as a focused follow-up with
tests. Audio/effects randomness stays outside combat. Identical command replay
in the same runtime is the target; cross-browser bitwise floating-point parity
is a stronger, unproven guarantee.

## 7. Headless 200v200 experiment and bottlenecks

### Measured feasibility on current code

An external temporary `tsx` harness imported the current engine without source
instrumentation or production edits. Environment: Node `v24.16.0`, Windows,
AMD Ryzen 7 7700 (8 cores). `FleetBreakdown` was attached as in the UI. Separate
30-tick warm-up; two fresh 300-tick runs with `update(1 / 60)` (five simulated
seconds each). No canvas, Worker or browser was involved.

Per-team composition: 4 carriers, 6 dreadnoughts, 10 battleships, 28 cruisers,
38 missile frigates, 4 tenders, 52 corvettes and 58 strike craft = **200**.
No carrier auxiliary slots were added. This is a mixed stock-envelope stress
fixture, not a claim that every arbitrary 200-slot fleet fits or costs the same.

Placement reproduced the bounded greedy geometry procedure from
`bench/wave15bProfile.ts`, with the composition above: make one stock builder
template per hull/team, clone it, assign stable `${side}_${hull}_${index}` IDs
(side is `blue` or `red`),
instantiate turrets with index `i`, and set `groupId = 1 + floor(i / 8)`.
For each team in `[0, 1]` and hull in the listed order, scan positive x from
460 for capitals or 160 for other hulls through 1710 in increments of 50.
Scan rows 0–66 at alternating y = `ceil(row / 2) * 50 * (row % 2 ? 1 : -1)`;
require `hypot(x,y) + shieldEnvelopeRadius + 25 <= ARENA_RADIUS` and distance
greater than both envelopes + 20 from already placed peers. Mirror x by team.
Assign corvettes round-robin to that team's capitals. Before running, assert
all 400 ship/profile values, arena margins and **all cross-team and same-team
pairs**. Only placement/identity/formation affiliation changed, never balance.

| Run | Mean | p50 | p95 | Maximum | Minimum active combat ships | Peak projectiles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| First | 150.91 ms | 150.16 ms | 167.32 ms | 223.87 ms | 381 | 389 |
| Repeat | 190.87 ms | 163.64 ms | 284.55 ms | 486.61 ms | 381 | 389 |

First-run window means: ticks 1–60 **152.04 ms**, 61–120 **158.26 ms**,
121–300 **148.08 ms**. Repeat: **171.05**, **230.11**, **184.39 ms**.
All output poses, velocities, headings and health values were finite; elapsed
simulation time matched five seconds within `1e-8`. Both runs had zero active
wrecks and the same SHA-256 over JSON `{ships, projectiles, stats, beams,
time, winner}`:

```text
5de28e5d3faf5896b89e0a3cb5131898d7af8d348a9fa5de9c6f9de80d512d94
```

The hash excludes random combat-log IDs and hidden state. Equal completed-run
outcomes over five seconds demonstrate repeatability of this fixture, not a
complete hidden-state serialization proof. The repeat's higher timings are an
observed variance; no CPU-load, GC or thermal trace was collected to attribute
it. Report both runs rather than selecting the favorable one. Concurrent system
load, runtime/JIT and observer differences prevent direct comparison with the
user's 110–130 ms browser observations.

Outside timed updates, the first run cloned `{ships, projectiles, beams}`
40 times at each selected tick:

| Tick | Ship records | Projectiles | JSON UTF-8 bytes (proxy only) | Clone mean | Clone p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 30 | 400 | 268 | 983,013 | 4.27 ms | 4.58 ms |
| 120 | 400 | 151 | 933,902 | 3.95 ms | 4.17 ms |
| 300 | 400 | 77 | 898,689 | 4.06 ms | 4.45 ms |

Clone blocks were outside step timing but can affect later allocation/JIT/GC
behavior; they were omitted from the repeat. These samples are not an exact
400+300-projectile transport benchmark. Their nested states make the 5–10 ms
browser overhead estimate plausible to investigate, not established fact.

**Conclusion:** current stock 400-ship headless integration is executable and
repeatable for this opening window, but substantially slower than real time.
The five-second window does not exercise the 20-second carrier fabrication
boundary, capital-wreck accumulation, every map, or a full 300-second battle.
Those require targeted later checkpoints, not a claim of full-battle coverage.

### Optimizations through Waves 15B.1–15B.9

The source/history verifies these improvements, while their exact per-wave
timing deltas are not preserved as current measured results:

| Commit | Optimization family | Remaining scaling issue |
| --- | --- | --- |
| `8a41e00` | Tender aura indexing, pruning missile interception checks | Support and missile candidate work still depends on fleet/composition |
| `02dac4a` | Spatially prune radiation return-route evaluation | Boundary-heavy scenes still sample routes/threats |
| `3acf4d6` | Navigation candidate selection, prune ally scans | Global assignment/target searches remain |
| `3aafe1d` | Batch haven requests and release recounts in cleanup | Lease eligibility, attachments and occupancy still cost work |
| `2b93d98` | Early mount-arc gating, scalar solution tracking | Per-mount ship/projectile scans persist |
| `176f810` | Scalar swept-AABB projectile rejection, scalar separation | Rejection reduces narrowphase cost, not all candidate enumeration |
| `37108eb` | Capital-intent fleet scans, scalar defensive standoff | Capital navigation still queries fleet threats/support |
| `9cbcfaf` | Scalar ordnance avoidance, escort screening, context density | Dense neighborhoods still dominate repeated local queries |
| `f7c0f32` | Navigation standoff scans, fighter haven occupancy | Remaining steering/scoring plus coordinator allocations |

`bench/wave15b.summary.json` is historical: it reports a 340-ship baseline mean
of 436.10 ms and expensive route-cost/fire-control/navigation phases before
subsequent changes. It must not be cited as today's subsystem breakdown.
Its census identifies relevant candidate loops, not current post-15B.9 costs.
`docs/profiling_and_optimization.md` also describes context *indexing* as O(N);
the current complete `NavigationContext` construction has per-ship density,
capital-anchor and flak-peer loops, so its worst-case construction is not O(N).

Current source supports this bottleneck shortlist, **not a measured ranking**:

1. **Navigation/context/steering:** per-ship target scoring and density/anchor/
   support queries; local-density preparation still scans active ships.
2. **Fire control:** M mounts × ship/projectile candidates, aim solutions,
   defended-ship logic and missile reservations. Arc checks prune expensive
   work but do not eliminate every candidate visit.
3. **Contacts:** two pair passes plus iterative cruiser clearance. At N=400,
   each all-pairs pass visits up to 79,800 pairs (159,600 for both); at 340 it
   is 57,630 per pass. That is **1.385x** pair growth for 1.176x entity growth.
4. **Projectiles/flak:** O(PN) ship sweep candidates and projectile/missile splash
   queries. At P=300, N=400 the ship sweep candidate scale is 120,000/tick
   before early rejection; P and salvo bursts are not constant in combat.
5. **Boundary/support/composition:** route samples, haven guests, fighter missions,
   tenders and later fabrication/wreck growth can shift the dominant phase.
6. **Allocation:** arrays/filters, previous-position maps, movement maps, target
   maps, sorted navigation lists, shot closures and snapshot packing. A Worker
   relocates their GC impact but does not eliminate allocation or CPU contention.

Next engine optimization should follow same-fixture, current-revision plain
timing + CPU sampling/candidate census. Reuse `wave15bProfile.ts`'s diagnostic
methodology, but its present fixture hardcodes 340 and its non-baseline modes
expect an external baseline file; deliberately update/parameterize the fixture
in a follow-up rather than run it and label its output 400 ships. Native sampling
and in-memory source instrumentation can have different runtime costs; compare
plain runs and do not sum overlapping inclusive subsystem timings.

Conservative, pooled spatial indices are a candidate to benchmark against the
current scalar rejection paths for local support/separation, contacts and swept
projectiles. This does not endorse rebuilding allocation-heavy dynamic buckets:
compare total rebuild/query cost and GC before adopting an index. Preserve original candidate
and pair order, conservative swept/envelope bounds, live eligibility and contact
semantics. Contact correction can move a ship during a pass: a broadphase built
only on pre-pass poses can miss newly reachable contacts, so bounds/re-querying
need proof and parity tests. Distant navigation assignments/global scoring
cannot be pruned simply because a target is outside a local grid cell.
No promised speedup or combat retuning follows from this shortlist.

## 8. Historical phased implementation roadmap and gates

Phases 1–3 components, App wiring and expanded capacities exist; browser acceptance
and the concurrent integration's remaining verification are outstanding.
The following original task lists and gates are retained as design and acceptance
history, not as an assertion that all listed details have been implemented.

### Phase 0 — Record a reproducible baseline

- Add a bounded stock-parameter 400-ship fixture to headless diagnostics, plus
  340 and smaller controls; retain exact placement assertions and composition.
- Measure plain step mean/p50/p95/max, active/docked/dead/wreck/mount/projectile
  counts, observer-on/off, CPU sampling and candidate visits on the same revision.
- Target opening salvos, boundary navigation, haven recovery and the fabrication
  boundary separately. Avoid brute-force multi-hour full-match sweeps.
- Gate: unchanged current engine tests and repeat combat hashes. This report's
  experiment is preliminary evidence; the durable benchmark is a follow-up.

### Phase 1 — Separate presentation from engine ownership

- Introduce `src/engine/battleProtocol.ts` DTOs and a small `BattleController`
  interface with command dispatch, acknowledged state and snapshot/event inboxes.
- Implement a local host using the existing synchronous engine for parity.
  Replace `TacticalCanvas`'s engine advancement/callback ownership with render
  input and events; adapt `App`'s reset/step/continuation/export paths.
- Audit every read, including haven leases, wing visuals, carrier fabrication,
  selected-entity fields and object-keyed decals. Preserve current control semantics.
- Gate: local-host replay yields identical combat state and event ordering;
  existing engine tests import the same synchronous simulation API unchanged.

### Phase 2 — Dedicated Worker, correctness transport

- Add `src/engine/simulation.worker.ts` and host scheduler/command handling,
  then Worker-backed controller. Start with explicit render DTO cloning and
  sequenced batched events, not a clone of the simulation instance.
- Create/own fleets and observer inside Worker; implement initialization, epoch
  barriers, pause/resume, focus/tab suspension, speed, manual stepping, export,
  errors and cleanup. One fixed tick per yielded task; bounded pacing debt.
- Keep Worker global typings isolated (`/// <reference lib="webworker" />` with
  appropriate dedicated TS project if needed), avoiding conflicting combined
  DOM/Worker globals; use type-only shared imports.
- Gate: same initialization and applied-tick command log produces matching
  local-host/Worker combat results. Browser Worker smoke verification is required;
  Node Vitest or worker_threads alone cannot verify Vite module-worker loading,
  browser structured cloning or focus/visibility behavior.

### Phase 3 — Transferable presentation pipeline

- Add `src/engine/renderSnapshot.ts` codec, metadata revisions and three-buffer
  pool/recycling; main keeps stable display objects and coherent React DTOs.
- Implement delayed interpolation, shortest-angle handling, discontinuities,
  explicit projectile retirement and frame-drained effects/audio.
- Add transport metrics to Perf: Worker step versus pack/receive/decode/draw,
  achieved ticks/s and speed, snapshot age, command latency and queue pressure.
- Gate: codec round-trip field coverage; no detached-buffer use, stale leases,
  dropped essential events or duplicate audio. Browser 400-ship camera/selection,
  pause and menus remain responsive; frame costs satisfy the selected display
  target independently of achieved simulation speed.

### Phase 4 — Optional shared memory

- Benchmark transferable versus SAB on the same browser/device/composition.
  Add isolation headers only to verified deployments and retain transferable
  fallback. Specify/test atomic publication and pinned-slot ownership.
- Gate: concurrency stress tests show no mixed-tick reads or overwritten slots;
  full consumer/event parity and measured material frame/transport improvement.
  If transfer/decode already fits the render budget, stop at Phase 3.

### Phase 5 — Improve compute throughput independently

- Optimize measured candidate enumeration/allocations with preserved order and
  conservative bounds; verify current drift/contact/targeting regressions.
- Gate for claiming real-time 400-ship simulation: sustained average compute +
  packing below 16.67 ms with headroom, acceptable tail/debt, on named hardware
  and tested compositions/phases. 120 FPS rendering does not require 120 Hz
  simulation. Multi-Worker/WASM/SoA engine rewrites need separate analysis.

### Regression and browser acceptance matrix

Keep existing fast Vitest suite intact. New tests should verify actual boundary
failures, not mirror transport implementation:

- Same applied-tick command stream across host transports and different frame/
  publication intervals: combat equality, beam cadence, damage, winner and logs.
- Pause/order/speed/manual-step sequencing; reset/continue with old messages in
  flight; StrictMode cleanup; export response belongs to its requested tick/epoch.
- Skipped snapshots containing a projectile's whole lifetime or destruction;
  event watermarks, no duplicate effects/audio and no unexplained critical loss.
- Metadata/capacity growth, entity generation reuse, dock/warp discontinuities,
  angle wrap at ±pi, and stable decals/selected telemetry through buffer recycle.
- Browser SAB availability/fallback; pinned-slot races; background suspension,
  Worker errors, CPU-heavy ticks and resumption without catch-up storms.

Relevant existing suites include `simulation.test.ts` (fine/coarse updates,
beam cadence, remnants), `navigationScalar`, `swarmOptimization`, `fireControl`,
`pointDefense`, `missileGuidance`, `shieldHaven`, `carrierFabricationEvasion`,
`wreckImpact`, `mapObstaclePhysics`, `combatAudioEvents`, `projectileFeedback`,
`fleetBreakdown` and `drift`. Fast checks deliberately skip heavy integration
tests; future Worker delivery needs selected heavy and browser checks in addition.

Required current regression commands, from repository root (PowerShell 5.1
uses conditional chaining rather than shell `&&`):

```powershell
npm run test:fast --prefix games/space_battler/frontend
npx tsc -p games/space_battler/frontend/tsconfig.app.json --noEmit
npx biome check games/space_battler/frontend/src
```

Verification completed for this documentation-only investigation:

- Fast Vitest: **43 files passed, 1 skipped; 642 tests passed, 4 skipped**.
- App TypeScript check: passed, no diagnostics.
- Biome: **59 source files checked**, no fixes or diagnostics.

No dev server/build or browser performance validation was performed.

## 9. Next-gen compute roadmap: 200v200 to 400v400

Worker offload preserves UI responsiveness but does not by itself make a slow
tick real-time. Profile and validate each change against the existing combat
semantics, fixed timestep and calibrated parameters.

1. **Always-on, every-tick hot loops (60 Hz):** isolate the
   `collisionContactSolver` pair work (N × N) and `projectileEngine` sweep work
   (P × N) in flat SoA TypedArrays and evaluate compiled WebAssembly SIMD kernels.
   Preserve collision ordering, conservative bounds and numerical behavior.
2. **Cadence-driven scans (every 6–8 ticks):** cache `NavigationContext`
   neighbor lists and `fireControl` target-acquisition candidates across pilot
   reaction windows (~120–180 ms), with invalidation for changes that cannot wait.
3. **Situational worklists:** maintain `boundaryShips[]`, `activeMissiles[]`,
   `activeWrecks[]` and `woundedHavenSeekers[]`; use O(1) active counts to skip
   absent work while keeping membership and transitions authoritative.
4. **Coarse multi-worker offload (future 600–800 ships):** evaluate a secondary
   Worker for coarse, read-only batch AI/fire-control scoring matrices, rather
   than per-feature micro-workers. Measure transfer and synchronization overhead.

These are proposals, not measured speedups or a guarantee of real-time 400v400.
WebGPU remains a longer-term feasibility question, including fallback costs.

## 10. References

- Local implementation: `frontend/src/engine/simulation.ts`,
  `navigationContext.ts`, `fireControl.ts`, `collisionContactSolver.ts`,
  `carrierHangar.ts`, `fighterMissionSystem.ts`, `shieldHaven.ts`,
  `frontend/src/types/combat.ts`, `frontend/src/App.tsx`, and
  `frontend/src/canvas/{TacticalCanvas.tsx,effects.ts,havenRenderer.ts}`.
- Local diagnostic methodology: `frontend/bench/wave15bProfile.ts`,
  `frontend/bench/wave15b.summary.json` (historical),
  [profiling guide](profiling_and_optimization.md),
  [rendering pipeline](rendering_pipeline.md).
- [MDN: transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects):
  ArrayBuffer transfer moves backing storage, detaches sender and requires the
  buffer in the message payload; typed views themselves are not transferable.
- [MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer):
  shared backing memory, atomic coordination and secure cross-origin-isolated
  context requirements.
