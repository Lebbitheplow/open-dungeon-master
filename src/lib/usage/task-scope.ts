import { AsyncLocalStorage } from "node:async_hooks";

// What the model calls made inside a piece of work are for, without every
// call site naming it: trackUtilityCall (src/lib/dm/call-tracker.ts) opens a
// scope with the job's kind, and src/lib/dm/model.ts reads it for the
// model-call record (src/lib/usage/model-calls.ts). Upkeep scopes are also
// marked background, so their calls wait while a table's turn is calling the
// same backend (src/lib/dm/inference-gate.ts).

export type ModelTaskScope = { task: string; background: boolean };

declare global {
  var __odmModelTaskScope: AsyncLocalStorage<ModelTaskScope> | undefined;
}

const storage = (globalThis.__odmModelTaskScope ??= new AsyncLocalStorage<ModelTaskScope>());

export function withModelTask<T>(scope: ModelTaskScope, run: () => Promise<T>): Promise<T> {
  return storage.run(scope, run);
}

export function currentModelTask(): ModelTaskScope | undefined {
  return storage.getStore();
}
