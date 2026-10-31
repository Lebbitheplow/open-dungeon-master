// Issue 668: at the start of a new round the Hand read "Vesper Lark has
// already used their bonus action this turn; Cunning Action (Hide) needs
// one" while the bonus chip was lit. A Hand notice was cleared only when a
// card was picked or played, never when the turn moved on. A notice now
// holds only for the turn it was raised on: here the lead's fighter Dodges,
// a spent action card is pressed and says why, and once the GM ends the
// turn the notice is gone while the Hand stays on the table.
import { request } from "playwright-core";
import { check, eventually } from "../lib.mjs";

export default {
  name: "hand-notice",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, base, viewport } = t;
    const table = ids.noticeTables[viewport];
    // The table is the player's to run: the GM's calls go out as them.
    const gm = await request.newContext();
    try {
      const signed = await gm.post(`${base}/api/auth/login`, { data: { username: ids.player, password: ids.password } });
      check(signed.ok(), `the player signed in (${signed.status()})`);
      const invoke = async (name, args) => {
        const response = await gm.post(`${base}/api/campaigns/${table.id}/dm/invoke`, { data: { name, args } });
        const body = await response.json().catch(() => ({}));
        check(response.ok(), `${name} was refused (${response.status()}): ${body.error ?? ""}`);
        return body;
      };
      await t.open(`/campaigns/${table.id}`);
      if (viewport === "phone") await t.tap(page.locator(`${root}nav.cine-bottombar`).getByRole("button", { name: "Table", exact: true }));
      const hand = page.locator(`${root}section[aria-label="Your hand"]`).locator("visible=true").first();
      await eventually(() => hand.isVisible(), { timeoutMs: 30_000, label: "the fighter's Hand" });

      await invoke("take_action", { characterId: table.hero, action: "dodge" });
      // The first one on show: a group's folded cards are in the page too,
      // hidden. It is pressed from the keyboard, as a player who tabs to it
      // would; on a desktop the fanned cards overlap, so a pointer aimed at
      // the card's middle lands on its neighbour.
      const spent = hand.locator('[aria-disabled="true"][aria-label*=", Action."]').locator("visible=true").first();
      await eventually(() => spent.count(), { timeoutMs: 15_000, label: "an action card spent by the Dodge" });
      await spent.focus();
      await page.keyboard.press("Enter");
      const notice = hand.locator('p[role="status"]');
      await eventually(async () => (await notice.isVisible()) && /action/i.test(await notice.innerText()), { timeoutMs: 10_000, label: "the spent card saying why" });
      // The notice reads whole, through its shake and after it. On a phone
      // the hand clips sideways (it scrolls), and the notice's shake carried
      // its first letters off the edge ("Dren Vale has..."); the hand could
      // also slide sideways under a focused card.
      await page.keyboard.press("Enter");
      const shake = await hand.evaluate(async (section) => {
        const read = (note) => {
          const range = document.createRange();
          range.setStart(note.firstChild, 0);
          range.setEnd(note.firstChild, 1);
          return range.getBoundingClientRect().left;
        };
        const note = section.querySelector('p[role="status"]');
        const handLeft = section.getBoundingClientRect().left;
        let least = Infinity;
        let shook = false;
        const until = performance.now() + 700;
        while (performance.now() < until) {
          least = Math.min(least, read(note));
          shook ||= note.getAnimations().length > 0;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return { handLeft, least, shook };
      });
      check(shake.least >= shake.handLeft - 0.5 && shake.least >= 0, `the notice's first letter stays on show through its shake (${JSON.stringify(shake)})`);
      const place = await hand.evaluate(async (section) => {
        const read = (note) => {
          const range = document.createRange();
          range.setStart(note.firstChild, 0);
          range.setEnd(note.firstChild, 1);
          return range.getBoundingClientRect().left;
        };
        const note = section.querySelector('p[role="status"]');
        await Promise.all(note.getAnimations().map((animation) => animation.finished));
        const box = section.getBoundingClientRect();
        const line = note.getBoundingClientRect();
        return { scrolled: section.scrollLeft, handLeft: box.left, handRight: box.right, left: line.left, right: line.right, first: read(note), focused: section.contains(document.activeElement) };
      });
      check(place.focused, "a card in the hand has focus");
      check(place.scrolled === 0, `the hand has not slid sideways (scrollLeft ${place.scrolled})`);
      check(place.left >= 0 && place.left >= place.handLeft - 0.5 && place.right <= place.handRight + 0.5, `the notice sits inside the hand and the screen (${JSON.stringify(place)})`);
      check(place.first >= place.handLeft && place.first >= 0, `the notice's first letter is on show (${JSON.stringify(place)})`);
      await t.shot("hand-notice-raised");

      await invoke("end_turn", { characterId: table.hero });
      await eventually(async () => !(await notice.isVisible()), { timeoutMs: 15_000, label: "the notice gone once the turn moved on" });
      check(await hand.isVisible(), "the Hand stays on the table off the fighter's turn");
      await t.shot("hand-notice-gone");
    } finally {
      await gm.dispose().catch(() => {});
    }
  },
};
