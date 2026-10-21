// WorldForge's Paint as durable jobs (M5 item 3, audit WF-16). Paint used to
// answer `{ queued: true }`, write the finished picture straight over the
// entry's, and keep a failure only in the server's log; the page polled for
// three minutes and a reload forgot it. Here, offline, with the scripted
// fake agent (HARNESS_FAKE) as the server's picture backend, on a real
// database and through the real routes:
//
//   - Paint answers a job id, and a reload (the entry's paint route) finds
//     it queued, then working, then ready, with the entry's own picture
//     untouched until the DM accepts.
//   - A second Paint while one runs answers that one.
//   - Accept puts the new picture on the entry and keeps the old one to put
//     back; reject keeps the entry's picture and lets the new one go.
//   - A backend that declines and no backend at all each leave a failed job
//     with its reason, and Retry paints again. The upload allowance is for
//     files people send: Paint, like every picture the server paints, is not
//     counted against it.
//   - A job still waiting can be cancelled and is then never painted; one
//     being painted cannot be. A long wait is said, and a job a restart
//     dropped fails instead of spinning.
//   - A picture asked for before a newer choice (a newer accept, an upload)
//     is marked stale and is not accepted without the DM saying so.
//   - Only the story authority reaches any of it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-paint-jobs-"));
const scriptFile = path.join(scriptDir, "fake-script.json");
process.env.HARNESS_FAKE = "1";
process.env.HARNESS_FAKE_SCRIPT = scriptFile;
process.on("exit", () => fs.rmSync(scriptDir, { recursive: true, force: true }));
const setScript = (turns) => fs.writeFileSync(scriptFile, JSON.stringify(turns));
const PAINT = [[{ paint: [48, 48] }, { text: "done" }]];
// Long enough to read the job while the backend works on it.
const SLOW_PAINT = [[{ wait: 700 }, { paint: [48, 48] }, { text: "done" }]];
const DECLINE = [[{ text: "I can't help draw that." }]];

const { openWorld } = await import("./lib/enforce-world.mjs");
const { suite } = await import("./lib/enforce-harness.mjs");
const { test, finish } = suite("test-world-paint-jobs");

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createWorldEntity, worldView } = await import("../src/lib/db/world-forge.ts");
const { enqueueMediaJob } = await import("../src/lib/media-queue.ts");
const { NO_IMAGE_BACKEND } = await import("../src/lib/dm/world-ai.ts");
const { PAINT_RESTARTED } = await import("../src/lib/db/world-paint-jobs.ts");
const { admitUpload, resetUploadBudget } = await import("../src/lib/upload-budget.ts");

const world = await openWorld();
const { owner } = world;
const HARNESS = { harness: { id: "codex", images: "native", imagesVerifiedAt: new Date().toISOString() }, images: { defaultBackend: "harness" } };
saveGlobalConfig(HARNESS);
const id = createWorkshop(owner.id, { title: "Saltmarch" }).id;
const ORIGINAL = `/uploads/${randomUUID()}.png`;
const made = (input) => {
  const result = createWorldEntity(id, input);
  assert.ok(!("error" in result), result.error);
  return result.entity;
};
const mira = made({ typeId: "t_character", name: "Mira Fenn", text: "A lamp-keeper with salt in her hair.", portrait: ORIGINAL });
const harbour = made({ typeId: "t_location", name: "Saltmarch Harbour", text: "A harbour behind a chain." });

