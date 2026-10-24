// Issue 501: an NPC's act. The seed's player runs this table and Senna keeps
// up an act toward Kael, whom the lead plays. Kael's Bonds row reads the
// warmth Senna shows and nothing of her motive. When an Insight from the
// storyteller's console beats Senna's Deception, the server tells Kael's
// player alone and his row turns to the truth where he can see it happen
// (a flip, and a "Seen through" chip; under reduced motion a fade). The
// storyteller's own Bonds tab reads the act, the motive and who saw through
// it. A betrayal by Senna unmasks her for everyone. Checked by axe in the
// night and day themes.
import { axeViolations, check, eventually, openPanelTab, seeAllTours, settle, signIn, sleep } from "../lib.mjs";

async function axeClean(page, selector, where) {
  const found = await axeViolations(page, selector);
  check(!found.length, `axe on ${where}: ${found.map((entry) => `${entry.id}: ${entry.help}`).join("; ").slice(0, 600)}`);
}

async function inTheme(page, theme) {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  await sleep(300);
}

async function openBonds(h) {
  await openPanelTab(h, "party");
  const bondsTab = h.page.locator(`${h.root}[data-pill-group] button`).filter({ hasText: /^\s*Bonds\s*$/ }).locator("visible=true").first();
  await eventually(() => bondsTab.count(), { label: "the Bonds sub-tab" });
  await h.tap(bondsTab);
}

export default {
  name: "scheming-npc",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport, base } = t;
    const table = ids.masked[viewport];
    // The phone runs with reduced motion: the truth arrives as a fade.
    const reduced = viewport === "phone";
    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    // The storyteller's own session: the console calls a person running the
    // table makes, and their own view of the Bonds tab.
    const storyteller = await page.context().browser().newContext({ viewport: { width: 1366, height: 900 } });
    await signIn(storyteller, base, ids.player, ids.password);
    await seeAllTours(storyteller.request, base);
    const invoke = async (name, args) => {
      const response = await storyteller.request.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
      return { status: response.status(), body: await response.json().catch(() => ({})) };
    };

    try {
      await t.open(`/campaigns/${table.id}`);
      await openBonds(t);
      const row = page.locator(`${root}[data-bond-row="Senna Vale"]`).locator("visible=true").first();
      await eventually(() => row.count(), { timeoutMs: 20_000, label: "Senna's Bonds row" });
      const actText = await row.innerText();
      check(/Friendly/.test(actText), `Kael's player reads the warmth Senna shows: ${actText}`);
      check(!/ledger|is an act|Seen through|Unmasked/i.test(actText), "nothing of the act or its motive");
      check((await row.locator("[data-bond-unmasked]").count()) === 0, "nothing seen through yet");
      await t.shot("act");

      // Watch the row for the moment it turns, from before the server's
      // answer, so a short animation is caught however fast it runs.
      await page.evaluate(() => {
        window.__unmasking = [];
        const watch = new MutationObserver((records) => {
          for (const record of records) {
            const element = record.target;
            if (element instanceof HTMLElement && element.hasAttribute("data-unmasking")) {
              window.__unmasking.push(getComputedStyle(element).animationName);
            }
          }
        });
        watch.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["data-unmasking"] });
      });

      // The storyteller asks for an Insight until Kael's beats Senna's lie.
      let seen = null;
      for (let attempt = 0; attempt < 15 && !seen; attempt += 1) {
        const answer = await invoke("check_notice", { sense: "insight", againstMonster: "Senna Vale", characterIds: [table.kael] });
        check(answer.status === 200, `check_notice answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 300)}`);
        seen = answer.body.result?.seenThrough ?? null;
      }
      check(seen, "Kael saw through Senna within fifteen tries");
      check(/only Kael Ashvale's player was told/.test(seen.join(" ")), `the storyteller is told who knows: ${seen}`);

      const chip = row.locator('[data-bond-unmasked="you"]');
      await eventually(() => chip.count(), { timeoutMs: 20_000, label: "Seen through on Kael's row" });
      const truthText = await row.innerText();
      check(/Seen through/.test(truthText), `the chip says so: ${truthText}`);
      check(/Disliked|Dislikes|Wary/.test(truthText), `the row reads the truth: ${truthText}`);
      check(/Only you know/.test(truthText), "and says only Kael's player knows");
      const motion = await page.evaluate(() => window.__unmasking);
      check(motion.length > 0, "the row turned while on screen");
      check(motion.every((name) => name === (reduced ? "bond-unmask-fade" : "bond-unmask")), `the turn ${reduced ? "fades under reduced motion" : "flips"}: ${motion.join(", ")}`);
      await sleep(1_000);
      await axeClean(page, `${root}[data-bond-row="Senna Vale"]`, "the seen-through row at night");
      await t.shot("seen-through");
      await inTheme(page, "light");
      await axeClean(page, `${root}[data-bond-row="Senna Vale"]`, "the seen-through row by day");
      await t.shot("seen-through-day");
      await inTheme(page, "dark");

      // The storyteller reads the act on their own Bonds tab.
      const dmPage = await storyteller.newPage();
      await dmPage.goto(`${base}/campaigns/${table.id}`, { waitUntil: "networkidle", timeout: 120_000 });
      await sleep(1_500);
      await settle(dmPage);
      await openBonds({ page: dmPage, root: "", tap: (locator) => locator.click() });
      const act = dmPage.locator(`[data-bond-act="Senna Vale"]`).locator("visible=true").first();
      await eventually(() => act.count(), { timeoutMs: 20_000, label: "the act on the storyteller's Bonds row" });
      const told = await act.innerText();
      check(/An act: the table sees Friendly \+40/.test(told), `the storyteller reads the act: ${told}`);
      check(/Wants the ferry ledger/.test(told), "and the motive");
      check(/Seen through by Kael Ashvale/.test(told), "and who saw through it");
      await axeClean(dmPage, `[data-bond-row="Senna Vale"]`, "the storyteller's row at night");
      await dmPage.screenshot({ path: t.shotPath("storyteller") }).catch(() => {});
      await inTheme(dmPage, "light");
      await axeClean(dmPage, `[data-bond-row="Senna Vale"]`, "the storyteller's row by day");
      await dmPage.screenshot({ path: t.shotPath("storyteller-day") }).catch(() => {});

      // A betrayal by Senna: the truth is out for everyone.
      const ended = await invoke("relationship_end", { characterId: table.kael, subject: "Senna Vale", reason: "betrayal", by: "npc" });
      check(ended.status === 200, `relationship_end answered ${ended.status}: ${JSON.stringify(ended.body).slice(0, 300)}`);
      const unmasked = row.locator('[data-bond-unmasked="all"]');
      await eventually(() => unmasked.count(), { timeoutMs: 20_000, label: "Unmasked on Kael's row" });
      const outText = await row.innerText();
      check(/Unmasked/.test(outText) && /ended/.test(outText), `the row reads unmasked and ended: ${outText}`);
      check(!/ledger/i.test(outText), "the motive stays the storyteller's");
      await sleep(600);
      await axeClean(page, `${root}[data-bond-row="Senna Vale"]`, "the unmasked row");
      await t.shot("unmasked");
    } finally {
      await storyteller.close();
    }
  },
};
