// Issue #302: a storyboard card says its length beside the text, names
// exactly what a save over the cap would lose and holds the save, and
// prose that reads as compressed gets a note the author can dismiss. The
// text itself is never changed.
//
// On a workshop of this run's own (the lead owns none in the seed), through
// the hub's Storyboard card and the board's own card sheet.
import { check, eventually, settle } from "../lib.mjs";

const OVER = `${"The road runs on. ".repeat(222)}and the part that would be lost`;

export default {
  name: "card-limits",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, base, api } = t;
    const made = await api.post(`${base}/api/workshops`, { data: { title: `Limits ${t.viewport} ${Date.now().toString(36)}` } });
    check(made.ok(), `a workshop was created over the API (${made.status()})`);
    const { workshop } = await made.json();

    await t.open(`/workshop/${workshop.id}`);
    const storyboardCard = page.locator(`${root}[data-tour="hub-systems"] button`, { hasText: /Storyboard/ }).locator("visible=true").first();
    await eventually(() => storyboardCard.count(), { timeoutMs: 30_000, label: "the hub's Storyboard card" });
    await t.tap(storyboardCard);
    // The system's guided tour greets a first visit; its overlay eats clicks.
    await settle(page);

    const title = "A scene with limits";
    const titleBox = page.locator(`${root}input[placeholder="The miller's daughter has not come home"]`).locator("visible=true").first();
    await eventually(() => titleBox.count(), { timeoutMs: 30_000, label: "the add-a-card row" });
    await titleBox.fill(title);
    await titleBox.press("Enter");
    const node = page.locator(`${root}button[aria-label="Open ${title}"]`).first();
    await eventually(() => node.count(), { timeoutMs: 30_000, label: "the new card on the board" });
    await settle(page);
    await t.tap(node);

    const body = page.locator(`${root}textarea[aria-label="What happens"]`).locator("visible=true").first();
    await eventually(() => body.count(), { timeoutMs: 30_000, label: "the card editor" });
    const counter = page.locator(`${root}[data-testid="card-length"]`).locator("visible=true").first();
    await eventually(() => counter.count(), { label: "the length counter" });
    check((await counter.textContent())?.replace(/\s+/g, " ").trim() === "0 / 4,000", "an empty card counts 0 / 4,000");

    await body.fill(OVER);
    await eventually(async () => /4,0\d\d \/ 4,000/.test((await counter.textContent()) ?? ""), { label: "the counter past the cap" });
    const alert = page.locator(`${root}[role="alert"]`).locator("visible=true").first();
    await eventually(() => alert.count(), { label: "the overflow warning" });
    const warning = ((await alert.textContent()) ?? "").replace(/\s+/g, " ");
    check(/This card's text is 4,0\d\d characters; the limit is 4,000\. The last \d+ would be lost: ".*would be lost"/.test(warning), `the warning names the lengths and the lost tail (${warning.slice(0, 140)})`);
    const save = page.locator(`${root}button`, { hasText: /^Save the card$/ }).locator("visible=true").first();
    check(await save.isDisabled(), "the save is held while the text is over the cap");
    check((await body.inputValue()) === OVER, "the text was not cut");
    await t.shot("over-cap");

    await body.fill("The road runs on.The mill is dark.Nobody answers.Then a light.");
    const prose = page.locator(`${root}[data-testid="prose-warning"]`).locator("visible=true").first();
    await eventually(() => prose.count(), { label: "the readability note" });
    const note = ((await prose.textContent()) ?? "").replace(/\s+/g, " ");
    check(/3 places read as a missing space after a sentence/.test(note), `the note counts the joined sentences (${note.slice(0, 120)})`);
    check(/nothing is changed/i.test(note), "the note says the text is kept as written");
    check(!(await save.isDisabled()), "a readability note does not hold the save");
    await t.shot("prose-note");
    await t.tap(prose.locator("button", { hasText: /^Dismiss$/ }));
    await eventually(async () => (await prose.count()) === 0, { label: "the note dismissed" });

    // The save itself goes through: the server accepts what the editor
    // accepted, and refuses what it refused.
    await t.tap(save);
    await eventually(async () => !(await save.isDisabled()), { label: "the save settled" });
    const over = await api.patch(`${base}/api/campaigns/${workshop.id}/dm/storyboard/${(await (await api.get(`${base}/api/campaigns/${workshop.id}/dm/storyboard`)).json()).board.nodes[0].id}`, {
      data: { kind: "event", title, body: OVER, links: {}, edges: [], x: 0, y: 0 },
    });
    check(over.status() === 400, `the server refuses the over-long card (${over.status()})`);
    check(/The last \d+ would be lost/.test(((await over.json()).error ?? "")), "the refusal names what would be lost");
  },
};
