// A species whose player picks a package (issue #538), from the Workshop to
// a character, on desktop and phone, on the website and in the app's own
// screens. The two ancestries are this suite's own: Ashen (+1 Constitution,
// resists fire, breathes fire) and Mirrorscale (+1 Wisdom, resists psychic,
// breathes psychic energy in a line against a Wisdom save, knows Insight).
//
//   - made in Homebrew from the keyboard where it can be: the player's
//     choice asked for, its label, its options added by name; with one
//     option the editor says a choice holds two to sixteen and holds the
//     save; each option's grants picked with the kit's own controls; its
//     buttons a finger's size on a phone;
//   - in the character builder a Human offers no such choice and the new
//     species does, with a line saying what each pick gives; switching the
//     pick sets aside the +1 of the player's choice the new pick already
//     covers, and says so; the variant block passes axe;
//   - the finished character holds "Draconic ancestry (Ashen)".
import { axeViolations, check, currentStep, eventually, untilStill, upTo } from "../lib.mjs";

// 39.5: a 40 px box can measure 39.99998 after layout rounding (as
// 92-workshop-targets measures it).
const MIN = 39.5;
async function smallTargets(scope) {
  return scope.evaluate((root, min) => {
    const found = [];
    for (const control of root.querySelectorAll('button, [role="button"], input:not([type="hidden"]), textarea')) {
      const target = control.closest("label") ?? control;
      if (!(target instanceof HTMLElement) || !target.offsetWidth || !target.offsetHeight) continue;
      const reach = getComputedStyle(target, "::after");
      const reached = reach.content !== "none" && reach.position === "absolute";
      const stepper = target.closest(".kit-stepper");
      const width = Math.max(target.offsetWidth, reached ? parseFloat(reach.width) : 0);
      const height = Math.max(stepper instanceof HTMLElement ? stepper.offsetHeight : target.offsetHeight, reached ? parseFloat(reach.height) : 0);
      // A stepper's buttons are the kit's own stepper's width (2.1rem), the
      // size AGENTS.md calls a finger's, as 92-workshop-targets holds them.
      const typed = control.matches("input:not([type=checkbox]):not([type=radio]), textarea");
      const wide = stepper ? 33 : min;
      if (height >= min && (typed || width >= wide)) continue;
      found.push(`${control.getAttribute("aria-label") || control.textContent?.trim().slice(0, 40) || control.tagName} ${Math.round(width)}x${Math.round(height)}`);
    }
    return found;
  }, MIN);
}

const visible = (page, root, text) => page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

