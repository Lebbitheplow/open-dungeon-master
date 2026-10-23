// Issue 251: a subclass's own training is part of the build. A Life Domain
// cleric's build editor says the domain's heavy armor on its calling step,
// the stored build walks through unchanged, and the save keeps heavy armor
// on the library character.
import { check, eventually, sleep } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}a, ${root}button, ${root}[role="menuitem"]`).filter({ hasText: text }).locator("visible=true");

export default {
  name: "subclass-training",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    await t.open(`/characters/${ids.lifeCleric}`);
    await t.tap(await eventually(async () => {
      const edit = visible(page, root, /^\s*Edit build\s*$/);
      return (await edit.count()) ? edit.first() : null;
    }, { label: "the Edit build button" }));
    // The editor opens on its summary (backlog F3); the Class row goes to
    // the Class step, and the walk goes on from there.
    const classRow = page.locator(`${root}section[data-active] [data-summary-edit="calling"]`).locator("visible=true");
    await eventually(() => classRow.count(), { timeoutMs: 30_000, label: "the summary's Class row" });
    await t.tap(classRow.first());
    await sleep(500);

    // Walk the stored build to Save, reading every step for the domain's
    // training on the way.
    let said = "";
    let save = null;
    for (let step = 0; step < 16 && !save; step += 1) {
      // The builder keeps every step mounted; the Class step is the one
      // whose header is showing.
      const calling = await page.getByText(/Step \d+ \/ \d+ · Class/i).locator("visible=true").count();
      const grant = page.getByText("Your subclass grants this training").first();
      if (calling && !said && (await grant.count())) {
        said = (await grant.locator("xpath=..").innerText()).replace(/\s+/g, " ");
        await grant.scrollIntoViewIfNeeded();
        await t.shot("calling-step");
      }
      // An edit offers Save changes on every step, so it is taken once the
      // Class step has been read (or when there is no step left).
      const done = visible(page, root, /^Save changes$/);
      const next = visible(page, root, /^\s*Continue/i);
      if ((await done.count()) && (said || !(await next.count()))) {
        save = done.first();
        break;
      }
      check((await next.count()) > 0, `a way on from step ${step + 1} of the build editor`);
      const ready = await eventually(() => next.first().isEnabled(), { timeoutMs: 10_000, label: "Continue" }).catch(() => false);
      if (!ready) await t.shot(`step-${step + 1}`);
      check(ready, `step ${step + 1} of the stored Life Domain build is complete`);
      await t.tap(next.first());
      await sleep(500);
    }
    check(Boolean(said), "the Class step says what the subclass trains");
    check(/heavy armor/i.test(said), `the Life Domain's heavy armor is named (${said.slice(-200)})`);
    check(Boolean(save), "the build editor reached Save changes");
    await t.tap(save);
    await eventually(async () => {
      const text = (await page.locator(`${root}h1, ${root}h2`).allInnerTexts()).join(" ");
      return text.includes(ids.lifeClericName);
    }, { timeoutMs: 30_000, label: "the character page after the save" });
    const stored = await (await api.get(`${base}/api/characters/${ids.lifeCleric}`)).json();
    const armor = stored.character?.sheet?.proficiencies?.armor ?? [];
    check(armor.includes("heavy"), `the saved build keeps heavy armor (${armor.join(", ")})`);
    await t.shot("saved");
  },
};
