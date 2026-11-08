import { SimulationWorkerHost } from "./simulationWorkerHost";
import type { SimulationWorkerRequest, SimulationWorkerResponse } from "./simulationWorkerMessages";

// A narrow worker-only surface avoids mixing lib.dom and lib.webworker globals
// in the application's existing TypeScript project.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimulationWorkerRequest>) => void) | null;
  postMessage(message: SimulationWorkerResponse, transfer: ArrayBuffer[]): void;
  close(): void;
};
const host = new SimulationWorkerHost((message, transfer = []) => {
  scope.postMessage(message, transfer);
  if (message.type === "DISPOSED") scope.close();
});
scope.onmessage = (event) => host.receive(event.data);
