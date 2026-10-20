// M5 item 3 of the WorldForge plan (audit WF-16): Paint as a job the entry
// page reads from the server. The server's picture backend is pointed at a
// stand-in for the OpenAI picture API, which can hold a picture, refuse
// one, or paint one. On an entry with no picture yet, the author:
//
//   - presses Paint while the stand-in holds the render, sees "Painting",
//     reloads, and still sees it;
//   - sees the finished picture beside "No picture yet" and keeps it;
//   - is refused by the backend, reads why, and presses Retry; turns that
//     one down, and the entry keeps its picture;
//   - paints two more, keeps the newer, and is warned before the older one
//     replaces it; then puts an earlier picture back.
//
// The paint panel is finger-sized on a phone, does not scroll sideways, and
// axe finds no serious problem in it. The admin's image settings are put
// back at the end.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { axeViolations, check, eventually, freePort } from "../lib.mjs";

const PICTURE = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "..", "public", "assets", "placeholders", "character", "feminine.webp")).toString("base64");

// The stand-in: `mode` decides the next picture. "hold" waits for release().
function pictureApi(port) {
  const state = { mode: "ok", requests: 0, held: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!req.url?.endsWith("/images/generations")) {
        res.writeHead(404).end();
        return;
      }
      state.requests += 1;
      const paint = () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ b64_json: PICTURE }] }));
      };
      if (state.mode === "fail") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "The stand-in refused: no lamps today." } }));
      } else if (state.mode === "hold") {
        state.held.push(paint);
      } else {
        paint();
      }
    });
  });
  const release = () => {
    for (const paint of state.held.splice(0)) paint();
  };
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, state, release })));
}

