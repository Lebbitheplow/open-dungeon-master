import type { VerifiedRow } from "./curate.ts";
import rows from "./verified.json";

// Measurements of catalog models on real hardware, one row per model and
// hardware profile, written by scripts/bench-image-models.mjs --write and
// reviewed by eye (the verdict and notes). Shipped with the app so every
// server knows what its hardware made of each model.
// The JSON's inferred type is a union of every row's exact shape (each
// model's own file slots); the test checks the rows against VerifiedRow.
export const VERIFIED_ROWS = rows as unknown as VerifiedRow[];
