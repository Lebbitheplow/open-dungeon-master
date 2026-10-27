// Audit WA-09 and WA-10 (the Workshop audit of 2026-10-26), on
// desktop and phone:
//
//   - WorldForge with no entries is no listbox: its empty state holds the
//     buttons to make a first entry, and axe found a listbox holding no
//     options (aria-required-children). The empty wiki passes axe now, and
//     the list is a listbox again once it has a row.
//   - Shops had no way in: the Market sits under Lore's entries. Create
//     offers a Shop, which opens Lore with the Market's form ready, and the
//     command palette's New shop does the same. A shop whose opening is lost
//     on the connection says so and keeps its name (WA-05).
import { axeViolations, check, eventually } from "../lib.mjs";

export default {
  name: "workshop-discovery",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, base, root, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Discovery ${Date.now().toString(36)}`, description: "" } });
    check(made.ok(), "a workshop for the check");
    const id = (await made.json()).workshop.id;
    await api.post(`${base}/api/profile/tours`, { data: { finished: ["hub", "world", "lore"].map((tool) => ({ id: `workshop-${tool}`, version: 2, how: "ended" })) } });
    const params = async () => (await t.url()).searchParams;
    const shopName = () => page.getByRole("textbox", { name: "Shop name" }).locator("visible=true").first();

    // ---- the empty wiki ----
    await t.open(`/workshop/${id}?system=world`);
    const empty = page.locator(`${root}[data-testid="world-empty-create"]`).locator("visible=true").first();
    await eventually(() => empty.isVisible(), { timeoutMs: 30_000, label: "the empty wiki" });
    const scoped = await empty.evaluate((node) => {
      // The entries box that holds the empty state; axe runs over it.
      let box = node.parentElement;
      while (box && !String(box.className).includes("max-h-[60vh]")) box = box.parentElement;
      if (!box) return { found: false, role: null };
      box.setAttribute("data-axe-scope", "empty-entries");
      return { found: true, role: box.getAttribute("role") };
    });
    check(scoped.found, "the entries box around the empty state");
    check(scoped.role === null, `the empty entries box claims no role (${scoped.role})`);
    const violations = await axeViolations(page, '[data-axe-scope="empty-entries"]');
    check(violations.length === 0, `axe on the empty wiki: ${violations.map((entry) => `${entry.id} (${entry.impact})`).join(", ")}`);
    await t.shot("empty-wiki");

    // ---- Create: a Shop opens the Market's form under Lore ----
    await t.tap(empty.locator('[data-testid="create-open"]'));
    const chooser = page.getByRole("dialog");
    await t.tap(chooser.locator('[data-testid="create-choice-shop"]'));
    const lands = (await chooser.locator('[data-testid="create-lands"]').innerText()).trim();
    check(/Lore/.test(lands) && /Market/.test(lands), `a shop says it lands in Lore's Market (${lands})`);
    await t.shot("create-shop");
    await t.tap(chooser.locator('[data-testid="create-step"]', { hasText: "Open a shop" }));
    await eventually(async () => (await params()).get("system") === "lore", { timeoutMs: 20_000, label: "the Lore tool" });
    await eventually(() => shopName().isVisible(), { timeoutMs: 20_000, label: "the Market's form, opened" });
    await eventually(() => shopName().evaluate((node) => node === document.activeElement), { timeoutMs: 5_000, label: "the shop's name taking the focus" });
    await t.shot("shop-form");

    // ---- the Lore card names its shops ----
    const shop = `Marla's Sundries ${Date.now().toString(36)}`;
    await shopName().fill(shop);
    const bare = page.getByRole("switch", { name: /Stock the shelves/ }).locator("visible=true").first();
    if ((await bare.getAttribute("aria-checked")) === "true") await t.tap(bare);
    // A connection that drops before the server answers (audit WA-05): the
    // market is read again, the shop is not there, it says so, and the name
    // stays to press Open it again.
    const shopsRoute = /\/api\/campaigns\/[^/]+\/shops$/;
    await page.route(shopsRoute, (route) => (route.request().method() === "POST" ? route.abort("failed") : route.continue()));
    await t.tap(page.getByRole("button", { name: "Open it" }).locator("visible=true").first());
    const alert = page.getByRole("alert").filter({ hasText: /not opened|not known yet/ }).locator("visible=true").first();
    await eventually(() => alert.isVisible(), { timeoutMs: 15_000, label: "the lost opening said as an alert" });
    check((await shopName().inputValue()) === shop, "the shop's name is kept");
    await page.unroute(shopsRoute);
    await t.tap(page.getByRole("button", { name: "Open it" }).locator("visible=true").first());
    await eventually(async () => {
      const body = await (await api.get(`${base}/api/campaigns/${id}/shops`)).json().catch(() => ({}));
      return (body.shops ?? []).some((entry) => entry.name === shop);
    }, { timeoutMs: 15_000, label: "the shop kept" });

    // ---- the palette's New shop, from the hub ----
    await t.open(`/workshop/${id}`);
    const cards = page.locator(`${root}[data-tour="hub-systems"]`).locator("visible=true").first();
    await eventually(() => cards.isVisible(), { timeoutMs: 30_000, label: "the hub's systems" });
    // The card's figure counts the shop; its line says shops live here.
    const lore = cards.locator("li", { hasText: "Facts, handouts & shops" }).first();
    await eventually(async () => /(^|\D)1(\D|$)/.test((await lore.textContent()) ?? ""), { timeoutMs: 15_000, label: "the Lore card counting the shop" });
    const palette = page.getByRole("button", { name: /open the command palette/ }).locator("visible=true").first();
    await t.tap(palette);
    const search = page.getByRole("dialog").getByRole("combobox").or(page.getByRole("dialog").getByRole("textbox")).first();
    await eventually(() => search.isVisible(), { timeoutMs: 10_000, label: "the palette" });
    await search.fill("shop");
    const option = page.getByRole("option", { name: /New shop/ }).first();
    await eventually(() => option.isVisible(), { timeoutMs: 10_000, label: "New shop in the palette" });
    await t.tap(option);
    await eventually(async () => (await params()).get("system") === "lore", { timeoutMs: 20_000, label: "the Lore tool from the palette" });
    await eventually(() => shopName().isVisible(), { timeoutMs: 20_000, label: "the Market's form, from the palette" });

    // ---- the wiki is a listbox again once it has a row ----
    const entry = await api.post(`${base}/api/campaigns/${id}/world/entities`, { data: { typeId: "t_location", name: "Saltreach", text: "A harbour." } });
    if (entry.ok()) {
      await t.open(`/workshop/${id}?system=world`);
      const list = page.locator(`${root}[role="listbox"][aria-label="Entries"]`).locator("visible=true").first();
      await eventually(() => list.count(), { timeoutMs: 30_000, label: "the wiki's listbox with a row" });
      check((await list.getByRole("option").count()) >= 1, "its rows are options");
    }
  },
};
