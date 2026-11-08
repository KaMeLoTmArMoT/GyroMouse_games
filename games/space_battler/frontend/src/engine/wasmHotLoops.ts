// Dependency-free MVP WASM: scalar f64 instructions preserve JS operation order;
// no SIMD, relaxed math, imports, asynchronous compilation or external toolchain.
type Bytes = number[];
const I32 = 0x7f;
const F64 = 0x7c;
const get = (index: number): Bytes => [0x20, index];
const set = (index: number, value: Bytes): Bytes => [...value, 0x21, index];
function leb(value: number): Bytes {
  const bytes: Bytes = [];
  do {
    const byte = value & 127;
    value >>>= 7;
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return bytes;
}
function integer(value: number): Bytes {
  const bytes = [0x41];
  let more = true;
  while (more) {
    const byte = value & 127;
    value >>= 7;
    more = !((value === 0 && !(byte & 64)) || (value === -1 && !!(byte & 64)));
    bytes.push(byte | (more ? 128 : 0));
  }
  return bytes;
}
function number(value: number): Bytes {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return [0x44, ...new Uint8Array(buffer)];
}
const op = (code: number, a: Bytes, b: Bytes): Bytes => [...a, ...b, code];
const add = (a: Bytes, b: Bytes) => op(0xa0, a, b);
const sub = (a: Bytes, b: Bytes) => op(0xa1, a, b);
const mul = (a: Bytes, b: Bytes) => op(0xa2, a, b);
const div = (a: Bytes, b: Bytes) => op(0xa3, a, b);
const square = (a: Bytes) => mul(a, a);
const sumSquares = (a: Bytes, b: Bytes) => add(square(a), square(b));
const and = (a: Bytes, b: Bytes) => op(0x71, a, b);
const or = (a: Bytes, b: Bytes) => op(0x72, a, b);
const eq = (a: Bytes, b: Bytes) => op(0x46, a, b);
const iadd = (a: Bytes, b: Bytes) => op(0x6a, a, b);
const imul = (a: Bytes, b: Bytes) => op(0x6c, a, b);
const loadF = (pointer: number, offset: number): Bytes => [
  ...get(pointer),
  0x2b,
  3,
  ...leb(offset),
];
const loadI = (pointer: number, offset: number): Bytes => [
  ...get(pointer),
  0x28,
  2,
  ...leb(offset),
];
const skipIf = (condition: Bytes, depth = 1): Bytes => [
  ...condition,
  0x04,
  0x40,
  0x0c,
  depth,
  0x0b,
];
const increment = (index: number): Bytes => set(index, iadd(get(index), integer(1)));

function projectileBody(): Bytes {
  // Parameters: count, sweeps ptr, flags ptr, result ptr, sx/sy/ex/ey,
  // fraction, trigger radius, team, target. Locals follow at index 12.
  const i = 12,
    victim = 13,
    p = 14,
    flags = 15;
  const first = 16,
    bestDistance = 17,
    x0 = 18,
    y0 = 19,
    x1 = 20,
    y1 = 21;
  const radius = 22,
    dx = 23,
    dy = 24,
    a = 25,
    b = 26,
    c = 27;
  const disc = 28,
    t = 29,
    distance = 30;
  const outside = (v0: number, v1: number): Bytes =>
    or(
      and(op(0x64, get(v0), get(radius)), op(0x64, get(v1), get(radius))),
      and(op(0x63, get(v0), [...get(radius), 0x9a]), op(0x63, get(v1), [...get(radius), 0x9a])),
    );
  return [
    2,
    4,
    I32,
    15,
    F64,
    ...set(victim, integer(-1)),
    ...set(first, number(Infinity)),
    ...set(bestDistance, number(Infinity)),
    0x02,
    0x40,
    0x03,
    0x40,
    ...op(0x4e, get(i), get(0)),
    0x0d,
    1,
    0x02,
    0x40,
    ...set(p, iadd(get(1), imul(get(i), integer(40)))),
    ...set(flags, iadd(get(2), imul(get(i), integer(8)))),
    ...skipIf(or(eq(loadI(flags, 4), integer(0)), eq(loadI(flags, 0), get(10)))),
    ...set(x0, sub(get(4), loadF(p, 0))),
    ...set(y0, sub(get(5), loadF(p, 8))),
    ...set(x1, sub(get(6), add(loadF(p, 0), mul(loadF(p, 16), get(8))))),
    ...set(y1, sub(get(7), add(loadF(p, 8), mul(loadF(p, 24), get(8))))),
    ...set(radius, add(loadF(p, 32), get(9))),
    ...skipIf(or(outside(x0, x1), outside(y0, y1))),
    ...set(dx, sub(get(x1), get(x0))),
    ...set(dy, sub(get(y1), get(y0))),
    ...set(c, sub(sumSquares(get(x0), get(y0)), square(get(radius)))),
    ...op(0x65, get(c), number(0)),
    0x04,
    0x40,
    ...set(t, number(0)),
    0x05,
    ...set(a, sumSquares(get(dx), get(dy))),
    ...skipIf(op(0x63, get(a), number(1e-10)), 2),
    ...set(b, mul(number(2), add(mul(get(x0), get(dx)), mul(get(y0), get(dy))))),
    ...set(disc, sub(square(get(b)), mul(mul(number(4), get(a)), get(c)))),
    ...skipIf(op(0x63, get(disc), number(0)), 2),
    ...set(t, div(sub([...get(b), 0x9a], [...get(disc), 0x9f]), mul(number(2), get(a)))),
    // This branch is inside the overlap if, hence depth 2 exits the per-ship block.
    ...and(op(0x66, get(t), number(0)), op(0x65, get(t), number(1))),
    0x45,
    0x04,
    0x40,
    0x0c,
    2,
    0x0b,
    0x0b,
    ...set(distance, [...sumSquares(get(x0), get(y0)), 0x9f]),
    ...or(
      op(0x63, get(t), get(first)),
      and(
        op(0x61, get(t), get(first)),
        or(
          eq(get(i), get(11)),
          and(op(0x47, get(victim), integer(-1)), op(0x63, get(distance), get(bestDistance))),
        ),
      ),
    ),
    0x04,
    0x40,
    ...set(first, get(t)),
    ...set(victim, get(i)),
    ...set(bestDistance, get(distance)),
    0x0b,
    0x0b,
    ...increment(i),
    0x0c,
    0,
    0x0b,
    0x0b,
    ...get(3),
    ...get(first),
    0x39,
    3,
    0,
    ...get(victim),
    0x0b,
  ];
}

function collisionBody(): Bytes {
  // count, positions ptr, tether flags ptr, output ptr, pass, margin,
  // first row, exclusive last row, first column (for row refreshes).
  const i = 9,
    j = 10,
    count = 11,
    a = 12,
    b = 13,
    dx = 14,
    dy = 15,
    radius = 16;
  const flagAt = (index: number): Bytes => [
    ...iadd(get(2), imul(get(index), integer(4))),
    0x28,
    2,
    0,
  ];
  const store = (offset: number, value: Bytes): Bytes => [
    ...iadd(get(3), imul(get(count), integer(8))),
    ...value,
    0x36,
    2,
    offset,
  ];
  return [
    2,
    5,
    I32,
    3,
    F64,
    ...set(i, get(6)),
    0x02,
    0x40,
    0x03,
    0x40,
    ...op(0x4e, get(i), get(7)),
    0x0d,
    1,
    ...set(j, iadd(get(i), integer(1))),
    ...op(0x48, get(j), get(8)),
    0x04,
    0x40,
    ...set(j, get(8)),
    0x0b,
    ...set(a, iadd(get(1), imul(get(i), integer(24)))),
    0x02,
    0x40,
    0x03,
    0x40,
    ...op(0x4e, get(j), get(0)),
    0x0d,
    1,
    0x02,
    0x40,
    ...skipIf(op(0x47, or(flagAt(i), flagAt(j)), get(4))),
    ...set(b, iadd(get(1), imul(get(j), integer(24)))),
    ...set(dx, sub(loadF(a, 0), loadF(b, 0))),
    ...set(dy, sub(loadF(a, 8), loadF(b, 8))),
    ...set(radius, add(add(loadF(a, 16), loadF(b, 16)), get(5))),
    ...skipIf(op(0x64, sumSquares(get(dx), get(dy)), square(get(radius)))),
    ...store(0, get(i)),
    ...store(4, get(j)),
    ...increment(count),
    0x0b,
    ...increment(j),
    0x0c,
    0,
    0x0b,
    0x0b,
    ...increment(i),
    0x0c,
    0,
    0x0b,
    0x0b,
    ...get(count),
    0x0b,
  ];
}

let compiledModule: WebAssembly.Module | undefined;
function compileModule(): WebAssembly.Module {
  if (compiledModule) return compiledModule;
  const section = (id: number, body: Bytes): Bytes => [id, ...leb(body.length), ...body];
  const signature = (params: Bytes): Bytes => [0x60, ...leb(params.length), ...params, 1, I32];
  const exported = (name: string, kind: number, index: number): Bytes => [
    name.length,
    ...Array.from(name, (char) => char.charCodeAt(0)),
    kind,
    index,
  ];
  const bodies = [projectileBody(), collisionBody()];
  compiledModule = new WebAssembly.Module(
    new Uint8Array([
      0,
      97,
      115,
      109,
      1,
      0,
      0,
      0,
      ...section(1, [
        2,
        ...signature([I32, I32, I32, I32, F64, F64, F64, F64, F64, F64, I32, I32]),
        ...signature([I32, I32, I32, I32, I32, F64, I32, I32, I32]),
      ]),
      ...section(3, [2, 0, 1]),
      ...section(5, [1, 0, 1]),
      ...section(7, [
        3,
        ...exported("memory", 2, 0),
        ...exported("hit", 0, 0),
        ...exported("pairs", 0, 1),
      ]),
      ...section(10, [2, ...bodies.flatMap((body) => [...leb(body.length), ...body])]),
    ]),
  );
  return compiledModule;
}

interface Kernels {
  memory: WebAssembly.Memory;
  hit: (
    count: number,
    data: number,
    flags: number,
    result: number,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fraction: number,
    trigger: number,
    team: number,
    target: number,
  ) => number;
  pairs: (
    count: number,
    data: number,
    flags: number,
    output: number,
    pass: number,
    margin: number,
    firstRow: number,
    lastRow: number,
    firstColumn: number,
  ) => number;
}

/** Each owner gets independent growable scratch memory; returned views live until ensureCapacity. */
export class WasmHotLoops {
  private readonly kernels: Kernels | undefined;
  private buffer = new ArrayBuffer(0);
  private capacity = 0;
  private flagsOffset = 0;
  private collisionOffset = 0;
  private tetherOffset = 0;
  private outputOffset = 0;
  private resultOffset = 0;
  shipSweeps = new Float64Array(0); // oldX, oldY, dx, dy, active shield radius
  shipFlags = new Int32Array(0); // team, alive
  collisionShips = new Float64Array(0); // X, Y, envelope
  tetherFlags = new Int32Array(0);
  collisionPairs = new Int32Array(0);
  private result = new Float64Array(0);
  first = Infinity;

  constructor(useWasm = true) {
    if (useWasm && typeof WebAssembly !== "undefined") {
      try {
        this.kernels = new WebAssembly.Instance(compileModule()).exports as unknown as Kernels;
      } catch {
        // Hosts can disable WASM (e.g. CSP); the same flat-buffer reference remains usable.
      }
    }
  }

  get wasmEnabled(): boolean {
    return this.kernels !== undefined;
  }
  get memory(): WebAssembly.Memory | undefined {
    return this.kernels?.memory;
  }

  ensureCapacity(count: number): void {
    if (count <= this.capacity && this.capacity !== 0) return;
    const capacity = Math.max(16, count, this.capacity * 2);
    const oldSweeps = this.shipSweeps.slice();
    const oldFlags = this.shipFlags.slice();
    const oldCollisions = this.collisionShips.slice();
    const oldTethers = this.tetherFlags.slice();
    this.capacity = capacity;
    this.flagsOffset = capacity * 40;
    this.collisionOffset = this.flagsOffset + capacity * 8;
    this.tetherOffset = this.collisionOffset + capacity * 24;
    this.outputOffset = this.tetherOffset + capacity * 4;
    this.resultOffset = Math.ceil((this.outputOffset + capacity * (capacity - 1) * 4) / 8) * 8;
    const bytes = this.resultOffset + 8;
    if (this.kernels) {
      const memory = this.kernels.memory;
      const pages = Math.ceil(bytes / 65536) - memory.buffer.byteLength / 65536;
      if (pages > 0) memory.grow(pages);
      this.buffer = memory.buffer;
    } else this.buffer = new ArrayBuffer(bytes);
    this.shipSweeps = new Float64Array(this.buffer, 0, capacity * 5);
    this.shipFlags = new Int32Array(this.buffer, this.flagsOffset, capacity * 2);
    this.collisionShips = new Float64Array(this.buffer, this.collisionOffset, capacity * 3);
    this.tetherFlags = new Int32Array(this.buffer, this.tetherOffset, capacity);
    this.collisionPairs = new Int32Array(this.buffer, this.outputOffset, capacity * (capacity - 1));
    this.result = new Float64Array(this.buffer, this.resultOffset, 1);
    this.shipSweeps.set(oldSweeps);
    this.shipFlags.set(oldFlags);
    this.collisionShips.set(oldCollisions);
    this.tetherFlags.set(oldTethers);
  }

  updateShip(index: number, radius: number, alive: boolean): void {
    this.shipSweeps[index * 5 + 4] = radius;
    this.shipFlags[index * 2 + 1] = alive ? 1 : 0;
  }

  findProjectileShipHitWasm(
    count: number,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    fraction: number,
    trigger: number,
    team: number,
    target: number,
  ): number {
    if (this.kernels) {
      const victim = this.kernels.hit(
        count,
        0,
        this.flagsOffset,
        this.resultOffset,
        sx,
        sy,
        ex,
        ey,
        fraction,
        trigger,
        team,
        target,
      );
      this.first = this.result[0];
      return victim;
    }
    let victim = -1;
    let first = Infinity;
    let bestDistance = Infinity;
    const data = this.shipSweeps;
    for (let i = 0; i < count; i++) {
      if (!this.shipFlags[i * 2 + 1] || this.shipFlags[i * 2] === team) continue;
      const p = i * 5;
      const x0 = sx - data[p],
        y0 = sy - data[p + 1];
      const x1 = ex - (data[p] + data[p + 2] * fraction);
      const y1 = ey - (data[p + 1] + data[p + 3] * fraction);
      const radius = data[p + 4] + trigger;
      if (
        (x0 > radius && x1 > radius) ||
        (x0 < -radius && x1 < -radius) ||
        (y0 > radius && y1 > radius) ||
        (y0 < -radius && y1 < -radius)
      )
        continue;
      const dx = x1 - x0,
        dy = y1 - y0;
      const c = x0 * x0 + y0 * y0 - radius * radius;
      let t = 0;
      if (!(c <= 0)) {
        const a = dx * dx + dy * dy;
        if (a < 1e-10) continue;
        const b = 2 * (x0 * dx + y0 * dy);
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        t = (-b - Math.sqrt(disc)) / (2 * a);
        if (!(t >= 0 && t <= 1)) continue;
      }
      const distance = Math.sqrt(x0 * x0 + y0 * y0);
      if (
        t < first ||
        (t === first && (i === target || (victim !== -1 && distance < bestDistance)))
      ) {
        first = t;
        victim = i;
        bestDistance = distance;
      }
    }
    this.first = first;
    return victim;
  }

  collectCollisionPairsWasm(
    count: number,
    tetheredPass: boolean,
    margin = 0,
    firstRow = 0,
    lastRow = count,
    firstColumn = 0,
  ): number {
    if (this.kernels)
      return this.kernels.pairs(
        count,
        this.collisionOffset,
        this.tetherOffset,
        this.outputOffset,
        Number(tetheredPass),
        margin,
        firstRow,
        lastRow,
        firstColumn,
      );
    let pairs = 0;
    for (let i = firstRow; i < lastRow; i++) {
      for (let j = Math.max(i + 1, firstColumn); j < count; j++) {
        if (Boolean(this.tetherFlags[i] || this.tetherFlags[j]) !== tetheredPass) continue;
        const dx = this.collisionShips[i * 3] - this.collisionShips[j * 3];
        const dy = this.collisionShips[i * 3 + 1] - this.collisionShips[j * 3 + 1];
        const radius = this.collisionShips[i * 3 + 2] + this.collisionShips[j * 3 + 2] + margin;
        if (dx * dx + dy * dy > radius * radius) continue;
        this.collisionPairs[pairs * 2] = i;
        this.collisionPairs[pairs * 2 + 1] = j;
        pairs++;
      }
    }
    return pairs;
  }
}
