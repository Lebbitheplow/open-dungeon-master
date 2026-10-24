// Issues 212 and 213, PRs 232 and 234: the Chronicle beside the staged
// board shows every entry whole (a passage's every paragraph, a system line
// to its end) and follows the newest line while the reader is at the foot;
// a reader who scrolled up is left there, told what arrived, and taken down
// by the Latest button.
import { check, eventually, sleep } from "../lib.mjs";

export default {
  name: "chronicle",
  viewports: ["desktop"],
  async run(t) {
    const { page, root, ids, base, api } = t;
    await t.open(`/campaigns/${ids.campaignId}`);
    const log = page.locator(`${root}.cine-chronicle-log`).locator("visible=true").first();
    await eventually(() => log.count(), { timeoutMs: 30_000, label: "the chronicle beside the board" });
    const text = () => log.innerText().then((value) => value.replace(/\s+/g, " "));
    // Whole entries: the third paragraph and the end of the system line are
    // the parts clipRecap used to cut.
    await eventually(async () => (await text()).includes(ids.paragraphs[2]), { label: "the passage's last paragraph on the scroll" });
    const shown = await text();
    for (const paragraph of ids.paragraphs) {
      check(shown.includes(paragraph), `the chronicle shows the paragraph "${paragraph.slice(0, 30)}..." whole`);
    }
    check(shown.includes(ids.systemLine.slice(-40)), "the chronicle shows the system line to its end");
    check(shown.includes("Party lead: "), "the lead's direction prefix reads as words, not the transcript's card marker");
    check(!shown.includes("[Party lead direction]"), "the stored prefix is not printed raw");

    const metrics = () => log.evaluate((el) => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));
    const atBottom = async () => {
      const m = await metrics();
      return m.height - m.top - m.client <= 48;
    };
    await eventually(atBottom, { label: "the chronicle resting at its foot on open" });

    // A new line while the reader is at the foot: the scroll follows.
    const post = async (content) => {
      const response = await api.post(`${base}/api/campaigns/${ids.campaignId}/actions`, { data: { kind: "ooc", content } });
      check(response.ok(), `posting a table-talk line answered ${response.status()}`);
    };
    await post("First table talk line, while the reader is at the foot.");
    await eventually(async () => (await text()).includes("First table talk line"), { label: "the new line on the scroll" });
    await eventually(atBottom, { label: "the chronicle following the new line" });

    // The reader scrolls back: the scroll stays, the button rises, and a
    // new line does not yank them down.
    await log.evaluate((el) => { el.scrollTop = 0; });
    const latest = page.locator(`${root}.cine-chronicle-latest`).locator("visible=true").first();
    await eventually(() => latest.getAttribute("data-shown").then((value) => value !== null), { label: "the Latest button once the reader scrolled up" });
    await post("Second table talk line, while the reader is reading back.");
    await eventually(async () => (await text()).includes("Second table talk line"), { label: "the second line arriving" });
    // Time is the check: a yank down would come within this while.
    await sleep(600);
    const after = await metrics();
    check(after.top < 200, `a reader who scrolled up stays there (scrollTop ${after.top})`);
    check((await latest.getAttribute("data-unseen")) !== null, "the button says something new arrived below");
    await t.shot("reading-back");
    await t.tap(latest);
    await eventually(atBottom, { label: "the Latest button taking the reader down" });
    // Sunk away, the button is out of reach (aria-hidden, no height on the
    // app's screens), so it is read without the visible filter.
    const sunk = page.locator(`${root}.cine-chronicle-latest`).first();
    await eventually(() => sunk.getAttribute("data-shown").then((value) => value === null), { label: "the button sinking away at the foot" });
  },
};