export default {
  name: "world-paint-jobs",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = Date.now().toString(36);
    const name = `Mira Fenn ${stamp}`;
    await api.post(`${base}/api/profile/tours`, { data: { finished: [{ id: "workshop-world", version: 1, how: "ended" }] } });
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Paint ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    const campaign = `${base}/api/campaigns/${id}`;
    const stand = await pictureApi(await freePort());
    const before = (await (await api.get(`${base}/api/admin/settings`)).json()).config.images;
    try {
      const pointed = await api.patch(`${base}/api/admin/settings`, {
        data: { images: { defaultBackend: "openai", openaiBaseUrl: `http://127.0.0.1:${stand.server.address().port}/v1`, openaiModel: "stand-in-image", openaiApiKey: "stand-in-key" } },
      });
      check(pointed.ok(), `pointing the server's pictures at the stand-in answered ${pointed.status()}`);
      const created = await api.post(`${campaign}/world/entities`, { data: { typeId: "t_character", name, text: "A lamp-keeper with salt in her hair." } });
      check(created.ok(), `the entry was made (${created.status()})`);
      const ref = (await created.json()).entity.ref;
      const stored = async () => ((await (await api.get(`${campaign}/world`)).json()).entities ?? []).find((entity) => entity.ref === ref)?.portrait ?? "";

      // The app shell reads the host's capabilities once, when it signs in,
      // before the stand-in was set up, so its World offers no Paint. The
      // page is the same compiled page; the website run covers it.
      if (t.app) return;
      await page.route(/\/api\/capabilities(\?|$)/, async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.images = { ...body.images, configured: true };
        await route.fulfill({ response, json: body });
      });
      const entry = page.locator(`${root}[data-tour="world-entry"]`).locator("visible=true").first();
      const openEntry = async () => {
        await t.open(`/workshop/${id}?system=world`);
        const row = page.locator(`${root}[role="listbox"][aria-label="Entries"] [role="option"]`, { hasText: name }).first();
        await eventually(() => row.count(), { timeoutMs: 30_000, label: "the entry in the list" });
        await row.click();
        await eventually(() => entry.count(), { timeoutMs: 15_000, label: "the entry's page" });
      };
      await openEntry();
      const panel = entry.locator('[data-testid="world-paint"]');
      const state = (key) => panel.locator(`[data-paint-state="${key}"]`);
      const paintButton = () => entry.getByRole("button", { name: /^(Paint|Painting|Queued)$/ });
      const button = (label) => panel.getByRole("button", { name: label });

      // ---- painting survives a reload ----
      stand.state.mode = "hold";
      await paintButton().click();
      await eventually(() => state("working").count(), { timeoutMs: 20_000, label: "the panel saying Painting" });
      check((await paintButton().innerText()).trim() === "Painting" && (await paintButton().isDisabled()), "the Paint button says Painting and waits");
      await t.shot("working");
      await t.reload();
      await openEntry();
      await eventually(() => state("working").count(), { timeoutMs: 20_000, label: "Painting still shown after a reload" });
      check((await stored()) === "", "the entry has no picture while it is painted");

      // ---- the finished picture waits beside the entry's own ----
      stand.release();
      stand.state.mode = "ok";
      await eventually(() => state("ready").count(), { timeoutMs: 20_000, label: "the finished picture waiting" });
      check(/No picture yet/.test(await panel.innerText()), "beside it, the entry's own (none yet)");
      const fresh = await panel.getByRole("img", { name: `${name}, the new picture` }).getAttribute("src");
      check(/^\/uploads\//.test(fresh ?? ""), `the new picture is shown (${fresh})`);
      check((await stored()) === "", "the finished picture did not replace the entry's own");
      if (t.viewport === "phone") {
        for (const label of ["Use the new picture", "Keep the current one"]) {
          const box = await button(label).boundingBox();
          check(box && box.height >= 40, `${label} is finger-sized on a phone (${box?.height})`);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(overflow <= 1, `the entry scrolls sideways on a phone by ${overflow}px`);
      }
      const problems = await axeViolations(page, `${root}[data-testid="world-paint"]`);
      check(!problems.length, `axe finds no serious problem in the paint panel: ${JSON.stringify(problems)}`);
      await t.shot("ready");
      await button("Use the new picture").click();
      await eventually(async () => (await stored()) === fresh, { timeoutMs: 15_000, label: "the new picture kept on the entry" });
      await eventually(async () => (await entry.locator("header img").first().getAttribute("src")) === fresh, { timeoutMs: 15_000, label: "the entry's header showing it" });

      // ---- a refusal says why, and Retry paints again ----
      stand.state.mode = "fail";
      await paintButton().click();
      await eventually(() => state("failed").count(), { timeoutMs: 20_000, label: "the failure" });
      const failure = await state("failed").innerText();
      check(/Not painted\./.test(failure) && /The stand-in refused: no lamps today\./.test(failure), `the failure says why: ${failure}`);
      check((await state("failed").getAttribute("role")) === "alert", "the failure is announced");
      await t.shot("failed");
      stand.state.mode = "ok";
      await button("Retry").click();
      await eventually(() => state("ready").count(), { timeoutMs: 20_000, label: "the retried picture waiting" });
      check((await state("failed").count()) === 0, "the failure gives way to the retry");
      await button("Keep the current one").click();
      await eventually(async () => (await state("ready").count()) === 0, { timeoutMs: 15_000, label: "the turned-down picture gone" });
      check((await stored()) === fresh, "turning it down kept the entry's picture");

      // ---- an older picture does not replace a newer choice unnoticed ----
      await paintButton().click();
      await eventually(async () => (await panel.locator("[data-paint-job]").count()) === 1, { timeoutMs: 20_000, label: "the older picture waiting" });
      await paintButton().click();
      await eventually(async () => (await panel.locator("[data-paint-job]").count()) === 2, { timeoutMs: 20_000, label: "the newer picture waiting too" });
      const [newer, older] = await panel.locator("[data-paint-job]").all();
      const newerSrc = await newer.getByRole("img", { name: `${name}, the new picture` }).getAttribute("src");
      const olderSrc = await older.getByRole("img", { name: `${name}, the new picture` }).getAttribute("src");
      await newer.getByRole("button", { name: "Use the new picture" }).click();
      await eventually(async () => (await stored()) === newerSrc, { timeoutMs: 15_000, label: "the newer picture kept" });
      const waiting = panel.locator("[data-paint-job]").first();
      await eventually(() => waiting.locator("[data-paint-stale]").count(), { timeoutMs: 15_000, label: "the older picture marked as asked before the newer choice" });
      await t.shot("stale");
      await waiting.getByRole("button", { name: "Use the new picture" }).click();
      const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: "Replace the newer picture?" });
      await eventually(() => dialog.count(), { timeoutMs: 10_000, label: "the question before the newer picture is replaced" });
      check((await stored()) === newerSrc, "nothing was replaced before the answer");
      await dialog.getByRole("button", { name: "Use this one" }).click();
      await eventually(async () => (await stored()) === olderSrc, { timeoutMs: 15_000, label: "the older picture used, knowingly" });

      // ---- an earlier picture put back ----
      const earlier = panel.locator('[data-testid="world-paint-earlier"]');
      await eventually(() => earlier.count(), { timeoutMs: 15_000, label: "the earlier pictures" });
      const summary = earlier.locator("summary");
      const box = await summary.boundingBox();
      check(box && box.height >= 40, `the earlier pictures' row is finger-sized (${box?.height})`);
      await summary.click();
      check((await earlier.getByRole("button", { name: /^Use earlier picture \d+ again$/ }).count()) === 2, "the two pictures it had are offered");
      await earlier.getByRole("button", { name: "Use earlier picture 2 again" }).click();
      await eventually(async () => (await stored()) === fresh, { timeoutMs: 15_000, label: "the first picture put back" });
      await t.shot("earlier");
    } finally {
      stand.release();
      await api
        .patch(`${base}/api/admin/settings`, {
          data: { images: { defaultBackend: before.defaultBackend, openaiBaseUrl: before.openaiBaseUrl, openaiModel: before.openaiModel, ...(before.hasOpenaiApiKey ? {} : { openaiApiKey: "" }) } },
        })
        .catch(() => {});
      stand.server.close();
      await api.delete(`${base}/api/workshops/${id}`);
    }
  },
};
