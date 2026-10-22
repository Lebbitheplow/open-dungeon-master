// Journey (plan M6, audit WF-23): a server with no AI. No text model and no
// image backend, then an image backend whose queued Paint job fails. No
// real provider is called: the picture backend is a stand-in on a local
// port that refuses every picture.
//
// With the server saying it has neither model, the author makes an NPC, a
// place and a creature by hand, each from the workshop's Create chooser and
// that thing's own editor: the NPC in the Cast's editor and the place in the
// wiki's new-entry form and its editor, both typed by keyboard alone, and
// the creature in the Bestiary's builder, given its World entry there. The
// place gets a picture uploaded by hand. Along the way every AI action is
// either absent or says why and where an admin switches it on: the
// chooser's notes for drafting and for pictures, the World's note, no
// Outline, Forge or Ask view, no Paint, no Draft it, no Suggest and no
// Paint one in the Cast.
//
// Then the server has an image backend that refuses (the stand-in), and the
// author presses Paint on the place. The queued job fails: the entry says
// it was not painted and why, and offers Retry. The entry keeps its
// hand-uploaded picture, and an edit to it still saves.
//
// The finish: every manual path completes (the three records exist with
// their World entries, the creature's linked to its stat block, the place
// showing the uploaded picture), and every unavailable or failed action
// says what to do next.
//
// The single steps are proved on their own elsewhere: the chooser's no-AI
// note in 58-world-outline, its ways in 41-create-chooser, Paint's jobs and
// refusal in 58-world-paint-jobs, an entry form's save in 35-entry-conflict.
//
// Set up through the API, because none of it is what the journey proves:
// the workshop itself, the server's image settings (put back at the end),
// and what the page is told the server can do (the capabilities answer, as
// 58-world-outline and 58-world-paint-jobs fake it). The app's shell reads
// the host's capabilities once at sign-in, so this journey runs on the
// website.
import http from "node:http";
import path from "node:path";
import { check, eventually, freePort } from "../lib.mjs";

const PICTURE_FILE = path.join(import.meta.dirname, "..", "..", "..", "public", "assets", "placeholders", "character", "feminine.webp");
const REFUSAL = "The stand-in picture service is out of credits.";

// The stand-in picture backend: it refuses every picture, and counts them.
function refusingPictureApi(port) {
  const state = { requests: 0 };
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      if (!req.url?.endsWith("/images/generations")) {
        res.writeHead(404).end();
        return;
      }
      state.requests += 1;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: REFUSAL } }));
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, state })));
}

// Presses Tab until `target` holds the focus, the way a keyboard user walks
// a form; fails when it is not reached within `max` presses.
async function tabTo(page, target, label, max = 80) {
  const handle = await target.elementHandle();
  for (let index = 0; index <= max; index += 1) {
    if (await handle.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`${label} was not reached by Tab within ${max} presses`);
}

// Presses `key` on the focused control that opens a file picker, and picks
// `file`. Now and then Chrome lets the file input's click by without a
// picker (about one run in five here; the click reached the input each
// time), so the key is pressed again, as a person would press it again.
async function pressForFile(page, key, file) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const waiting = page.waitForEvent("filechooser", { timeout: 10_000 }).catch(() => null);
    await page.keyboard.press(key);
    const chooser = await waiting;
    if (chooser) {
      await chooser.setFiles(file);
      return;
    }
  }
  throw new Error(`no file picker opened from ${key} in three tries`);
}

