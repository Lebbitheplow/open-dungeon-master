// Backlog F9, phase 1: a hero made with levels in two classes, through the
// real class step. At a level 5 table the lead picks a fighter, lets the
// quick fill set the rest, opens "Add a second class" (a class the scores
// cannot reach is listed with its reason and refused), adds a rogue, gives
// it two of the five levels and its skill, fills what the rogue's levels
// owe, and takes the seat: the stored sheet holds fighter 3 / rogue 2. At a
// table that turns multiclassing off the builder offers no second class.
// The seat and the hero it saved are given up again, so the table is
// empty for the next viewport.
//
// ODM_F9_SHOTS, when set, is a folder that also gets the class step with the
// rogue's card (and on a phone the open class list), for review.
import fs from "node:fs";
import path from "node:path";
import { check, eventually, currentStep, upTo } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

export default {
  name: "builder-multiclass",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, api, base } = t;
    const active = `${root}section[data-active]`;
    const extraShots = process.env.ODM_F9_SHOTS || "";
    if (extraShots) fs.mkdirSync(extraShots, { recursive: true });
    const review = async (name) => {
      await t.shot(name);
      if (extraShots) await page.screenshot({ path: path.join(extraShots, `${t.viewport}-${name}.png`) }).catch(() => {});
    };
    const seatAt = async (tableId) => (await (await api.get(`${base}/api/campaigns/${tableId}/sheet`)).json()).sheet ?? null;

    // The builder at a table, on its class step with a fighter picked.
    async function buildAt(tableId) {
      await t.open(`/campaigns/${tableId}/character`);
      const chooser = page.locator(`${root}[data-hero-chooser]`).locator("visible=true").first();
      await eventually(() => chooser.count(), { timeoutMs: 30_000, label: "the hero chooser" });
      await t.tap(chooser.locator('[data-chooser-section="build"]'));
      const startFresh = visible(page, root, /^Start fresh$/);
      if (await upTo(() => startFresh.count(), 1_500)) await t.tap(startFresh.first());
      const fighter = page.locator(`${active} .creator-card[aria-label^="Fighter"]`).locator("visible=true").first();
      await fighter.waitFor({ state: "visible", timeout: 30_000 });
      await t.tap(fighter);
    }
    async function fillRest(label) {
      const fill = page.locator(`${active} [data-quick-fill]`).locator("visible=true");
      await eventually(() => fill.count(), { timeoutMs: 10_000, label: `Fill what's left (${label})` });
      await t.tap(fill.first());
      await eventually(() => page.locator(`${root}[data-quick-readback]`).count(), { timeoutMs: 20_000, label: `the read-back (${label})` });
      await t.tap(visible(page, root, /^Keep them$/).first());
      await eventually(async () => (await page.locator(`${root}[data-quick-readback]`).locator("visible=true").count()) === 0, {
        timeoutMs: 10_000,
        label: `the read-back closing (${label})`,
      });
    }

    // ---- a table that allows a second class ----
    const tableId = ids.multiclassTableId;
    // A seat a stopped run left behind is given up first.
    const left = await seatAt(tableId);
    if (left) {
      await api.delete(`${base}/api/campaigns/${tableId}/sheet`);
      if (left.libraryCharacterId) await api.delete(`${base}/api/characters/${left.libraryCharacterId}`);
    }
    check((await seatAt(tableId)) === null, "the two-path table starts with no hero for the lead");
    await buildAt(tableId);
    await fillRest("the fighter");
    check(/^Step 1:/.test(await currentStep(page, root)), "the fill leaves the build on the class step");

    const add = page.locator(`${active} [data-add-class]`).locator("visible=true").first();
    await eventually(() => add.count(), { timeoutMs: 10_000, label: "Add a second class" });
    check(/Add a second class/.test(await add.innerText()), `the button names the second class (${await add.innerText()})`);
    check((await add.getAttribute("aria-expanded")) === "false", "the class list starts closed");
    await t.tap(add);
    check((await add.getAttribute("aria-expanded")) === "true", "the button says the list is open");
    const list = page.locator(`${active} ul[aria-label^="Classes you could add"]`).locator("visible=true").first();
    await eventually(() => list.count(), { timeoutMs: 5_000, label: "the list of classes to add" });
    // The fighter's scores (the standard array laid for a fighter) leave its
    // Intelligence and Charisma short of 13: such a class is listed, refused
    // in words, and the refusal is its accessible description.
    const refused = await list.locator('button[aria-disabled="true"]').evaluateAll((buttons) =>
      buttons.map((button) => ({
        id: button.getAttribute("data-roving-item"),
        said: document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent ?? "",
      })),
    );
    const short = refused.find((entry) => /your scores fall short/.test(entry.said));
    check(Boolean(short), `a class the scores cannot reach is refused with its reason (${JSON.stringify(refused.slice(0, 3))})`);
    check(/Needs [A-Z][a-z]+ 13/.test(short?.said ?? ""), `the refusal names the score it needs (${short?.said})`);
    // The classes that may be added come first.
    const order = await list.locator("button[data-roving-item]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-disabled") === "true"));
    check(order.indexOf(true) > 0 && order.slice(order.indexOf(true)).every(Boolean), "the classes that may be added are listed first");
    // A refused class does nothing when pressed.
    // Playwright waits on aria-disabled as it does on disabled, so the press
    // is forced: the button takes it, and adds nothing.
    if (short) await list.locator(`button[data-roving-item="${short.id}"]`).click({ force: true });
    check((await page.locator(`${active} [data-extra-class]`).count()) === 0, "a refused class is not added");
    const rogue = list.locator('button[data-roving-item="rogue"]');
    check((await rogue.getAttribute("aria-disabled")) === null, "the rogue may be added");
    check(/thieves' tools/.test(await rogue.innerText()), `the rogue says what it adds (${(await rogue.innerText()).replace(/\s+/g, " ")})`);
    if (t.viewport === "phone") {
      await rogue.scrollIntoViewIfNeeded();
      await review("add-class-list");
    }
    await t.tap(rogue);

    const card = page.locator(`${active} [data-extra-class="rogue"]`).locator("visible=true").first();
    await eventually(() => card.count(), { timeoutMs: 5_000, label: "the rogue's card" });
    const section = page.locator(`${active} [data-builder-target="multiclass"]`).first();
    await eventually(async () => /Fighter 4 \/ Rogue 1/.test(await section.textContent()), { timeoutMs: 5_000, label: "the split at fighter 4 / rogue 1" });
    // Two of the five levels to the rogue.
    await t.tap(card.locator('button[aria-label="Rogue levels"]'));
    const two = page.getByRole("menuitemradio", { name: "2", exact: true }).locator("visible=true").first();
    await eventually(() => two.count(), { timeoutMs: 5_000, label: "the rogue's level list" });
    await t.tap(two);
    await eventually(async () => /Fighter 3 \/ Rogue 2/.test(await section.textContent()), { timeoutMs: 5_000, label: "the split at fighter 3 / rogue 2" });
    // The rogue's skill: the first one not already the hero's.
    const skill = card.locator('button[aria-pressed="false"]:not([disabled])').first();
    const skillName = (await skill.innerText()).trim();
    await t.tap(skill);
    await eventually(async () => (await card.locator('button[aria-pressed="true"]').count()) === 1, { timeoutMs: 5_000, label: `the rogue's skill (${skillName})` });
    // A rogue's 1st level brings two expertise picks: the fill takes them.
    await fillRest("the rogue's expertise");
    // The card from its heading down, clear of the sticky step header.
    await card.evaluate((node) => node.scrollIntoView({ block: "center" }));
    await review("class-step-rogue");

    // The rest of the steps, to the summary and its Join the party.
    const summary = page.locator(`${active} [data-finish-summary]`).locator("visible=true");
    for (let step = 1; step < 6; step += 1) {
      const next = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
      await eventually(
        async () => {
          if (new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root))) return true;
          if (await next.isEnabled()) await t.tap(next);
          await upTo(async () => new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root)), 800);
          return new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root));
        },
        { timeoutMs: 20_000, label: `Continue from step ${step}` },
      );
    }
    await eventually(() => summary.count(), { timeoutMs: 10_000, label: "the summary" });
    const summaryText = (await page.locator(active).first().textContent()).replace(/\s+/g, " ");
    check(/Every step is complete/.test(summaryText), "the multiclass build owes nothing");
    check(/Fighter 3 \/ Rogue 2/.test(summaryText), "the summary names the split");

    // The hero built here seats as it is saved; a confirm sheet, where one
    // opens, is taken. Both waits start before the press.
    const isSeatPost = (response) => response.url().endsWith(`/api/campaigns/${tableId}/sheet`) && response.request().method() === "POST";
    const joined = page.waitForResponse(isSeatPost, { timeout: 45_000 });
    const sheet = page.locator(`${root}[data-join-confirm]`).locator("visible=true").first();
    await t.tap(visible(page, root, /^Join the party$/).first());
    const first = await Promise.race([
      joined.then(() => "seated"),
      sheet.waitFor({ state: "visible", timeout: 45_000 }).then(() => "sheet"),
    ]);
    if (first === "sheet") {
      await eventually(async () => (await sheet.getAttribute("aria-busy")) === "false", { timeoutMs: 20_000, label: "the confirm sheet's check" });
      check((await sheet.locator('[data-join-rules="pass"]').count()) === 1, `the split passes the table's rules (${(await sheet.innerText()).replace(/\s+/g, " ").slice(0, 200)})`);
      await t.tap(sheet.locator("[data-join-take]"));
    }
    check((await joined).status() === 201, "the hero takes the seat");
    const seated = await eventually(() => seatAt(tableId), { timeoutMs: 20_000, label: "the hero is seated" });
    const classes = (seated.classes ?? []).map((entry) => [entry.id, entry.level]);
    check(JSON.stringify(classes) === JSON.stringify([["fighter", 3], ["rogue", 2]]), `the stored sheet holds fighter 3 / rogue 2 (${JSON.stringify(classes)})`);
    check(seated.class === "fighter" && seated.level === 5, `the sheet's class and level are the fighter's and the table's (${seated.class} ${seated.level})`);
    check((seated.hitDicePools ?? []).map((pool) => pool.die).join() === "d10,d8", "a hit die pool for each class");
    check(seated.proficiencies.tools.some((tool) => /thieves' tools/i.test(tool)), "the rogue's thieves' tools are on the sheet");
    check(!seated.proficiencies.saves.includes("dex"), "the rogue adds no saving throw");
    check(seated.proficiencies.skills.includes(skillName.toLowerCase().replace(/\s+/g, "_")), `the rogue's skill is on the sheet (${skillName})`);

    // Give the seat up again.
    const removed = await api.delete(`${base}/api/campaigns/${tableId}/sheet`);
    check(removed.ok(), "the seat is given up again");
    if (seated.libraryCharacterId) await api.delete(`${base}/api/characters/${seated.libraryCharacterId}`);

    // ---- a table that turns multiclassing off ----
    await buildAt(ids.singleClassTableId);
    // The table's rules are read before the step is judged: the fill line is
    // there once they are, and the class section never comes.
    await eventually(() => page.locator(`${active} [data-quick-fill]`).locator("visible=true").count(), { timeoutMs: 10_000, label: "the class step settled" });
    await upTo(async () => (await page.locator(`${active} [data-add-class]`).count()) > 0, 2_000);
    check((await page.locator(`${active} [data-add-class]`).count()) === 0, "a table without multiclassing offers no second class");
    check((await page.locator(`${active} [data-builder-target="multiclass"]`).count()) === 0, "nor the section for one");
  },
};
