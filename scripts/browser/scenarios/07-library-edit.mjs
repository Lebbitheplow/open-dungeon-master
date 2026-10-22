// Issue 229: a library character's build opens in the builder at its own
// level and saves back to the same entry; "Duplicate and edit" opens the
// copy, says so, and can throw it away. In the app the edit page is one of
// the native screens (client src/renderer/game/index.tsx ROUTES), so the
// same walk proves the route is there.
import { check, eventually, sleep } from "../lib.mjs";

// Everything on screen: the app's game root, or the page's body.
const screenText = async (page, root) =>
  (await page.locator(root ? root.trim() : "body").first().innerText()).replace(/\s+/g, " ");

const visible = (page, root, text) =>
  page.locator(`${root}a, ${root}button, ${root}[role="menuitem"]`).filter({ hasText: text }).locator("visible=true");

async function walkToSave(t) {
  const { page, root } = t;
  for (let step = 0; step < 16; step += 1) {
    const save = visible(page, root, /^Save changes$/);
    if (await save.count()) {
      return save.first();
    }
    const next = visible(page, root, /^\s*Continue/i);
    check((await next.count()) > 0, `a way on from step ${step + 1} of the build editor`);
    // A step's catalog loads after it opens; a stored build owes nothing.
    const ready = await eventually(() => next.first().isEnabled(), { timeoutMs: 10_000, label: "Continue" }).catch(() => false);
    if (!ready) await t.shot(`step-${step + 1}`);
    check(ready, `step ${step + 1} of the stored build is complete`);
    await t.tap(next.first());
    await sleep(500);
  }
  throw new Error("the build editor never reached Save changes");
}

export default {
  name: "library-edit",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open(`/characters/${ids.library}`);
    await t.tap(await eventually(async () => {
      const edit = visible(page, root, /^\s*Edit build\s*$/);
      return (await edit.count()) ? edit.first() : null;
    }, { label: "the Edit build button" }));
    // The editor opens on its summary (backlog F3); the name row goes to
    // the first step.
    const nameRow = page.locator(`${root}section[data-active] [data-summary-edit="identity"]`).locator("visible=true");
    await eventually(() => nameRow.count(), { timeoutMs: 30_000, label: "the summary's name row" });
    await t.tap(nameRow.first());
    const name = page.locator(`${root}section[data-active] input[aria-label="Name"]`).locator("visible=true").first();
    await name.waitFor({ state: "visible", timeout: 30_000 });
    // The stored name, as an earlier viewport may have renamed it.
    const stored = await name.inputValue();
    check(stored.startsWith(ids.libraryName), `the editor opens on the stored build (${stored})`);
    const renamed = `${ids.libraryName} the ${t.viewport === "phone" ? "Swift" : "Bold"}${t.app ? " (app)" : ""}`;
    const body = await screenText(page, root);
    check(/level 3/i.test(body), "the editor opens at the stored level 3, not at 1");
    await t.shot("editor");
    await name.fill(renamed);
    await t.tap(await walkToSave(t));
    await eventually(async () => {
      const text = (await page.locator(`${root}h1, ${root}h2`).allInnerTexts()).join(" ");
      return text.toLowerCase().includes(renamed.toLowerCase());
    }, { timeoutMs: 30_000, label: "the saved name on the character page" });
    await t.shot("saved");

    // Duplicate and edit: the copy opens in the editor and says it is one.
    // The saved name shows in the editor's own heading before the save has
    // navigated, so wait for the character page's actions themselves: in
    // the app the page arrived a beat after the heading matched, and the
    // menu was looked for on the editor, found absent, and never opened.
    const menu = page.locator(`${root}button[aria-label^="More actions"]`).locator("visible=true");
    await eventually(
      async () => (await menu.count()) || (await visible(page, root, /^\s*Duplicate and edit/).count()),
      { timeoutMs: 30_000, label: "the character page's actions after the save" },
    );
    if (await menu.count()) {
      await t.tap(menu.first());
      await sleep(400);
    }
    // The item's hint follows its label in the same button.
    const duplicate = visible(page, root, /^\s*Duplicate and edit/);
    await eventually(() => duplicate.count(), { label: "Duplicate and edit" });
    await t.tap(duplicate.first());
    await eventually(async () => {
      const text = await screenText(page, root);
      return /A separate copy of/.test(text);
    }, { timeoutMs: 30_000, label: "the copy's notice in the editor" });
    await t.shot("copy");
    // The copy's id is in the address (/characters/<copy>/edit?copyOf=...).
    // (In the app, the shell's router holds it: the window stays on index.html.)
    const where = t.app
      ? await page.evaluate(() => {
          const location = window.odmShell?.navigation?.location();
          return location ? `${location.pathname}${location.search}` : "";
        })
      : page.url();
    const copyId = /\/characters\/([^/?#]+)\/edit/.exec(where)?.[1] ?? null;
    check(Boolean(copyId) && copyId !== ids.library, `the editor holds a new entry (${where})`);
    const discard = visible(page, root, /^\s*Discard this copy/i);
    await t.tap(discard.first());
    // Deleting asks first, and names the original as staying.
    const yes = page.locator(`${root}[role="dialog"] button, ${root}[role="alertdialog"] button`).filter({ hasText: /^\s*Yes\s*$/ }).locator("visible=true");
    await eventually(() => yes.count(), { label: "the delete confirmation" });
    await t.tap(yes.first());
    await eventually(async () => {
      const text = await screenText(page, root);
      return !/A separate copy of/.test(text);
    }, { timeoutMs: 30_000, label: "leaving the discarded copy" });
    const gone = await t.api.get(`${t.base}/api/characters/${copyId}`);
    check(gone.status() === 404, `the discarded copy is gone (${gone.status()})`);
    const kept = await t.api.get(`${t.base}/api/characters/${ids.library}`);
    check(kept.ok(), `the original stays (${kept.status()})`);
  },
};
