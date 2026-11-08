import { parentPort } from "node:worker_threads";
import { register } from "tsx/esm/api";

register();
// Run the production module-worker entry on a real OS thread. Only its browser
// messaging surface is adapted; the host, engine and transferable buffers are real.
globalThis.self = {
  onmessage: null,
  postMessage: (message, transfer) => parentPort.postMessage(message, transfer),
  close: () => parentPort.close(),
};
await import("../../src/engine/simulation.worker.ts");
parentPort.on("message", (data) => globalThis.self.onmessage({ data }));
