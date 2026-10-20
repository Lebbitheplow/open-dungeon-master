// Issue #430, where a player meets it: an imported character file from
// before its picks were asked for says what is still to choose, with a way
// to choose it now or later. The import's answer is the server's own words,
// mocked here for the notice; scripts/test-import-older-files.mjs holds the
// server to them.
import { check, eventually } from "../lib.mjs";

export default {
  name: "import-owed",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids } = t;

    await t.open("/characters");
    // A real library character as the import's answer, so the list renders
    // it as it would a new one; only the owed picks are the older file's.
    const listed = await (await t.api.get(`${t.base}/api/characters`)).json();
    const real = (listed.characters ?? listed).find((entry) => entry.id === ids.library);
    check(Boolean(real), "the library character to answer with");
    await page.route(/\/api\/characters\/import$/, (route) =>
      route.fulfill({
        status: 201,
        json: { character: { ...real, id: `${real.id}-copy`, name: "Old File Hero" }, owed: ["Linguist: pick 3 languages."] },
      }),
    );
    const input = page.locator(`${root}input[type="file"]`).first();
    await input.setInputFiles({
      name: "old-file-hero.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ kind: "odm.character", version: 1, name: "Old File Hero" })),
    });
    const notice = page.getByText(/came from a file made before these choices were asked for/).first();
    await eventually(() => notice.count(), { label: "the picks-owed notice" });
    const choose = page.locator(`${root}a`).filter({ hasText: /^\s*Choose them now\s*$/ }).locator("visible=true").first();
    check((await choose.getAttribute("href"))?.endsWith(`/characters/${ids.library}-copy/edit`), "Choose them now opens the builder on that character");
    const later = page.locator(`${root}button`).filter({ hasText: /^\s*Later\s*$/ }).locator("visible=true").first();
    for (const [name, control] of [["Choose them now", choose], ["Later", later]]) {
      const size = await control.boundingBox();
      check(size && size.height >= 40, `${name} is a 40px target (${size?.height}px)`);
    }
    check(/Linguist: pick 3 languages\./.test((await page.locator("body").textContent()) ?? ""), "the notice lists what is owed");
    await t.shot("import-owed");
    await t.tap(later);
    await eventually(async () => (await notice.count()) === 0, { label: "Later puts the notice away" });
    await page.unroute(/\/api\/characters\/import$/);
  },
};