export default {
  name: "species-choice",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.viewport}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    // Short, as a species' name is: the footer names it on its Continue.
    const species = `Drakin ${t.viewport[0]}${t.app ? "a" : "w"}${Date.now().toString(36).slice(-3)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Species ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    let entryId = null;
    let characterId = null;
    // Pick from a kit select: its trigger, then the row.
    const pick = async (trigger, row) => {
      await t.tap(trigger);
      const item = page.getByRole("menuitemradio", { name: row }).locator("visible=true").first();
      await eventually(() => item.count(), { timeoutMs: 10_000, label: `the row ${row}` });
      await t.tap(item);
      await upTo(async () => (await page.getByRole("menuitemradio").locator("visible=true").count()) === 0, 2_000);
    };
    try {
      // ---- made in Homebrew ----
      await t.open(`/workshop/${workshopId}?system=homebrew`);
      const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
      await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
      await t.tap(kinds.getByRole("radio", { name: /^Species/ }));
      const fresh = page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first();
      await eventually(() => fresh.isVisible(), { timeoutMs: 10_000, label: "New" });
      await t.tap(fresh);
      const editor = page.getByRole("dialog").last();
      const choose = editor.getByRole("button", { name: /^Let the player choose/ });
      await eventually(() => choose.isVisible(), { timeoutMs: 20_000, label: "the species form, with Let the player choose" });
      await editor.getByLabel("Name", { exact: true }).fill(species);
      // The player's +1 of their choice, which an ancestry's own +1 may cover.
      const picks = editor.locator('input[aria-label="Abilities the player picks"]');
      await picks.fill("1");
      await picks.press("Tab");
      // From the keyboard: the choice asked for, its label, an option added.
      await choose.focus();
      // The control where it lives, at its default: no choice yet.
      await untilStill(page);
      await t.shot("choice-default");
      await page.keyboard.press("Enter");
      const label = editor.getByLabel("What the player chooses");
      await eventually(() => label.isVisible(), { timeoutMs: 10_000, label: "the choice's label field" });
      await label.fill("Draconic ancestry");
      const newName = editor.getByLabel("New option's name");
      const addOption = async (name) => {
        await newName.fill(name);
        await newName.press("Tab");
        await page.keyboard.press("Enter");
        await eventually(() => editor.locator(`[data-species-option="${name.toLowerCase()}"]`).count(), { timeoutMs: 10_000, label: `the option ${name}` });
      };
      await addOption("Ashen");
      // One option is not a choice: the editor says so and holds the save.
      const findings = editor.locator("ul.panel");
      await eventually(async () => /A choice holds 2 to 16 options; this one has 1\./.test(await findings.innerText()), { timeoutMs: 10_000, label: "the one-option refusal" });
      const keep = editor.locator('[data-tour="homebrew-save"]');
      check(await keep.isDisabled(), "Keep it waits for a second option");

      const ashen = editor.locator('[data-species-option="ashen"]');
      await t.tap(ashen.getByRole("button", { name: /Add an increase/ }));
      await pick(ashen.getByRole("button", { name: "Ability", exact: true }), "Constitution");
      await t.tap(ashen.locator("button[aria-pressed]").filter({ hasText: /^fire$/ }));
      await pick(ashen.getByRole("button", { name: "Breath weapon" }), "fire");

      await addOption("Mirrorscale");
      const mirror = editor.locator('[data-species-option="mirrorscale"]');
      await t.tap(mirror.getByRole("button", { name: /Add an increase/ }));
      await pick(mirror.getByRole("button", { name: "Ability", exact: true }), "Wisdom");
      await t.tap(mirror.locator("button[aria-pressed]").filter({ hasText: /^psychic$/ }));
      await t.tap(mirror.locator("button[aria-pressed]").filter({ hasText: /^insight$/ }));
      await pick(mirror.getByRole("button", { name: "Breath weapon" }), "psychic");
      await pick(mirror.getByRole("button", { name: "Save", exact: true }), "Wisdom");
      await pick(mirror.getByRole("button", { name: "Shape" }), "5 by 30 ft. line");

      const preview = editor.locator("[data-species-choice-preview]");
      await eventually(
        async () => /Ashen: \+1 Constitution; resists fire damage; breath weapon: fire, 15 ft\. cone, Dexterity save/.test(await preview.innerText()),
        { timeoutMs: 10_000, label: "what Ashen gives, in the preview" },
      );
      check(/Mirrorscale: \+1 Wisdom; resists psychic damage; breath weapon: psychic, 5 by 30 ft\. line, Wisdom save; proficient in Insight/.test(await preview.innerText()), `what Mirrorscale gives: ${await preview.innerText()}`);
      check(!/A choice holds/.test((await findings.count()) ? await findings.innerText() : ""), "two options are a choice");
      check(await editor.getByRole("button", { name: "Move Ashen up" }).isDisabled(), "the first option cannot move up");
      if (t.touch) {
        const small = await smallTargets(editor.locator("[data-species-choice]"));
        check(!small.length, `the choice's controls are a finger's size: ${small.join("; ")}`);
      }
      await untilStill(page);
      await t.shot("species-made");
      await t.tap(keep);
      const kept = await eventually(
        async () => {
          const body = await (await api.get(`${base}/api/homebrew?kind=race`)).json().catch(() => ({ entries: [] }));
          return (body.entries ?? []).find((entry) => entry.name === species) ?? null;
        },
        { timeoutMs: 15_000, label: "the species on the shelf" },
      );
      entryId = kept.id;
      const ids = (kept.data.variants?.options ?? []).map((option) => option.id);
      check(ids.join() === "ashen,mirrorscale", `the options were kept with their ids (${ids.join(", ")})`);
      for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
        await page.keyboard.press("Escape");
        await upTo(async () => (await page.getByRole("dialog").count()) === 0, 300);
      }

      // ---- chosen in the builder ----
      await t.open("/characters/new");
      const startFresh = visible(page, root, /^Start fresh$/);
      if (await startFresh.count()) await t.tap(startFresh.first());
      const fighter = page.locator(`${root}section[data-active] .creator-card`).filter({ hasText: /^\s*Fighter/ }).locator("visible=true").first();
      await eventually(() => fighter.count(), { timeoutMs: 30_000, label: "the fighter card" });
      await t.tap(fighter);
      // Everything else filled, so every step can be reached and saved.
      const fill = page.locator(`${root}section[data-active] [data-quick-fill]`).locator("visible=true");
      await eventually(() => fill.count(), { timeoutMs: 10_000, label: "Fill what's left" });
      await t.tap(fill.first());
      await eventually(() => page.locator(`${root}[data-quick-readback]`).count(), { timeoutMs: 20_000, label: "the read-back" });
      await t.tap(visible(page, root, /^Keep them$/).first());
      const ancestry = page.locator(`${root}button[aria-label^="Go to step 2:"]`).locator("visible=true");
      await eventually(async () => (await ancestry.count()) && ancestry.first().isEnabled(), { timeoutMs: 15_000, label: "the Ancestry diamond" });
      await t.tap(ancestry.first());
      await eventually(async () => /^Step 2:/.test(await currentStep(page, root)), { timeoutMs: 10_000, label: "the Ancestry step" });

      const step = page.locator(`${root}section[data-active]`);
      const card = (name) => step.locator(".creator-card").filter({ hasText: name }).locator("visible=true").first();
      await eventually(() => card(/^\s*Human/).count(), { timeoutMs: 20_000, label: "the Human card" });
      await t.tap(card(/^\s*Human/));
      await upTo(async () => (await step.locator('[data-builder-target="variant"]').count()) > 0, 1_000);
      check((await step.locator('[data-builder-target="variant"]').count()) === 0, "a Human offers no ancestry to choose");
      // The From Homebrew group folds past its first few: found by name.
      await step.getByRole("searchbox", { name: "Search lineages" }).or(step.locator('input[aria-label="Search lineages"]')).first().fill(species);
      await eventually(() => card(species).count(), { timeoutMs: 20_000, label: "the new species' card" });
      await t.tap(card(species));
      const variant = step.locator('[data-builder-target="variant"]').locator("visible=true").first();
      await eventually(() => variant.count(), { timeoutMs: 10_000, label: "the ancestry picker" });
      check(/Draconic ancestry: it changes what your/.test(await variant.innerText()), "the picker says what it is for");
      await pick(variant.getByRole("button", { name: "Draconic ancestry" }), /^Ashen/);
      const summary = variant.locator("[data-variant-summary]");
      await eventually(async () => /\+1 Constitution/.test(await summary.innerText()), { timeoutMs: 10_000, label: "what Ashen gives" });
      await pick(step.locator('[data-builder-target="racialAsi"]').getByRole("button", { name: "Ability increase 1" }), "Wisdom");
      await pick(variant.getByRole("button", { name: "Draconic ancestry" }), /^Mirrorscale/);
      const notice = page.locator(`${root}.wizard-notice`).locator("visible=true").first();
      await eventually(
        async () => /Changing the draconic ancestry set aside racial ability bump Wisdom/.test(await notice.innerText()),
        { timeoutMs: 10_000, label: "the notice for the +1 Mirrorscale covers" },
      );
      await eventually(async () => /\+1 Wisdom; resists psychic damage/.test(await summary.innerText()), { timeoutMs: 10_000, label: "what Mirrorscale gives" });
      await untilStill(page);
      await t.shot("ancestry-switched");
      const violations = await axeViolations(page, `${root}[data-builder-root] section[data-active] [data-builder-target="variant"]`.trim());
      const serious = violations.filter((violation) => ["serious", "critical"].includes(violation.impact));
      check(!serious.length, `the ancestry picker passes axe: ${serious.map((violation) => violation.id).join(", ")}`);

      // Back to Ashen, the +1 picked again, and the character kept.
      await pick(variant.getByRole("button", { name: "Draconic ancestry" }), /^Ashen/);
      await pick(step.locator('[data-builder-target="racialAsi"]').getByRole("button", { name: "Ability increase 1" }), "Wisdom");
      const saved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/characters" && response.request().method() === "POST", { timeout: 60_000 });
      for (let number = 2; number <= 6; number += 1) {
        const next = page.locator(`${root}button.wizard-continue`).locator("visible=true").first();
        await eventually(
          async () => {
            if (number === 6 && !(await page.locator(`${root}section[data-active] [data-finish-summary]`).count())) return false;
            if (number < 6 && new RegExp(`^Step ${number + 1}:`).test(await currentStep(page, root))) return true;
            if (await next.isEnabled()) await t.tap(next);
            if (number === 6) return true;
            await upTo(async () => new RegExp(`^Step ${number + 1}:`).test(await currentStep(page, root)), 800);
            return new RegExp(`^Step ${number + 1}:`).test(await currentStep(page, root));
          },
          { timeoutMs: 30_000, label: number === 6 ? "the save on the summary" : `Continue from step ${number}` },
        );
      }
      const response = await saved;
      check(response.ok(), `the character was kept (${response.status()})`);
      // The page moves on to the hero's own as the reply lands, so the sheet
      // the server stored is read back from the library.
      const hero = await eventually(
        async () => {
          const body = await (await api.get(`${base}/api/characters`)).json().catch(() => ({ characters: [] }));
          return (body.characters ?? []).find((character) => character.sheet?.race === `homebrew:${entryId}`) ?? null;
        },
        { timeoutMs: 15_000, label: "the character in the library" },
      );
      characterId = hero.id;
      const features = (hero.sheet.features ?? []).map((feature) => feature.name);
      check(features.includes("Draconic ancestry (Ashen)"), `the sheet holds the ancestry: ${features.join(", ")}`);
      check(features.includes("Breath Weapon (fire, 15 ft. cone, DEX save)"), "the sheet holds Ashen's breath");
      check(hero.sheet.racialChoices?.variant === "ashen", "the sheet keeps the pick");
      check((hero.sheet.racialChoices?.asi ?? []).join() === "wis", `the +1 of the player's choice is Wisdom (${(hero.sheet.racialChoices?.asi ?? []).join()})`);
    } finally {
      if (characterId) await api.delete(`${base}/api/characters/${characterId}`).catch(() => {});
      if (entryId) await api.delete(`${base}/api/homebrew/${entryId}?purge=1`).catch(() => {});
      await api.delete(`${base}/api/workshops/${workshopId}`).catch(() => {});
    }
  },
};