export default {
  name: "journey-no-ai",
  viewports: ["desktop", "phone"],
  app: false,
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = Date.now().toString(36);
    const npcName = `Harbourmaster Wynne ${stamp}`;
    const placeName = `The Gull Steps ${stamp}`;
    const creatureName = `Reef Crawler ${stamp}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `By hand ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the journey");
    const id = (await made.json()).workshop.id;
    const shop = `${base}/api/campaigns/${id}`;
    const stand = await refusingPictureApi(await freePort());
    const before = (await (await api.get(`${base}/api/admin/settings`)).json()).config.images;
    const monsters = async () => (await (await api.get(`${shop}/dm/bestiary`)).json()).monsters.filter((monster) => monster.draft.name.includes(stamp));
    const entities = async () => (await (await api.get(`${shop}/world`)).json()).entities ?? [];
    // What the page is told: no text model, and no image backend until the
    // stand-in is set up.
    let images = false;
    await page.route(/\/api\/capabilities(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.story = { ...body.story, configured: false };
      body.images = { ...body.images, configured: images };
      await route.fulfill({ response, json: body });
    });
    const chooser = page.getByRole("dialog");
    const openCreate = async () => {
      const create = page.locator(`${root}[data-testid="create-open"]`).locator("visible=true").first();
      await eventually(() => create.isVisible(), { timeoutMs: 30_000, label: "Create" });
      await create.click();
      await eventually(() => chooser.locator('[data-testid="create-choices"]').isVisible(), { timeoutMs: 15_000, label: "the Create chooser" });
    };
    const params = async () => (await t.url()).searchParams;
    // Create asks the tool it opens to open its editor, and asks once more a
    // beat later only when nothing answered (src/app/workshop/[workshopId]/
    // page.tsx). The asks are counted on the page, with the page's clock at
    // the step, so a step can wait until the retry would have come.
    const countAsks = () =>
      page.evaluate(() => {
        window.__odmAsks = 0;
        window.__odmAskStart = performance.now();
        if (!window.__odmAsksHeard) {
          window.addEventListener("odm-tour-prepare", () => {
            window.__odmAsks += 1;
          });
          window.__odmAsksHeard = true;
        }
      });
    const asked = () => page.evaluate(() => window.__odmAsks ?? 0);
    const pastRetry = () => page.evaluate(() => performance.now() - (window.__odmAskStart ?? 0) > 1_800);
    const entryPage = page.locator(`${root}[data-tour="world-entry"]`).locator("visible=true").first();
    try {
      // ---- the chooser says what is not offered, and where it is switched on ----
      await t.open(`/workshop/${id}`);
      await openCreate();
      const noAi = chooser.locator('[data-testid="create-no-ai"]');
      await eventually(() => noAi.isVisible(), { timeoutMs: 15_000, label: "the chooser's no-AI note" });
      check(/made by hand/.test(await noAi.innerText()) && (await noAi.innerText()).includes("Admin > Text model defaults"), `the chooser says drafting is off and where an admin switches it on: ${await noAi.innerText()}`);
      await chooser.locator('[data-testid="create-choice-illustration"]').click();
      const pictureNote = chooser.locator('[data-testid="create-enable"]');
      await eventually(() => pictureNote.count(), { label: "the pictures' note" });
      check((await pictureNote.innerText()).includes("Admin > Image generation"), `a picture says where an admin switches painting on: ${await pictureNote.innerText()}`);
      check((await chooser.getByText("Draft with AI", { exact: true }).count()) === 0, "a picture still offers Draft with AI");
      await chooser.getByRole("button", { name: "Everything you can make" }).click();

      // ---- an NPC by hand, in the Cast's editor, by keyboard ----
      await chooser.locator('[data-testid="create-choice-npc"]').click();
      const npcNote = chooser.locator('[data-testid="create-enable"]');
      await eventually(() => npcNote.count(), { label: "the NPC's drafting note" });
      check((await npcNote.innerText()).includes("Admin > Text model defaults"), `the NPC choice says where drafting is switched on: ${await npcNote.innerText()}`);
      const npcStep = chooser.locator('[data-testid="create-step"]', { hasText: "Open the NPC editor" });
      check(await npcStep.isEnabled(), "the NPC editor is offered without a model");
      check(!/Draft with AI/i.test(await npcStep.innerText()), "the NPC step still offers Draft with AI");
      await t.shot("chooser-npc");
      await countAsks();
      await npcStep.click();
      await eventually(async () => (await params()).get("system") === "cast", { timeoutMs: 20_000, label: "the Cast" });
      const npcEditor = page.getByRole("dialog", { name: "Someone new" });
      await eventually(() => npcEditor.isVisible(), { timeoutMs: 20_000, label: "the NPC editor" });
      const npcField = npcEditor.getByPlaceholder("Their name");
      await tabTo(page, npcField, "the NPC's name");
      await page.keyboard.type(npcName);
      await page.keyboard.press("Tab");
      await page.keyboard.type("harbourmaster");
      check((await npcEditor.getByRole("button", { name: /Suggest/ }).count()) === 0, "the Cast's editor offers Suggest without a model");
      const saveNpc = npcEditor.getByRole("button", { name: "Save them" });
      await tabTo(page, saveNpc, "Save them");
      await page.keyboard.press("Enter");
      const npc = page.getByRole("dialog", { name: npcName });
      await eventually(() => npc.isVisible(), { timeoutMs: 20_000, label: "the NPC saved and open" });
      check(await npc.getByRole("button", { name: "Add a face" }).isVisible(), "a face can be added by hand");
      check((await npc.getByRole("button", { name: /Paint one/ }).count()) === 0, "the Cast offers Paint one without an image backend");
      const cast = (await (await api.get(`${shop}/dm/npcs`)).json()).npcs.filter((row) => row.name === npcName);
      check(cast.length === 1 && cast[0].role === "harbourmaster", `the Cast holds the NPC as typed: ${JSON.stringify(cast.map((row) => [row.name, row.role]))}`);
      await t.shot("npc-made");
      // Found by this journey and fixed with it: Create asked the Cast to
      // open its editor twice, 450 ms and 1400 ms after it arrived, so an
      // author who saved and closed the new NPC inside 1.4 s, as this
      // keyboard run does, got a blank "Someone new" editor over the Cast.
      // The Cast answers the first ask, so there is no second: the closed
      // editor stays closed past the moment the retry used to come.
      await page.keyboard.press("Escape");
      await eventually(async () => (await pastRetry()) && (await page.getByRole("dialog").count()) === 0, { label: "the Cast with no editor open, past Create's retry" });
      check((await asked()) === 1, `Create asked the Cast ${await asked()} times, though the Cast answered the first`);

      // ---- a place by hand, in the wiki's form, by keyboard ----
      await openCreate();
      await chooser.locator('[data-testid="create-choice-place"]').click();
      await countAsks();
      await chooser.locator('[data-testid="create-step"]', { hasText: "Name a new place" }).click();
      await eventually(async () => (await params()).get("system") === "world", { timeoutMs: 20_000, label: "WorldForge" });
      const newName = page.getByRole("textbox", { name: "Name", exact: true }).locator("visible=true").first();
      await eventually(() => newName.isVisible(), { timeoutMs: 20_000, label: "the new-entry form" });
      check((await page.getByRole("radio", { name: "Location", exact: true }).locator("visible=true").first().getAttribute("aria-checked")) === "true", "the form starts on a place's type");
      await tabTo(page, newName, "the new entry's name");
      await page.keyboard.type(placeName);
      await page.keyboard.press("Enter");
      await eventually(async () => (await entryPage.locator("h3").first().innerText().catch(() => "")).includes(placeName), { timeoutMs: 20_000, label: "the place's page" });
      // The same fix: the wiki answered the first ask, so the new-entry form
      // does not open again over the place, taking the focus.
      await eventually(() => pastRetry(), { label: "past Create's retry" });
      check((await asked()) === 1, `Create asked the wiki ${await asked()} times, though the wiki answered the first`);
      check((await page.locator(`${root}input[aria-label="Name"]`).count()) === 0, "the new-entry form opened again after the place was made");

      // The World says what needs AI, offers no AI view, and no Paint.
      const note = page.locator(`${root}[data-tour="world-ai-note"]`).locator("visible=true").first();
      const noteText = await note.innerText();
      check(noteText.includes("Admin > Text model defaults") && noteText.includes("Admin > Image generation") && /pictures can still be uploaded/.test(noteText), `the World says what needs AI and where it is switched on: ${noteText}`);
      for (const view of ["outline", "forge", "ask"]) {
        check((await page.locator(`${root}[data-tour="world-view-${view}"]`).count()) === 0, `the ${view} view is offered without a model`);
      }
      check((await entryPage.getByRole("button", { name: /^(Paint|Painting|Queued)$/ }).count()) === 0, "Paint is offered without an image backend");

      // Its editor, by keyboard: the arrival text, a picture from a file, Save.
      await entryPage.locator('[data-tour="world-edit"]').click();
      const arrival = page.getByRole("textbox", { name: /^On arrival/ }).locator("visible=true").first();
      await eventually(() => arrival.isVisible(), { timeoutMs: 15_000, label: "the place's editor" });
      check((await page.locator(`${root}[data-tour="world-draft"]`).count()) === 0, "the editor offers Draft it without a model");
      const arrivalText = `Two hundred salt-white steps down to the water ${stamp}.`;
      await tabTo(page, arrival, "the arrival text");
      await page.keyboard.type(arrivalText);
      const addPicture = page.getByRole("button", { name: "Add a picture" }).locator("visible=true").first();
      await tabTo(page, addPicture, "Add a picture");
      await pressForFile(page, "Enter", PICTURE_FILE);
      await eventually(() => page.getByRole("button", { name: "Replace the picture" }).locator("visible=true").count(), { timeoutMs: 20_000, label: "the uploaded picture in the form" });
      await t.shot("place-form");
      const save = page.locator(`${root}form button[type="submit"]`, { hasText: "Save" }).locator("visible=true").first();
      await tabTo(page, save, "Save");
      await page.keyboard.press("Enter");
      await eventually(async () => (await page.getByRole("textbox", { name: /^On arrival/ }).locator("visible=true").count()) === 0, { timeoutMs: 15_000, label: "the editor closed after saving" });
      const place = (await entities()).find((entity) => entity.name === placeName);
      check(place?.shelf === "location" && place.text === arrivalText, `the place saved as typed: ${JSON.stringify([place?.shelf, place?.text])}`);
      const uploaded = place.portrait;
      check(/^\/uploads\//.test(uploaded), `the uploaded picture is the place's: ${uploaded}`);
      await eventually(async () => (await entryPage.locator("header img").first().getAttribute("src").catch(() => "")) === uploaded, { timeoutMs: 15_000, label: "the entry showing the uploaded picture" });
      await t.shot("place-made");

      // ---- a creature by hand, in the Bestiary's builder ----
      await openCreate();
      await chooser.locator('[data-testid="create-choice-creature"]').click();
      await countAsks();
      await chooser.locator('[data-testid="create-step"]', { hasText: "Build a monster" }).click();
      await eventually(async () => (await params()).get("system") === "bestiary", { timeoutMs: 20_000, label: "the Bestiary" });
      const monsterName = page.getByPlaceholder("Bone Tyrant").locator("visible=true").first();
      await eventually(() => monsterName.isVisible(), { timeoutMs: 20_000, label: "the Bestiary's builder" });
      await eventually(() => pastRetry(), { label: "past Create's retry" });
      check((await asked()) === 1, `Create asked the Bestiary ${await asked()} times, though the Bestiary answered the first`);
      await monsterName.fill(creatureName);
      await page.getByRole("button", { name: "Start from the baseline" }).click();
      const give = page.locator('[data-testid="give-world-entry"]').locator("visible=true").first();
      await eventually(() => give.isVisible(), { timeoutMs: 20_000, label: "the stat block offering a World entry" });
      await give.click();
      await eventually(async () => (await entryPage.locator("h3").first().innerText().catch(() => "")).includes(creatureName), { timeoutMs: 20_000, label: "the creature's World entry" });
      const record = entryPage.locator('[data-testid="world-bound-record"]').first();
      await eventually(async () => (await record.innerText().catch(() => "")).includes(creatureName), { timeoutMs: 15_000, label: "the entry naming its stat block" });

      // Every manual path completed.
      const stored = await monsters();
      check(stored.length === 1 && stored[0].draft.name === creatureName, `the Bestiary holds the creature: ${stored.map((monster) => monster.draft.name).join(", ")}`);
      const world = await entities();
      const kinds = Object.fromEntries(world.filter((entity) => entity.name.includes(stamp)).map((entity) => [entity.name, entity.shelf]));
      check(kinds[npcName] === "npc" && kinds[placeName] === "location" && kinds[creatureName] === "lore", `the three are World entries: ${JSON.stringify(kinds)}`);
      const bound = world.find((entity) => entity.name === creatureName)?.bound ?? [];
      check(bound.some((entry) => entry.kind === "monster" && entry.found && entry.ownId === stored[0].id), `the creature's entry links its stat block: ${JSON.stringify(bound)}`);

      // ---- an image backend that refuses: Paint fails, and says what next ----
      const pointed = await api.patch(`${base}/api/admin/settings`, {
        data: { images: { defaultBackend: "openai", openaiBaseUrl: `http://127.0.0.1:${stand.server.address().port}/v1`, openaiModel: "stand-in-image", openaiApiKey: "stand-in-key" } },
      });
      check(pointed.ok(), `pointing the server's pictures at the stand-in answered ${pointed.status()}`);
      images = true;
      await t.open(`/workshop/${id}?system=world&entry=${encodeURIComponent(place.ref)}`);
      await eventually(async () => (await entryPage.locator("h3").first().innerText().catch(() => "")).includes(placeName), { timeoutMs: 30_000, label: "the place's page again" });
      const paint = entryPage.getByRole("button", { name: /^(Paint|Painting|Queued)$/ });
      await eventually(() => paint.isVisible(), { timeoutMs: 15_000, label: "Paint, now there is an image backend" });
      const textOnly = await page.locator(`${root}[data-tour="world-ai-note"]`).locator("visible=true").first().innerText();
      check(textOnly.includes("Admin > Text model defaults") && !textOnly.includes("Paint needs"), `the World's note now names only the text model: ${textOnly}`);
      await paint.click();
      const failed = entryPage.locator('[data-testid="world-paint"] [data-paint-state="failed"]');
      await eventually(() => failed.count(), { timeoutMs: 30_000, label: "the failed picture" });
      const failure = await failed.innerText();
      check(/Not painted\./.test(failure) && failure.includes(REFUSAL), `the failure says why: ${failure}`);
      check((await failed.getAttribute("role")) === "alert", "the failure is announced");
      const retry = failed.getByRole("button", { name: "Retry" });
      check((await retry.isVisible()) && (await retry.isEnabled()), "the failure offers Retry");
      check(stand.state.requests >= 1, "the queued job reached the image backend");
      check((await paint.innerText()).trim() === "Paint" && (await paint.isEnabled()), "Paint is free again after the failure");
      await t.shot("paint-failed");

      // The entry keeps working: its picture stays, and an edit still saves.
      check((await entities()).find((entity) => entity.ref === place.ref)?.portrait === uploaded, "the failure took the uploaded picture away");
      await entryPage.locator('[data-tour="world-edit"]').click();
      const aliases = page.getByRole("textbox", { name: /^Also called/ }).locator("visible=true").first();
      await eventually(() => aliases.isVisible(), { timeoutMs: 15_000, label: "the editor after the failure" });
      await aliases.fill("the Steps");
      await page.locator(`${root}form button[type="submit"]`, { hasText: "Save" }).locator("visible=true").first().click();
      await eventually(async () => (await page.getByRole("textbox", { name: /^Also called/ }).locator("visible=true").count()) === 0, { timeoutMs: 15_000, label: "the editor closed after saving" });
      const kept = (await entities()).find((entity) => entity.ref === place.ref);
      check(JSON.stringify(kept?.aliases) === JSON.stringify(["the Steps"]) && kept.portrait === uploaded && kept.text === arrivalText, `the entry saved the edit and kept the rest: ${JSON.stringify([kept?.aliases, kept?.portrait, kept?.text])}`);
      await eventually(async () => (await entryPage.locator("header img").first().getAttribute("src").catch(() => "")) === uploaded, { timeoutMs: 15_000, label: "the entry still showing its picture" });
      await t.shot("after-failure");
    } finally {
      await page.unroute(/\/api\/capabilities(\?|$)/).catch(() => {});
      await api
        .patch(`${base}/api/admin/settings`, {
          data: { images: { defaultBackend: before.defaultBackend, openaiBaseUrl: before.openaiBaseUrl, openaiModel: before.openaiModel, ...(before.hasOpenaiApiKey ? {} : { openaiApiKey: "" }) } },
        })
        .catch(() => {});
      stand.server.close();
      // The monster is the user's, not the workshop's.
      for (const monster of await monsters().catch(() => [])) await api.delete(`${shop}/dm/bestiary/${monster.id}`).catch(() => {});
      await api.delete(`${base}/api/workshops/${id}`).catch(() => {});
    }
  },
};
