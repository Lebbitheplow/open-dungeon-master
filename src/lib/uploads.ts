// What a file this app wrote looks like.
//
// /api/upload is the one place in this codebase that turns uploaded bytes
// into a file on disk. It validates the type, caps the size, and names the
// result with a uuid it generates itself, so every legitimate image path has
// exactly one shape. Anything else is refused rather than sanitized: a path
// that is not one of ours has no business being one of ours, and refusing is
// the only answer that cannot be talked around by a cleverer traversal.
//
// Shared by the map backdrop (src/lib/battlemap/backdrop.ts) and NPC
// portraits, which both store a bare path and both hand it straight to a
// renderer.
//
// Pure by design: a regular expression and nothing else.

const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.(png|jpe?g|webp)$/;

export function isUploadedImagePath(value: unknown): value is string {
  return typeof value === "string" && UPLOAD_PATH.test(value);
}
