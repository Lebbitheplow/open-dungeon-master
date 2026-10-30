// The gender is asked on the class step, above the cards whose art follows
// it (scripts/test-builder-gender-first.mjs). A new hero starts with it
// unchosen and the cards in a mix of looks; choosing one turns every class
// card to it at once, and the ancestry cards after them. The Hero step says
// it and goes back to the class step to change it. The library's pages are
// native screens in the app too.
import { axeViolations, check, currentStep, eventually, untilStill } from "../lib.mjs";

const visible = (page, root, text) =>
  page.locator(`${root}button`).filter({ hasText: text }).locator("visible=true");

// The look each visible card on the step shows, read off its plate's file:
// "wizard-feminine.webp", or "feminine.webp" for the plain adventurer a
// pack class nobody painted falls back to.
const cardLooks = (page, root) =>
  page
    .locator(`${root}section[data-active] .creator-card .creator-plate > img`)
    .evaluateAll((images) =>
      images.filter((image) => image.offsetParent).map((image) => /[/-](feminine|masculine|neutral)\.webp/.exec(image.getAttribute("src") ?? "")?.[1] ?? "other"),
    );

// The field at the top of the view, the cards it changes under it.
const showWithCards = (locator) => locator.evaluate((element) => element.scrollIntoView({ block: "start" }));

// The plates load lazily: a shot waits until the first rows have painted.
const platesPainted = (page, root) =>
  eventually(
    () =>
      page.locator(`${root}section[data-active] .creator-card .creator-plate > img`).evaluateAll((images) =>
        images
          .filter((image) => image.offsetParent)
          .slice(0, 8)
          .every((image) => {
            image.loading = "eager";
            return image.complete && image.naturalWidth > 0;
          }),
      ),
    { label: "the first cards painted" },
  );

// A phone holds the field or a row of cards, not both, so a phone shot
// given the field is taken on a taller screen, the field at its top.
async function shot(t, page, name, from) {
  const size = page.viewportSize();
  if (!from || !t.touch || !size) return t.shot(name);
  await page.setViewportSize({ width: size.width, height: 1500 });
  await showWithCards(from);
  await platesPainted(page, t.root);
  await untilStill(page);
  await t.shot(name);
  await page.setViewportSize(size);
  await showWithCards(from);
}

async function bothThemes(t, page, name, from) {
  await platesPainted(page, t.root);
  await untilStill(page);
  await shot(t, page, `${name}-night`, from);
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await untilStill(page);
  await shot(t, page, `${name}-day`, from);
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await untilStill(page);
}

// Every card in one look, or a failure that says what each showed.
async function allIn(page, root, want, label) {
  try {
    await eventually(async () => {
      const looks = await cardLooks(page, root);
      return looks.length > 0 && looks.every((look) => look === want);
    }, { timeoutMs: 15_000, label });
  } catch {
    check(false, `${label}: ${(await cardLooks(page, root)).join(", ")}`);
  }
}

async function choose(t, field, gender) {
  const { page } = t;
  await t.tap(field.getByRole("button", { name: "Gender" }));
  const row = page.getByRole("menuitemradio", { name: gender, exact: true }).locator("visible=true").first();
  await row.waitFor({ state: "visible", timeout: 10_000 });
  await t.tap(row);
  await eventually(async () => (await field.innerText()).includes(gender), { label: `${gender} chosen` });
}

export default {
  name: "builder-gender",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;
    await t.open("/characters/new");
    // A draft an earlier viewport left is not this one's.
    const fresh = visible(page, root, /^Start fresh$/);
    if (await fresh.count()) {
      await t.tap(fresh.first());
    }
    const field = page.locator(`${root}section[data-active] [data-builder-target="gender"]`).locator("visible=true").first();
    await field.waitFor({ state: "visible", timeout: 30_000 });
    check(/^Step 1:/.test(await currentStep(page, root)), "the gender is on the first step");
    check((await field.innerText()).includes("Not chosen"), "it starts unchosen");
    const trigger = field.getByRole("button", { name: "Gender" });
    const box = await trigger.boundingBox();
    check(box && box.height >= 40, `a finger-sized select (${box?.height})`);
    const found = await axeViolations(page, `${root}section[data-active] [data-builder-target="gender"]`);
    check(!found.length, `axe on the gender field: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);

    // Unchosen: a mix of looks, the same one after a reload.
    await eventually(async () => (await cardLooks(page, root)).length >= 6, { timeoutMs: 30_000, label: "the class cards" });
    const mixed = await cardLooks(page, root);
    for (const look of ["feminine", "masculine", "neutral"]) {
      check(mixed.includes(look), `the unchosen grid shows a ${look} card (${mixed.join(", ")})`);
    }
    await showWithCards(field);
    await bothThemes(t, page, "unset", field);

    // Chosen: every card follows at once.
    await choose(t, field, "Female");
    await allIn(page, root, "feminine", "every class card feminine");
    await showWithCards(field);
    await bothThemes(t, page, "female", field);
    await choose(t, field, "Male");
    await allIn(page, root, "masculine", "every class card masculine");
    await showWithCards(field);
    await bothThemes(t, page, "male", field);

    // And the ancestry cards after them.
    const barbarian = page.locator(`${root}section[data-active] .creator-card[aria-label^="Barbarian"]`).locator("visible=true").first();
    await t.tap(barbarian);
    await t.tap(page.locator(`${root}section[data-active] [data-suggest-skills]`).locator("visible=true").first());
    await t.tap(visible(page, root, /^Continue/).first());
    await eventually(async () => /^Step 2:/.test(await currentStep(page, root)), { label: "the Ancestry step" });
    await allIn(page, root, "masculine", "every lineage card masculine");
    await page.locator(`${root}section[data-active] .creator-card`).locator("visible=true").first().evaluate((element) => element.scrollIntoView({ block: "center" }));
    await bothThemes(t, page, "ancestry-male");
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) if (key.startsWith("odm:builder-draft:")) window.localStorage.removeItem(key);
    });

    // A stored build's Hero step says the gender and goes back to the class
    // step to change it.
    await t.open(`/characters/${ids.library}/edit`);
    const ahead = page.locator(`${root}button[aria-label^="Back to step 5"], ${root}button[aria-label^="Go to step 5"]`).locator("visible=true");
    await eventually(async () => (await ahead.count()) && ahead.first().isEnabled(), { timeoutMs: 30_000, label: "the step 5 diamond" });
    await t.tap(ahead.first());
    await eventually(async () => /^Step 5:/.test(await currentStep(page, root)), { label: "the Hero step" });
    const back = visible(page, root, /^Change on the Class step$/).first();
    await back.waitFor({ state: "visible", timeout: 15_000 });
    await back.scrollIntoViewIfNeeded();
    await t.shot("hero-step");
    await t.tap(back);
    await eventually(async () => /^Step 1:/.test(await currentStep(page, root)), { label: "back on the class step" });
    await eventually(
      () => page.evaluate(() => Boolean(document.activeElement?.closest('[data-builder-target="gender"]'))),
      { label: "the gender select focused" },
    );
  },
};