const aiRoute = await world.route("campaigns/[campaignId]/world/ai");
const paintRoute = await world.route("campaigns/[campaignId]/world/entities/[ref]/paint");
const entityRoute = await world.route("campaigns/[campaignId]/world/entities/[ref]");
async function call(route, method, { as = owner, ref, body } = {}) {
  world.signIn({ id: as.id });
  const response = await route[method](
    new Request("http://local/", { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }),
    { params: Promise.resolve({ campaignId: id, ref: encodeURIComponent(ref ?? "") }) },
  );
  return { status: response.status, body: await response.json() };
}
const paint = (entity, as) => call(aiRoute, "POST", { as, body: { tool: "paint", ref: entity.ref } });
// What the entry page reads on open: a reload.
const reload = (entity, as) => call(paintRoute, "GET", { as, ref: entity.ref });
const decide = (entity, body) => call(paintRoute, "POST", { ref: entity.ref, body });
const portraitOf = (entity) => worldView(id).entities.find((entry) => entry.ref === entity.ref).portrait;
const jobOf = async (entity, jobId) => (await reload(entity)).body.jobs.find((job) => job.id === jobId);
// Everything already on the picture queue has run.
const queueDrained = () => enqueueMediaJob(`drain ${Math.random()}`, async () => {});
// The queue held by another table's picture until `release` is called.
function holdQueue() {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  void enqueueMediaJob(`another table ${Math.random()}`, () => held);
  return release;
}
async function until(check, label) {
  for (let waited = 0; ; waited += 25) {
    if (await check()) return;
    assert.ok(waited < 10_000, `never ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
// The backend's refusals are logged as well as kept; keep the run readable.
async function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

let accepted = "";

await test("Paint answers a job, a reload finds it queued, working and ready, and the entry keeps its picture until it is accepted", async () => {
  setScript(SLOW_PAINT);
  const release = holdQueue();
  const asked = await paint(mira);
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  const job = asked.body.job;
  assert.ok(job.id, "the answer names the job");
  assert.equal(job.state, "queued");
  assert.equal((await jobOf(mira, job.id)).state, "queued", "a reload still finds it queued");

  const again = await paint(mira);
  assert.equal(again.body.job.id, job.id, "a second Paint while one waits answers that one");
  assert.equal(again.body.already, true);
  assert.equal((await reload(mira)).body.jobs.length, 1, "no second job");

  release();
  await until(async () => (await jobOf(mira, job.id)).state === "working", "saw the job working");
  assert.equal(portraitOf(mira), ORIGINAL);
  await until(async () => (await jobOf(mira, job.id)).state === "ready", "saw the job ready");
  const ready = await jobOf(mira, job.id);
  assert.match(ready.result, /^\/uploads\/[\w-]+\.png$/, "the finished picture is stored");
  assert.equal(ready.previous, ORIGINAL, "the job remembers the picture it was asked over");
  assert.equal(ready.stale, false);
  assert.equal(portraitOf(mira), ORIGINAL, "a finished picture did not replace the entry's own");
  assert.ok(fs.existsSync(path.join(process.cwd(), "public", ready.result)), "the picture is on disk");

  const kept = await decide(mira, { action: "accept", job: job.id });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(kept.body.job.state, "accepted");
  assert.equal(portraitOf(mira), ready.result, "accept puts it on the entry");
  assert.deepEqual(kept.body.status.earlier, [ORIGINAL], "the picture it replaced can be put back");
  accepted = ready.result;
});

await test("Reject keeps the entry's picture and lets the new one go; a decided job cannot be decided again", async () => {
  setScript(PAINT);
  const { job } = (await paint(mira)).body;
  await queueDrained();
  const ready = await jobOf(mira, job.id);
  assert.equal(ready.state, "ready");
  const turned = await decide(mira, { action: "reject", job: job.id });
  assert.equal(turned.status, 200);
  assert.equal(turned.body.job.state, "rejected");
  assert.equal(turned.body.job.result, "", "the rejected picture is no longer named");
  assert.equal(portraitOf(mira), accepted, "the entry keeps its picture");
  const twice = await decide(mira, { action: "accept", job: job.id });
  assert.equal(twice.status, 409);
  assert.match(twice.body.error, /already rejected/);
  assert.equal(portraitOf(mira), accepted);
});

await test("A backend that declines leaves a failed job with its reason after a reload, and Retry paints again", async () => {
  setScript(DECLINE);
  const { job } = (await quietly(async () => {
    const asked = await paint(harbour);
    await queueDrained();
    return asked;
  })).body;
  const failed = await jobOf(harbour, job.id);
  assert.equal(failed.state, "failed");
  assert.match(failed.reason, /^The image backend did not paint it: .*answered without a picture: "I can't help draw that\."/);
  assert.equal(portraitOf(harbour), "", "nothing was written to the entry");

  setScript(PAINT);
  const retried = (await paint(harbour)).body.job;
  assert.notEqual(retried.id, job.id, "Retry is a new job");
  await queueDrained();
  const { body } = await reload(harbour);
  assert.deepEqual(body.jobs.map((entry) => entry.state), ["ready", "failed"], "the newest first, the failure kept beneath it");
  assert.equal(portraitOf(harbour), "");
});

await test("No image backend: Paint is refused with a failed job that says what is missing and where to set it up", async () => {
  saveGlobalConfig({ images: { defaultBackend: "" } });
  try {
    const refused = await paint(harbour);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error, NO_IMAGE_BACKEND);
    assert.match(NO_IMAGE_BACKEND, /no image backend set up.*Admin > Image generation.*uploaded picture/);
    assert.equal(refused.body.job.state, "failed");
    const { body } = await reload(harbour);
    assert.equal(body.jobs[0].id, refused.body.job.id, "the refusal is there after a reload");
    assert.equal(body.jobs[0].reason, NO_IMAGE_BACKEND);
  } finally {
    saveGlobalConfig(HARNESS);
  }
});

await test("Paint is not counted against the upload allowance, as no picture the server paints is", async () => {
  setScript(PAINT);
  const before = process.env.UPLOAD_DAILY_FILES;
  process.env.UPLOAD_DAILY_FILES = "1";
  resetUploadBudget();
  try {
    assert.equal(admitUpload({ id: owner.id }, 10, 1), null, "the day's one file is spent");
    const asked = await paint(harbour);
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    assert.notEqual(asked.body.job.state, "failed");
    await until(async () => (await jobOf(harbour, asked.body.job.id)).state === "ready", "saw the picture painted");
    assert.equal((await decide(harbour, { action: "reject", job: asked.body.job.id })).status, 200);
  } finally {
    if (before === undefined) delete process.env.UPLOAD_DAILY_FILES;
    else process.env.UPLOAD_DAILY_FILES = before;
    resetUploadBudget();
  }
});

await test("A job still waiting can be cancelled and is never painted; one being painted cannot be cancelled", async () => {
  setScript(PAINT);
  const release = holdQueue();
  const { job } = (await paint(harbour)).body;
  const cancelled = await decide(harbour, { action: "cancel", job: job.id });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.job.state, "cancelled");
  release();
  await queueDrained();
  const after = await jobOf(harbour, job.id);
  assert.equal(after.state, "cancelled", "the queue skipped it");
  assert.equal(after.result, "");

  setScript(SLOW_PAINT);
  const slow = (await paint(harbour)).body.job;
  await until(async () => (await jobOf(harbour, slow.id)).state === "working", "saw the slow job working");
  const refused = await decide(harbour, { action: "cancel", job: slow.id });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /being painted and cannot be stopped/);
  await queueDrained();
  assert.equal((await jobOf(harbour, slow.id)).state, "ready");
});

await test("A long wait is said with the queue's depth, and a job a restart dropped fails instead of spinning", async () => {
  setScript(PAINT);
  const release = holdQueue();
  try {
    const { job } = (await paint(mira)).body;
    assert.equal((await jobOf(mira, job.id)).longQueued, false);
    const db = getDatabase();
    db.prepare(`UPDATE world_paint_jobs SET created_at = ? WHERE id = ?`).run(new Date(Date.now() - 3 * 60_000).toISOString(), job.id);
    const { body } = await reload(mira);
    assert.equal(body.jobs.find((entry) => entry.id === job.id).longQueued, true);
    assert.deepEqual(body.queue, { painting: 1, waiting: 1 }, "the queue says what the job is behind");

    // The process that queued it is gone: its queue went with it.
    db.prepare(`UPDATE world_paint_jobs SET boot = 'an earlier process' WHERE id = ?`).run(job.id);
    const lost = await jobOf(mira, job.id);
    assert.equal(lost.state, "failed");
    assert.equal(lost.reason, PAINT_RESTARTED);
    const fresh = await paint(mira);
    assert.equal(fresh.body.already, false, "a new Paint is not held up by the lost one");
    assert.equal(fresh.body.job.state, "queued");
    release();
    await queueDrained();
    assert.equal((await jobOf(mira, job.id)).state, "failed", "the lost job stays failed when the queue moves");
    const done = await jobOf(mira, fresh.body.job.id);
    assert.equal(done.state, "ready");
    assert.equal((await decide(mira, { action: "reject", job: done.id })).status, 200);
  } finally {
    release();
  }
});

await test("An older picture cannot replace a newer choice without the DM saying so", async () => {
  setScript(PAINT);
  // A: asked over the accepted picture, and left waiting.
  const older = (await paint(mira)).body.job;
  await queueDrained();
  // B: asked after, and accepted.
  const newer = (await paint(mira)).body.job;
  await queueDrained();
  assert.equal((await decide(mira, { action: "accept", job: newer.id })).status, 200);
  const chosen = portraitOf(mira);
  assert.equal(chosen, (await jobOf(mira, newer.id)).result);

  const stale = await jobOf(mira, older.id);
  assert.equal(stale.state, "ready");
  assert.equal(stale.stale, true, "the older picture is marked as asked over an earlier choice");
  const refused = await decide(mira, { action: "accept", job: older.id });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.stale, true);
  assert.match(refused.body.error, /changed after this one was asked for/);
  assert.equal(portraitOf(mira), chosen, "the newer choice stands");

  const replaced = await decide(mira, { action: "accept", job: older.id, replace: true });
  assert.equal(replaced.status, 200);
  assert.equal(portraitOf(mira), stale.result, "the DM may still choose it, knowingly");
  assert.ok(replaced.body.status.earlier.includes(chosen), "and the newer one can be put back");
});

await test("An upload made while a picture was painted is a newer choice too", async () => {
  setScript(PAINT);
  const { job } = (await paint(harbour)).body;
  const upload = `/uploads/${randomUUID()}.png`;
  const patched = await call(entityRoute, "PATCH", { ref: harbour.ref, body: { portrait: upload } });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  await queueDrained();
  const ready = await jobOf(harbour, job.id);
  assert.equal(ready.stale, true);
  assert.equal((await decide(harbour, { action: "accept", job: job.id })).status, 409);
  assert.equal(portraitOf(harbour), upload);
});

await test("Use again puts back a picture the entry had, and nothing else", async () => {
  const { body } = await reload(mira);
  assert.ok(body.earlier.includes(ORIGINAL), JSON.stringify(body.earlier));
  const back = await decide(mira, { action: "reuse", picture: ORIGINAL });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(portraitOf(mira), ORIGINAL);
  assert.ok(!back.body.status.earlier.includes(ORIGINAL), "the picture on the entry is not offered again");
  const stranger = await decide(mira, { action: "reuse", picture: `/uploads/${randomUUID()}.png` });
  assert.equal(stranger.status, 404, "a path the entry never had is refused");
  assert.equal(portraitOf(mira), ORIGINAL);
  const harbourJob = (await reload(harbour)).body.jobs[0];
  const crossed = await decide(mira, { action: "accept", job: harbourJob.id });
  assert.equal(crossed.status, 404, "another entry's job is not this entry's");
});

await test("Only the story authority reads or decides paint jobs", async () => {
  const player = world.addUser("player");
  const job = (await reload(mira)).body.jobs[0];
  for (const [method, body] of [["GET"], ["POST", { action: "reject", job: job.id }]]) {
    const answer = await call(paintRoute, method, { as: player, ref: mira.ref, body });
    assert.ok([403, 404].includes(answer.status), `${method} answered ${answer.status} to a stranger`);
  }
  const painted = await paint(mira, player);
  assert.ok([403, 404].includes(painted.status));
});

await test("Deleting an entry forgets its jobs", async () => {
  const deleted = await call(entityRoute, "DELETE", { ref: harbour.ref });
  assert.equal(deleted.status, 200);
  const left = getDatabase().prepare(`SELECT COUNT(*) AS n FROM world_paint_jobs WHERE ref = ?`).get(harbour.ref);
  assert.equal(left.n, 0);
});

await queueDrained();
finish();
