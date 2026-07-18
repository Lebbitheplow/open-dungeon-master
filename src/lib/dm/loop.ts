// Compatibility entry point: the DM turn now lives in src/lib/dm/turn.ts as
// a persisted state machine (park/resume for physical dice). Callers keep
// using runDmTurn via the per-campaign queue.
export { startDmTurn as runDmTurn } from "@/lib/dm/turn";
