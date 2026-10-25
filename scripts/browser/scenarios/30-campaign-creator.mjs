// The guided campaign creator (docs/campaign-creator-guided-setup-plan.md):
// three steps, a held Continue that says why, groups that keep what was
// typed while closed, a line or veil saved the moment it is typed, the
// review's Edit and its way back, personal defaults saved only on request
// and used by the next campaign, and the campaign itself created with what
// the draft held.
import { check, eventually, untilStill } from "../lib.mjs";

export default {
  name: "campaign-creator",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, api, base, viewport } = t;
    // Viewports share one seeded world: start each with nothing saved.
    await api.delete(`${base}/api/profile/campaign-defaults`);
    const title = `Creator Keep (${viewport})`;

    const openCreator = async () => {
      await t.open("/");
      const tile = page.locator(`${root}[data-tour="tile-new-campaign"], [data-tour="tile-new-campaign"]`).locator("visible=true").first();
      await eventually(() => tile.count(), { timeoutMs: 30_000, label: "the New campaign tile" });
      await t.tap(tile);
      const dialog = page.getByRole("dialog").filter({ has: page.locator(".cc-shell, .wizard-continue") }).first();
      await eventually(() => dialog.locator("button.wizard-continue").count(), { timeoutMs: 30_000, label: "the creator" });
      return dialog;
    };
    const textOf = async (locator) => ((await locator.textContent()) ?? "").replace(/\s+/g, " ");

    let dialog = await openCreator();
    check((await dialog.locator(".diamond-button").count()) === 3, "three steps: essentials, experience, review");
    await eventually(async () => /Starting from the app's defaults/.test(await textOf(dialog)), { label: "the starting point says app defaults" });

    // Continue is held until the campaign has a name, and says so.
    const next = dialog.locator("button.wizard-continue");
    // Held with aria-disabled so the press still lands and says why; the
    // driver will not press a held button on its own.
    await next.click({ force: true });
    await eventually(async () => /Name the campaign first/.test(await textOf(dialog)), { label: "the held Continue's reason" });
    const name = dialog.locator('input[maxlength="80"]');
    await eventually(() => name.evaluate((el) => el === document.activeElement), { label: "focus back on the title" });
    await name.fill(title);
    // The step's entrance has finished before the picture.
    await untilStill(page);
    await t.shot("essentials");

    // A closed group keeps what was typed in it.
    const prep = dialog.locator('[data-group="prep"] .cc-group-toggle');
    await prep.scrollIntoViewIfNeeded();
    await t.tap(prep);
    const rules = dialog.getByPlaceholder(/Your table's rulings/);
    await eventually(() => rules.isVisible(), { label: "house rules inside the prep group" });
    await rules.fill("Potions:\nDrinking one is a bonus action.");
    await t.tap(prep);
    await eventually(async () => !(await rules.isVisible()), { label: "the group closed" });
    await t.tap(prep);
    check((await rules.inputValue()).includes("bonus action"), "house rules survive closing their group");
    check(/house rules written/.test(await textOf(dialog.locator('[data-group="prep"] .cc-group-summary'))), "the closed group says house rules are written");

    // The experience: narration and who voices the characters, side by side.
    await t.tap(next);
    await eventually(async () => /Narration and character voices/.test(await textOf(dialog.locator("section[data-active]"))), { label: "the experience step" });
    const experience = dialog.locator("section[data-active]");
    // A server with a speech service offers the casting choice; one without
    // (CI) keeps narration off and says why, with the choices kept aside.
    const caps = await (await api.get(`${base}/api/capabilities`)).json().catch(() => null);
    const speech = caps?.tts?.configured !== false;
    if (speech) {
      const narrator = experience.getByRole("button", { name: /The narrator reads them/ });
      const eachVoice = experience.getByRole("button", { name: /Each speaker gets a voice/ });
      check((await narrator.getAttribute("aria-pressed")) === "true", "the narrator reads the characters unless asked otherwise");
      await t.tap(eachVoice);
      await eventually(async () => (await eachVoice.getAttribute("aria-pressed")) === "true", { label: "each speaker gets a voice" });
      check(/Character voices/.test(await textOf(experience)), "the casting choice names where voices are changed later");
    } else {
      check(/no speech service/.test(await textOf(experience)), "a server with no speech says why nothing is read aloud");
    }
    // The step's entrance has finished before the picture.
    await untilStill(page);
    await t.shot("experience");

    // A line typed and left at once (the diamond to the review) is kept.
    const safety = experience.locator('[data-group="safety"] .cc-group-toggle');
    await safety.scrollIntoViewIfNeeded();
    await t.tap(safety);
    const lines = experience.getByPlaceholder("spiders, harm to children");
    await eventually(() => lines.isVisible(), { label: "the lines field" });
    await lines.fill("spiders");
    await t.tap(dialog.locator('button[aria-label^="Go to step 3"]'));
    const review = dialog.locator("section[data-active]");
    await eventually(async () => /Here is what you made/.test(await textOf(review)), { label: "the review" });
    await eventually(async () => /1 line/.test(await textOf(review.locator(".cc-readback"))), { label: "the review counts the line just typed" });
    check(
      /each speaker gets a voice|no speech service/.test(await textOf(review.locator(".cc-readback"))),
      "the review reads back the casting choice, or why there is none",
    );
    // The step's entrance has finished before the picture.
    await untilStill(page);
    await t.shot("review");

    // Edit from the review, and straight back.
    await t.tap(review.getByRole("button", { name: "Edit safety" }));
    await eventually(() => dialog.getByRole("button", { name: "Back to review" }).locator("visible=true").count(), { label: "the way back to the review" });
    check((await dialog.locator('section[data-active] [data-group="safety"] .cc-group-toggle').getAttribute("aria-expanded")) === "true", "Edit opened the safety group");
    await t.tap(dialog.getByRole("button", { name: "Back to review" }).locator("visible=true").first());
    await eventually(async () => /Here is what you made/.test(await textOf(dialog.locator("section[data-active]"))), { label: "back on the review" });

    // Saving defaults is its own press, and saves only table settings.
    await t.tap(dialog.getByRole("button", { name: "Save as my defaults" }));
    await eventually(async () => /Saved\./.test(await textOf(dialog)), { label: "the save's confirmation" });
    const saved = await (await api.get(`${base}/api/profile/campaign-defaults`)).json();
    check(saved.defaults?.settings?.safety?.lines?.[0] === "spiders", "the saved defaults hold the line");
    check(/bonus action/.test(saved.defaults?.settings?.houseRules ?? ""), "the saved defaults hold the house rules");
    check(!("title" in (saved.defaults?.settings ?? {})), "the title is never saved");

    // Create: the campaign carries what the draft held.
    await t.tap(dialog.locator("button.wizard-continue"));
    let made = null;
    await eventually(async () => {
      const list = await (await api.get(`${base}/api/campaigns`)).json();
      made = (list.campaigns ?? []).find((entry) => entry.title === title) ?? null;
      return Boolean(made);
    }, { timeoutMs: 30_000, label: "the campaign created" });
    const campaign = (await (await api.get(`${base}/api/campaigns/${made.id}`)).json()).campaign;
    check(campaign?.gameSettings?.safety?.lines?.[0] === "spiders", "the campaign's safety lines");
    if (speech) {
      check(campaign?.gameSettings?.ttsAutoCast === true, "the campaign casts each speaker");
    }
    await eventually(async () => {
      const posted = await (await api.get(`${base}/api/campaigns/${made.id}/rules`)).json();
      return /bonus action/.test(posted.text ?? "");
    }, { label: "the house rules posted after the row" });

    // The next campaign starts from the saved defaults, and the app's are one
    // press away.
    // Create lands on the new table once its prep is in; the home is opened after.
    await eventually(async () => (await t.url()).pathname.includes(made.id), { timeoutMs: 30_000, label: "the new table open" });
    dialog = await openCreator();
    await eventually(async () => /Starting from your saved defaults/.test(await textOf(dialog)), { label: "the next creator starts from the defaults" });
    const safetySummary = dialog.locator('[data-group="safety"] .cc-group-summary');
    check(/1 line/.test(await textOf(safetySummary)), "the saved line is in the new draft");
    await t.tap(dialog.getByRole("radio", { name: "App defaults" }));
    await eventually(async () => /no lines or veils/.test(await textOf(safetySummary)), { label: "app defaults put the line away" });
    // The step's entrance has finished before the picture.
    await untilStill(page);
    await t.shot("app-defaults");

    await api.delete(`${base}/api/profile/campaign-defaults`);
  },
};
