// Audit WA-08 (the Workshop audit of 2026-10-26): on a phone the
// Workshop's editors drew controls a finger could barely hit, among them
// the Homebrew dialog's Close at 24 px, a glossary ⓘ at 14 px, a chip's
// remove at 20 px and the small steppers of a subclass's levels and the
// target party at about 30 px. AGENTS.md asks for 40 px. Every Homebrew
// editor and the encounter editor, opened blank at phone width, and the
// target party bar over them, now offer nothing smaller. A control inside a <label> is measured by its
// label, which takes the tap too.
import { check, eventually, untilStill, upTo } from "../lib.mjs";

const KINDS = ["Items", "Spells", "Feats", "Backgrounds", "Species", "Classes", "Subclasses", "Hazards"];
// 39.5: a 40 px box can measure 39.99998 after layout rounding.
const MIN = 39.5;

// Layout sizes, not the drawn box: a row of chips that pops in is measured
// at its resting size. A stepper is one control, its buttons and figure as
// tall as its frame. A glyph-sized control with a 40 px reach round it
// (.tap-reach, kit.css) is measured by that reach.
async function smallTargets(scope) {
  return scope.evaluate((root, min) => {
    const found = [];
    const seen = new Set();
    const controls = root.querySelectorAll(
      'button, a[href], [role="button"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], [role="combobox"], select, input:not([type="hidden"]), textarea',
    );
    for (const control of controls) {
      const target = control.closest("label") ?? control;
      if (seen.has(target) || !(target instanceof HTMLElement)) continue;
      seen.add(target);
      const style = getComputedStyle(target);
      if (!target.offsetWidth || !target.offsetHeight || style.visibility === "hidden") continue;
      const reach = getComputedStyle(target, "::after");
      const reached = reach.content !== "none" && reach.position === "absolute";
      const stepper = target.closest(".kit-stepper");
      const width = Math.max(target.offsetWidth, reached ? parseFloat(reach.width) : 0);
      const height = Math.max(stepper instanceof HTMLElement ? stepper.offsetHeight : target.offsetHeight, reached ? parseFloat(reach.height) : 0);
      // A text field is tapped along its width; its height is what counts.
      // A stepper's buttons are the kit's own stepper's width (2.1rem), the
      // size AGENTS.md calls a finger's.
      const typed = control.matches("input:not([type=checkbox]):not([type=radio]), textarea");
      const wide = stepper ? 33 : min;
      if (height >= min && (typed || width >= wide)) continue;
      const name = control.getAttribute("aria-label") || control.textContent?.trim().slice(0, 40) || control.tagName;
      found.push(`${name} ${Math.round(width)}x${Math.round(height)} <${target.tagName.toLowerCase()} class="${String(target.className).slice(0, 60)}">`);
    }
    return found;
  }, MIN);
}

export default {
  name: "workshop-targets",
  viewports: ["phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const stamp = `${t.app ? "a" : "w"}${Date.now().toString(36).slice(-4)}`;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Targets ${stamp}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const workshopId = (await made.json()).workshop.id;
    const problems = [];

    await t.open(`/workshop/${workshopId}?system=homebrew`);
    const party = page.locator(`${root}[data-tour="hub-party"]`).locator("visible=true").first();
    await eventually(() => party.isVisible(), { timeoutMs: 30_000, label: "the target party bar" });
    for (const small of await smallTargets(party)) problems.push(`target party: ${small}`);

    const kinds = page.locator(`${root}[data-tour="homebrew-kinds"]`).locator("visible=true").first();
    await eventually(() => kinds.isVisible(), { timeoutMs: 30_000, label: "the kinds of homebrew" });
    for (const kind of KINDS) {
      await t.tap(kinds.getByRole("radio", { name: new RegExp(`^${kind}`) }));
      const fresh = page.locator(`${root}[data-tour="homebrew-new"]`).locator("visible=true").first();
      await eventually(() => fresh.isVisible(), { timeoutMs: 10_000, label: `New (${kind})` });
      await t.tap(fresh);
      const editor = page.getByRole("dialog").last();
      await eventually(() => editor.locator('[data-tour="homebrew-save"]').isVisible(), { timeoutMs: 20_000, label: `the ${kind} form` });
      // Rows whose remove buttons only show once there is a row.
      const add = editor.getByRole("button", { name: /^Add a feature/ });
      if (await add.count()) await t.tap(add.first());
      await untilStill(page);
      for (const small of await smallTargets(editor)) problems.push(`${kind}: ${small}`);
      await t.shot(`editor-${kind.toLowerCase()}`);
      for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt += 1) {
        await page.keyboard.press("Escape");
        // A blank draft with a row added asks before it is thrown away.
        const discard = page.getByRole("button", { name: /^(Discard|Throw it away|Leave)/ });
        if (await discard.count()) await t.tap(discard.first());
        await upTo(async () => (await page.getByRole("dialog").count()) === 0, 600);
      }
    }
    // The encounter editor, the audit's ninth form.
    await t.open(`/workshop/${workshopId}?system=encounters`);
    const fight = page.locator(`${root}[data-tour="encounters-new"]`).locator("visible=true").first();
    await eventually(() => fight.isVisible(), { timeoutMs: 30_000, label: "New encounter" });
    await t.tap(fight);
    const sheet = page.getByRole("dialog").last();
    await eventually(() => sheet.getByRole("textbox", { name: "Roster" }).isVisible(), { timeoutMs: 20_000, label: "the encounter form" });
    await untilStill(page);
    for (const small of await smallTargets(sheet)) problems.push(`encounter: ${small}`);
    await t.shot("editor-encounter");

    check(problems.length === 0, `controls under 40px on a phone:\n  ${problems.join("\n  ")}`);
  },
};
