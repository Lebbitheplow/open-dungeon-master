// Backlog F9, phase 1: a hero made with levels in two classes, through the
// real class step. At a level 5 table the lead picks a fighter, lets the
// quick fill set the rest, opens "Add a second class" (a class the scores
// cannot reach is listed with its reason and refused), adds a rogue, gives
// it two of the five levels and its skill, fills what the rogue's levels
// owe, and takes the seat: the stored sheet holds fighter 3 / rogue 2. A
// table that turns multiclassing off does not let that hero in; once the GM
// turns it off where the hero already sits, an in-place edit keeps the split
// and offers no new class. A hero made at such a table is offered no second
// class, and so is one on an older host (no builderMulticlass flag), which
// would fold the split into one class.
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
    // The seat's own request, and the confirm sheet a built hero may open.
    let isSeatPost = () => false;
    const sheet = page.locator(`${root}[data-join-confirm]`).locator("visible=true").first();
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
    for (const leftAt of [tableId, ids.singleClassTableId]) {
      const left = await seatAt(leftAt);
      if (left) {
        await api.delete(`${base}/api/campaigns/${leftAt}/sheet`);
        if (left.libraryCharacterId) await api.delete(`${base}/api/characters/${left.libraryCharacterId}`);
      }
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
    isSeatPost = (response) => response.url().endsWith(`/api/campaigns/${tableId}/sheet`) && response.request().method() === "POST";
    const joined = page.waitForResponse(isSeatPost, { timeout: 45_000 });
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

    // The seated hero goes back to the lobby; nothing opens over that.
    await eventually(async () => !/\/character/.test((await t.url()).pathname), { timeoutMs: 20_000, label: "back to the lobby" });
    // The same hero, now in the library, offered at the table that turns
    // multiclassing off: refused there, as the rules make multiclassing the
    // table's choice, and the confirm sheet says so and takes no seat.
    if (seated.libraryCharacterId) {
      await t.open(`/campaigns/${ids.singleClassTableId}/character`);
      const offChooser = page.locator(`${root}[data-hero-chooser]`).locator("visible=true").first();
      await eventually(() => offChooser.count(), { timeoutMs: 30_000, label: "the hero chooser at the single-class table" });
      await t.tap(offChooser.locator(`[data-hero-pick="${seated.libraryCharacterId}"]`));
      await eventually(async () => (await sheet.count()) && (await sheet.getAttribute("aria-busy")) === "false", { timeoutMs: 20_000, label: "the split hero's check there" });
      const refused = sheet.locator('[data-join-rules="fail"]');
      check((await refused.count()) === 1, "the split hero is not let in at the single-class table");
      check(/turns multiclassing off\. Bring a character with one class, or build one here\./.test(await refused.innerText()), `the confirm sheet says why (${await refused.innerText()})`);
      check(await sheet.locator("[data-join-take]").isDisabled(), "and offers no seat");
      await review("join-refused-single-class-table");
      await page.keyboard.press("Escape");
      await eventually(async () => (await sheet.count()) === 0 || !(await sheet.isVisible()), { timeoutMs: 10_000, label: "the confirm sheet closing" });

      // The GM turns multiclassing off at the table the hero already sits
      // at: the hero keeps the classes it holds (the setting's promise), and
      // an edit in place shows the split with no class to add and no
      // warning, and saving keeps fighter 3 / rogue 2 (PUT shape 2).
      const offId = tableId;
      const switched = await api.patch(`${base}/api/campaigns/${offId}/settings`, { data: { multiclassingEnabled: false } });
      check(switched.ok(), `the GM turns multiclassing off (${switched.status()})`);
      await t.open(`/campaigns/${offId}/character?mode=edit`);
      // The edit opens on its summary, every step done: nothing the stored
      // split holds is said to be off offer (the rogue's skill was, when the
      // build read the stored skills out of order, and a pack species' own
      // tongue was, when it was read against the bundled rows).
      const editSummary = page.locator(`${active} [data-finish-summary]`).locator("visible=true");
      await eventually(() => editSummary.count(), { timeoutMs: 30_000, label: "the edit's summary" });
      await upTo(() => page.getByText(/no longer on offer/).locator("visible=true").count(), 1_500);
      const offOffer = await page.getByText(/no longer on offer/).locator("visible=true").allInnerTexts();
      check(offOffer.length === 0, `the stored split opens with nothing off offer (${offOffer.join(" ")})`);
      check(/Every step is complete/.test((await page.locator(active).first().textContent()) ?? ""), "the stored split owes nothing");
      await t.tap(page.locator(`${active} [data-summary-edit="calling"]`).locator("visible=true").first());
      const kept = page.locator(`${active} [data-builder-target="multiclass"]`).locator("visible=true").first();
      await eventually(() => kept.count(), { timeoutMs: 30_000, label: "the held split in the edit" });
      await eventually(async () => /Fighter 3 \/ Rogue 2/.test(await kept.textContent()), { timeoutMs: 10_000, label: "the split named in the edit" });
      check((await kept.locator("[data-add-class]").count()) === 0, "the edit offers no new class once multiclassing is off");
      check(!/Remove the classes below/.test(await kept.textContent()), "the held split is not warned off");
      await kept.scrollIntoViewIfNeeded();
      await review("edit-held-split-single-class-table");
      for (let step = 1; step < 6; step += 1) {
        const next = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
        await eventually(
          async () => {
            if (new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root))) return true;
            if (await next.isEnabled()) await t.tap(next);
            await upTo(async () => new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root)), 800);
            return new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root));
          },
          { timeoutMs: 20_000, label: `Continue from step ${step} (the edit)` },
        );
      }
      await eventually(() => page.locator(`${active} [data-finish-summary]`).locator("visible=true").count(), { timeoutMs: 10_000, label: "the edit's summary" });
      const saved = page.waitForResponse(
        (response) => response.url().endsWith(`/api/campaigns/${offId}/sheet`) && response.request().method() === "PUT",
        { timeout: 45_000 },
      );
      await t.tap(visible(page, root, /^Save changes$/).first());
      const savedStatus = (await saved).status();
      check(savedStatus < 400, `the edit is saved (${savedStatus} ${await page.locator(`${root}[role="alert"]`).allInnerTexts().catch(() => [])})`);
      const edited = await eventually(() => seatAt(offId), { timeoutMs: 20_000, label: "the edited seat" });
      const editedClasses = (edited.classes ?? []).map((entry) => [entry.id, entry.level]);
      check(JSON.stringify(editedClasses) === JSON.stringify([["fighter", 3], ["rogue", 2]]), `the edit keeps fighter 3 / rogue 2 (${JSON.stringify(editedClasses)})`);
      await eventually(async () => !/\/character/.test((await t.url()).pathname), { timeoutMs: 20_000, label: "back to the lobby after the edit" });
      const restored = await api.patch(`${base}/api/campaigns/${offId}/settings`, { data: { multiclassingEnabled: true } });
      check(restored.ok(), "multiclassing is turned on again for the casters below");
    }
    // Give the seat up again.
    const removed = await api.delete(`${base}/api/campaigns/${tableId}/sheet`);
    check(removed.ok(), "the seat is given up again");
    if (seated.libraryCharacterId) await api.delete(`${base}/api/characters/${seated.libraryCharacterId}`);

    // ---- two casting classes: a cleric 3 / wizard 2 (phase 2) ----
    // The cleric's scores come from a kept draft (the standard array with
    // Intelligence 13, so a wizard may be added), resumed as a player would.
    await t.open(`/campaigns/${tableId}/character`);
    await page.evaluate((key) => {
      const fields = {
        name: "Maren Twofold",
        alignment: "N",
        level: 5,
        classId: "cleric",
        subclass: "",
        method: "standard",
        scores: { str: 10, dex: 12, con: 14, int: 13, wis: 15, cha: 8 },
      };
      window.localStorage.setItem(key, JSON.stringify({ v: 2, savedAt: Date.now(), step: "calling", fields }));
    }, `odm:builder-draft:table:${tableId}`);
    const chooser = page.locator(`${root}[data-hero-chooser]`).locator("visible=true").first();
    await eventually(() => chooser.count(), { timeoutMs: 30_000, label: "the hero chooser for the cleric" });
    await t.tap(chooser.locator('[data-chooser-section="build"]'));
    const resume = visible(page, root, /^Resume$/);
    await eventually(() => resume.count(), { timeoutMs: 15_000, label: "the kept cleric draft" });
    await t.tap(resume.first());
    const clericCard = page.locator(`${active} .creator-card[aria-label^="Cleric"]`).locator("visible=true").first();
    await eventually(async () => (await clericCard.getAttribute("aria-pressed")) === "true", { timeoutMs: 15_000, label: "the cleric picked again" });
    await t.tap(page.locator(`${active} [data-add-class]`).locator("visible=true").first());
    const wizardChoice = page.locator(`${active} ul[aria-label^="Classes you could add"] button[data-roving-item="wizard"]`).locator("visible=true").first();
    await eventually(() => wizardChoice.count(), { timeoutMs: 5_000, label: "the wizard in the list" });
    check((await wizardChoice.getAttribute("aria-disabled")) === null, "a wizard may be added beside a cleric (phase 2)");
    await t.tap(wizardChoice);
    const wizardCard = page.locator(`${active} [data-extra-class="wizard"]`).locator("visible=true").first();
    await eventually(() => wizardCard.count(), { timeoutMs: 5_000, label: "the wizard's card" });
    await t.tap(wizardCard.locator('button[aria-label="Wizard levels"]'));
    const twoLevels = page.getByRole("menuitemradio", { name: "2", exact: true }).locator("visible=true").first();
    await eventually(() => twoLevels.count(), { timeoutMs: 5_000, label: "the wizard's level list" });
    await t.tap(twoLevels);
    await eventually(async () => /Cleric 3 \/ Wizard 2/.test(await section.textContent()), { timeoutMs: 5_000, label: "the split at cleric 3 / wizard 2" });
    // A wizard picks its school at its 2nd level.
    await t.tap(wizardCard.locator('button[aria-haspopup="listbox"]').first());
    const school = page.locator(`${root}[role="option"]`).filter({ hasText: /^School of Evocation/ }).locator("visible=true").first();
    await eventually(() => school.count(), { timeoutMs: 5_000, label: "the wizard's schools" });
    await t.tap(school);
    // The fill sets the rest at the split's own levels, so the cleric's
    // counts are a cleric 3's.
    await fillRest("the cleric / wizard");
    for (let step = 1; step < 4; step += 1) {
      const next = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
      await eventually(
        async () => {
          if (new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root))) return true;
          if (await next.isEnabled()) await t.tap(next);
          await upTo(async () => new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root)), 800);
          return new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root));
        },
        { timeoutMs: 20_000, label: `Continue from step ${step} (cleric / wizard)` },
      );
    }
    // The fill wrote each casting class's own lists: the spell step owes
    // nothing.
    await upTo(() => page.locator(`${active} [data-quick-fill]`).locator("visible=true").count(), 1_500);
    check((await page.locator(`${active} [data-quick-fill]`).locator("visible=true").count()) === 0, "the fill left no spell owed in either class");
    // The spell step: a tab for each casting class, each its own panel.
    const tablist = page.locator(`${active} [role="tablist"][aria-label="Spells by class"]`).locator("visible=true").first();
    await eventually(() => tablist.count(), { timeoutMs: 10_000, label: "the casting classes' tabs" });
    const tabNames = await tablist.locator('[role="tab"]').allInnerTexts();
    check(JSON.stringify(tabNames.map((name) => name.trim())) === JSON.stringify(["Cleric 3", "Wizard 2"]), `a tab per casting class (${tabNames})`);
    const clericTab = tablist.locator('[data-caster-tab="cleric"]');
    const wizardTab = tablist.locator('[data-caster-tab="wizard"]');
    check((await clericTab.getAttribute("aria-selected")) === "true", "the first casting class's tab is open");
    const panelOf = async (tab) => page.locator(`#${await tab.getAttribute("aria-controls")}`);
    check(await (await panelOf(clericTab)).isVisible(), "the cleric's panel shows");
    check(!(await (await panelOf(wizardTab)).isVisible()), "the wizard's panel waits behind its tab");
    await tablist.scrollIntoViewIfNeeded();
    await review("spell-step-cleric");
    // The arrows move between the tabs, one tab stop (F16).
    await clericTab.focus();
    await page.keyboard.press("ArrowRight");
    check(await wizardTab.evaluate((node) => node === document.activeElement), "the arrow moves to the wizard's tab");
    await page.keyboard.press("Enter");
    await eventually(async () => (await wizardTab.getAttribute("aria-selected")) === "true", { timeoutMs: 5_000, label: "the wizard's tab open" });
    const wizardPanel = await panelOf(wizardTab);
    check(await wizardPanel.isVisible(), "the wizard's panel shows");
    check(/spellbook/i.test(await wizardPanel.innerText()), "the wizard's panel holds its spellbook");
    await tablist.scrollIntoViewIfNeeded();
    await review("spell-step-wizard");
    for (let step = 4; step < 6; step += 1) {
      const next = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
      await eventually(
        async () => {
          if (new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root))) return true;
          if (await next.isEnabled()) await t.tap(next);
          await upTo(async () => new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root)), 800);
          return new RegExp(`^Step ${step + 1}:`).test(await currentStep(page, root));
        },
        { timeoutMs: 20_000, label: `Continue from step ${step} (cleric / wizard)` },
      );
    }
    await eventually(() => summary.count(), { timeoutMs: 10_000, label: "the cleric / wizard summary" });
    check(/Every step is complete/.test((await page.locator(active).first().textContent()) ?? ""), "the cleric / wizard owes nothing");
    const twoJoined = page.waitForResponse(isSeatPost, { timeout: 45_000 });
    await t.tap(visible(page, root, /^Join the party$/).first());
    const twoFirst = await Promise.race([
      twoJoined.then(() => "seated"),
      sheet.waitFor({ state: "visible", timeout: 45_000 }).then(() => "sheet"),
    ]);
    if (twoFirst === "sheet") {
      await eventually(async () => (await sheet.getAttribute("aria-busy")) === "false", { timeoutMs: 20_000, label: "the cleric / wizard check" });
      await t.tap(sheet.locator("[data-join-take]"));
    }
    check((await twoJoined).status() === 201, "the cleric / wizard takes the seat");
    const caster = await eventually(() => seatAt(tableId), { timeoutMs: 20_000, label: "the cleric / wizard seated" });
    check(
      JSON.stringify((caster.classes ?? []).map((entry) => [entry.id, entry.level])) === JSON.stringify([["cleric", 3], ["wizard", 2]]),
      `the stored sheet holds cleric 3 / wizard 2 (${JSON.stringify(caster.classes)})`,
    );
    const casters = caster.spellcasting?.casters ?? [];
    check(JSON.stringify(casters.map((entry) => [entry.classId, entry.ability])) === JSON.stringify([["cleric", "wis"], ["wizard", "int"]]), `a casters entry per class (${JSON.stringify(casters.map((entry) => entry.classId))})`);
    const wizardLists = casters.find((entry) => entry.classId === "wizard");
    check((wizardLists?.spellbook ?? []).length === 8, `the wizard's book holds eight (${(wizardLists?.spellbook ?? []).length})`);
    check((wizardLists?.cantrips ?? []).length === 3, `the wizard knows three cantrips (${(wizardLists?.cantrips ?? []).length})`);
    check((casters.find((entry) => entry.classId === "cleric")?.prepared ?? []).length >= 5, "the cleric has its prepared spells");
    check(caster.spellcasting.slots?.[3]?.max === 2, `the shared table at caster level 5 (${JSON.stringify(caster.spellcasting.slots)})`);
    await eventually(async () => !/\/character/.test((await t.url()).pathname), { timeoutMs: 20_000, label: "back to the lobby after the cleric" });
    await api.delete(`${base}/api/campaigns/${tableId}/sheet`);
    if (caster.libraryCharacterId) await api.delete(`${base}/api/characters/${caster.libraryCharacterId}`);

    // ---- a table that turns multiclassing off ----
    await buildAt(ids.singleClassTableId);
    // The table's rules are read before the step is judged: the fill line is
    // there once they are, and the class section never comes.
    await eventually(() => page.locator(`${active} [data-quick-fill]`).locator("visible=true").count(), { timeoutMs: 10_000, label: "the class step settled" });
    await upTo(async () => (await page.locator(`${active} [data-add-class]`).count()) > 0, 2_000);
    check((await page.locator(`${active} [data-add-class]`).count()) === 0, "a table without multiclassing offers no second class");
    check((await page.locator(`${active} [data-builder-target="multiclass"]`).count()) === 0, "nor the section for one");

    // ---- an older host, which folds a new split into one class ----
    // The app caches the capabilities answer, so only the website is asked.
    if (t.app) return;
    await page.route("**/api/capabilities**", async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      delete body.features;
      await route.fulfill({ response, json: body });
    });
    await buildAt(tableId);
    await eventually(() => page.locator(`${active} [data-quick-fill]`).locator("visible=true").count(), { timeoutMs: 10_000, label: "the class step on an older host" });
    await upTo(async () => (await page.locator(`${active} [data-add-class]`).count()) > 0, 2_000);
    check((await page.locator(`${active} [data-add-class]`).count()) === 0, "an older host's builder offers no second class");
  },
};
