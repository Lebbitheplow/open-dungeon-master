// Issues 528 and 529: the Hand grouped by what it spends, and a cost's own
// colour. The seed's level 9 wizard holds thirty-odd cards; her spells fold
// under one Spells card that opens as a hand of its own, its levels as tabs
// with the slots each has left, with chips and a search box to narrow it,
// and a Back spine home. Each cost's pip wears the colour its cards' corner
// notch wears, a colour no card type uses. The lead is a player at this
// table, so it offers no campaign prep (issue 530).
import { axeViolations, check, eventually, untilStill } from "../lib.mjs";

const visible = (locator) => locator.locator("visible=true");

// The cards the fan shows now, by name (an aria-label starts with it).
const fanNames = (page, root) =>
  page
    .locator(`${root}.hand-fan button.hand-card`)
    .evaluateAll((cards) => cards.map((card) => (card.getAttribute("aria-label") ?? "").split(/[,:]/)[0].trim()));

export default {
  name: "hand-groups",
  viewports: ["desktop", "phone"],
  async run(t) {
    const { page, root, ids, viewport } = t;
    const table = ids.spellbook[viewport];
    // A card in the desktop fan lies under its neighbours, and a focused or
    // hovered one lifts over them: on a desktop a card is pressed from the
    // keyboard, which also walks the path a keyboard player takes.
    const press = async (locator) => {
      if (t.touch) return t.tap(locator);
      await locator.focus();
      await page.keyboard.press("Enter");
    };
    await t.open(`/campaigns/${table.id}`);
    // A phone may open on the turn's board, which has no Hand: the Table tab does.
    const tab = visible(page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }));
    if (await tab.count()) await t.tap(tab.first());

    const spells = page.locator(`${root}button.hand-group-card[data-group-id="group:spells"]`);
    await eventually(() => spells.count(), { timeoutMs: 30_000, label: "the Spells card in the fan" });
    await untilStill(page);
    const seats = await page.locator(`${root}.hand-fan > .hand-slot`).count();
    check(seats <= 9, `the grouped hand fits the fan (${seats} seats)`);
    check((await page.locator(`${root}button.hand-more`).count()) === 0, "no More spine is needed once grouped");
    const spellsLabel = (await spells.first().getAttribute("aria-label")) ?? "";
    check(/20 spells/.test(spellsLabel) && /Slots 13\/14/.test(spellsLabel), `the Spells card counts its spells and slots ("${spellsLabel}")`);
    check((await page.locator(`${root}button.hand-group-card[data-group-id="group:actions"]`).count()) === 1, "the basic actions fold under Actions");
    // A player at a table a person runs steers nothing: no campaign prep.
    check((await page.locator(`${root}[data-campaign-prep]`).count()) === 0, "no Campaign prep button for a player");
    await t.shot("grouped");

    // Issue 529: each pip's colour is the colour its cards' notches wear,
    // and no card type's ribbon tone.
    const colours = await page.evaluate((scope) => {
      const at = (selector) => document.querySelector(`${scope}${selector}`);
      const fill = (element) => (element ? getComputedStyle(element).backgroundColor : "");
      const tone = (type) => {
        const probe = document.createElement("span");
        probe.className = "hand-card";
        probe.dataset.type = type;
        document.querySelector(`${scope}.hand`)?.appendChild(probe);
        const value = getComputedStyle(probe).getPropertyValue("--tone").trim();
        probe.remove();
        return value;
      };
      return {
        actionPip: fill(at('.hand-pip[data-cost="action"]')),
        bonusPip: fill(at('.hand-pip[data-cost="bonus"]')),
        reactionPip: fill(at('.hand-pip[data-cost="reaction"]')),
        actionNotch: fill(at('.hand-fan .hand-card[data-cost="action"] .hand-card-notch')),
        tones: ["attack", "rider", "spell", "mend", "ward", "basic"].map(tone),
      };
    }, root);
    check(colours.actionPip && colours.actionPip === colours.actionNotch, `the Action pip and an action card's notch share a colour (${colours.actionPip} / ${colours.actionNotch})`);
    const pips = [colours.actionPip, colours.bonusPip, colours.reactionPip];
    check(new Set(pips).size === 3, `the three costs have three colours (${pips.join(" | ")})`);
    const hex = (rgb) => `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
    for (const pip of pips) {
      check(!colours.tones.includes(hex(pip)), `a cost colour no card type wears (${hex(pip)} vs ${colours.tones.join(" ")})`);
    }

    // Opening Spells: its own hand, Back spine first, levels as tabs.
    await press(spells.first());
    const back = visible(page.locator(`${root}.hand-back`));
    await eventually(() => back.count(), { label: "the Back spine of the open group" });
    const opened = await page.locator(`${root}.hand-group`).first().evaluate((group) => group.getAnimations({ subtree: true }).length);
    check(opened > 0, `the group opens with motion (${opened} animations)`);
    await untilStill(page);
    check(await back.first().evaluate((button) => button === document.activeElement), "the keyboard lands on the way back");
    const tabs = page.locator(`${root}.hand-group [role="tab"]`);
    const tabText = await tabs.evaluateAll((list) => list.map((entry) => entry.textContent?.replace(/\s+/g, " ").trim() ?? ""));
    check(tabText[0]?.startsWith("Cantrips"), `the levels start at the cantrips (${tabText.join(" / ")})`);
    const third = tabText.find((text) => text.startsWith("Level 3")) ?? "";
    check(/2 of 3 slots/.test(third), `Level 3 says its slots left ("${third}")`);
    await t.shot("spells-open");

    await t.tap(tabs.filter({ hasText: "Level 3" }).first());
    await eventually(async () => (await fanNames(page, root)).includes("Fireball"), { label: "Fireball under Level 3" });
    check(
      (await tabs.filter({ hasText: "Level 3" }).first().getAttribute("aria-selected")) === "true",
      "the Level 3 tab is chosen",
    );

    // The chips and the search look through every level.
    const bonus = visible(page.locator(`${root}.hand-group .hand-chip[data-cost="bonus"]`));
    check((await bonus.count()) === 1, "a Bonus action chip is offered");
    await t.tap(bonus.first());
    await eventually(async () => {
      const names = await fanNames(page, root);
      return names.length === 1 && names[0] === "Misty Step";
    }, { label: "only Misty Step under Bonus action" });
    await t.tap(bonus.first());
    const search = visible(page.locator(`${root}.hand-group input[type="search"]`));
    check((await search.count()) === 1, "twenty spells bring a search box");
    await search.first().fill("fire");
    await eventually(async () => {
      const names = await fanNames(page, root);
      return names.includes("Fire Bolt") && names.includes("Fireball") && !names.includes("Shield");
    }, { label: "the fire spells found" });
    await untilStill(page);
    await t.shot("spells-search");
    await t.tap(visible(page.locator(`${root}.hand-group-clear`)).first());
    await eventually(() => tabs.count(), { label: "the tabs back once the search is cleared" });

    // A spell from the group takes aim like any card; Escape lets it go,
    // and a second Escape goes home to the main hand.
    await t.tap(tabs.filter({ hasText: "Level 3" }).first());
    const fireball = visible(page.locator(`${root}.hand-fan button.hand-card[aria-label^="Fireball,"]`));
    await eventually(() => fireball.count(), { label: "the Fireball card" });
    await press(fireball.first());
    // The aim bar: on a phone it stands where the rail was.
    const aimBar = visible(page.locator(`${root}.hand-aim`));
    await eventually(() => aimBar.count(), { label: "Fireball raised, its aim bar open" });
    check(/Fireball/.test((await aimBar.first().textContent()) ?? ""), "the aim bar is Fireball's");
    await untilStill(page);
    await t.shot("fireball-aimed");
    if (viewport === "desktop") {
      await page.keyboard.press("Escape");
      await eventually(async () => (await aimBar.count()) === 0, { label: "Fireball let go" });
      // Let go, the card has the keyboard back.
      await eventually(() => page.evaluate(() => document.activeElement?.getAttribute("data-card-id") === "spell:fireball"), {
        label: "the keyboard back on Fireball",
      });
      await page.keyboard.press("Escape");
      await eventually(async () => (await back.count()) === 0, { label: "Escape back to the main hand" });
      await eventually(() => page.evaluate(() => document.activeElement?.getAttribute("data-group-id") === "group:spells"), {
        label: "the keyboard back on the Spells card",
      });
    } else {
      // The phone's aim bar has its own Back.
      const aimBack = visible(page.locator(`${root}button`).filter({ hasText: /^\s*Back\s*$/ }));
      if (await aimBack.count()) await t.tap(aimBack.first());
      await t.tap(back.first());
      await eventually(async () => (await back.count()) === 0, { label: "the Back spine home" });
    }
    await eventually(() => spells.count(), { label: "the main hand again" });

    // Actions, then the Back spine.
    await press(page.locator(`${root}button.hand-group-card[data-group-id="group:actions"]`).first());
    await eventually(async () => (await fanNames(page, root)).includes("Dodge"), { label: "Dodge under Actions" });
    if (viewport === "desktop") {
      const problems = await axeViolations(page, `${root}.hand`.trim());
      check(problems.length === 0, `the open group passes axe: ${JSON.stringify(problems)}`);
    }
    await t.tap(visible(page.locator(`${root}.hand-back`)).first());
    await eventually(() => spells.count(), { label: "Back to the main hand from Actions" });

    // Customize Hand (issue 231) knows the groups: Spells goes to More, and
    // Fireball is seated on its own while it stays inside Spells.
    await t.tap(visible(page.locator(`${root}button[aria-label="Customize your hand"]`)).first());
    const spellsRow = page.locator('li.hand-arrange-row[data-place="hand"]').filter({ hasText: /^Spells/ }).first();
    await eventually(() => spellsRow.count(), { label: "Spells as a row of the arrangement" });
    await untilStill(page);
    await t.tap(spellsRow.locator(".hand-arrange-move").first());
    const movedRow = page.locator('li.hand-arrange-row[data-place="more"]').filter({ hasText: /^Spells/ }).first();
    await eventually(() => movedRow.count(), { label: "Spells moved to More" });
    const disclose = movedRow.locator(".hand-arrange-open").first();
    await t.tap(disclose);
    check((await disclose.getAttribute("aria-expanded")) === "true", "the group's cards are listed to seat one");
    const fireballRow = movedRow.locator("li.hand-arrange-member").filter({ hasText: "Fireball" }).first();
    await t.tap(fireballRow.locator(".hand-arrange-move").first());
    await eventually(async () => /In Hand/.test((await fireballRow.textContent()) ?? ""), { label: "Fireball seated on its own" });
    await untilStill(page);
    await t.shot("arrange-groups");
    await t.tap(visible(page.locator(".hand-arrange-done")).first());
    await eventually(async () => (await fanNames(page, root)).includes("Fireball"), { label: "Fireball in the fan" });
    check((await spells.count()) === 0, "the Spells card itself waits in More");
    check((await visible(page.locator(`${root}button.hand-more`)).count()) === 1, "a More spine for the group that waits there");

    // The More sheet lays the group out by level, with its slots, and gives
    // the twenty-odd cards there a search box. Done leaves it open on its
    // list while cards wait there; otherwise the More spine opens it.
    const sheet = page.locator('[role="dialog"]');
    if (!(await visible(sheet).count())) await t.tap(visible(page.locator(`${root}button.hand-more`)).first());
    await eventually(() => visible(sheet.locator(".hand-more-group")).count(), { label: "Spells as a section of More" });
    const heads = await sheet.locator(".hand-more-section").evaluateAll((list) => list.map((head) => head.textContent?.trim() ?? ""));
    check(heads.some((text) => /^Level 3 · 2 of 3 slots/.test(text)), `More heads each level with its slots (${heads.join(" / ")})`);
    check((await visible(sheet.locator('input[type="search"]')).count()) === 1, "More has a search box for this many cards");
    await sheet.locator('input[type="search"]').first().fill("misty");
    await eventually(async () => (await visible(sheet.locator("li.hand-more-row")).count()) === 1, { label: "only Misty Step found in More" });
    await untilStill(page);
    await t.shot("more-sections");
    await page.keyboard.press("Escape");
    await eventually(async () => (await visible(sheet).count()) === 0, { label: "More closed" });

    // Back to automatic, for the next run on this table.
    await t.tap(visible(page.locator(`${root}button[aria-label="Customize your hand"]`)).first());
    const reset = visible(page.locator("button").filter({ hasText: /^\s*Back to automatic\s*$/i }));
    await eventually(() => reset.count(), { label: "Back to automatic" });
    await t.tap(reset.first());
    await t.tap(visible(page.locator(".hand-arrange-done")).first());
    await eventually(() => spells.count(), { label: "the Spells card back in the fan" });

    // Issue 668: in a window between a phone and a wide screen (a tablet
    // upright, a small window) the full fan sits in a hand that scrolls, so it clips
    // sideways. Every card stays inside the hand, reachable by pointer and
    // keyboard, and lifts with its details in view; the hand never slides
    // sideways, so its chips and notice stay put. The last card's details
    // used to reach past the hand's edge and give it room to slide.
    for (const size of viewport === "desktop" ? [{ width: 768, height: 1024 }, { width: 1000, height: 800 }] : []) {
      const at = `${size.width} by ${size.height}`;
      await page.setViewportSize(size);
      await t.open(`/campaigns/${table.id}`);
      const tableTab = visible(page.locator(`${root}button, ${root}[role="tab"]`).filter({ hasText: /^\s*table\s*$/i }));
      if (await tableTab.count()) await t.tap(tableTab.first());
      const hand = visible(page.locator(`${root}section[aria-label="Your hand"]`)).first();
      await eventually(() => spells.count(), { timeoutMs: 30_000, label: `the fan at ${at}` });
      await hand.scrollIntoViewIfNeeded();
      await untilStill(page);
      const room = await hand.evaluate((section) => {
        const before = section.scrollLeft;
        section.scrollLeft = 400;
        const slid = section.scrollLeft;
        section.scrollLeft = before;
        return { slid, scrollWidth: section.scrollWidth, clientWidth: section.clientWidth };
      });
      check(room.slid === 0, `the hand cannot slide sideways at ${at} (${JSON.stringify(room)})`);
      const cards = hand.locator(".hand-fan > .hand-slot > button");
      const count = await cards.count();
      check(count >= 7, `the fan deals its cards at ${at} (${count})`);
      const strips = await hand.evaluate((section) => {
        const box = section.getBoundingClientRect();
        const faces = [...section.querySelectorAll(".hand-fan > .hand-slot > button")];
        return faces.map((face, index) => {
          const r = face.getBoundingClientRect();
          const next = faces[index + 1]?.getBoundingClientRect();
          const x = next ? (r.left + Math.max(r.left + 8, next.left)) / 2 : (r.left + r.right) / 2;
          const hit = document.elementFromPoint(x, r.top + r.height / 2);
          return { name: (face.getAttribute("aria-label") ?? "").split(/[,:]/)[0], inside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5, pointer: Boolean(hit && face.contains(hit)) };
        });
      });
      for (const strip of strips) {
        check(strip.inside, `${strip.name} sits inside the hand at ${at}`);
        check(strip.pointer, `${strip.name} takes a pointer on its own strip at ${at}`);
      }
      for (let index = 0; index < count; index += 1) {
        await cards.nth(index).focus();
        await untilStill(page);
        const lifted = await hand.evaluate((section, at) => {
          const box = section.getBoundingClientRect();
          const face = section.querySelectorAll(".hand-fan > .hand-slot > button")[at];
          const r = face.getBoundingClientRect();
          const preview = face.parentElement.querySelector(".hand-preview");
          const p = preview && getComputedStyle(preview).visibility === "visible" ? preview.getBoundingClientRect() : null;
          return {
            name: (face.getAttribute("aria-label") ?? "").split(/[,:]/)[0],
            focused: document.activeElement === face,
            slid: section.scrollLeft,
            cardInside: r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= 0 && r.bottom <= window.innerHeight,
            previewInside: !p || (p.left >= box.left - 0.5 && p.right <= box.right + 0.5 && p.top >= box.top - 0.5 && p.bottom <= box.bottom + 0.5),
          };
        }, index);
        check(lifted.focused, `${lifted.name} takes focus from the keyboard at ${at}`);
        check(lifted.slid === 0, `focusing ${lifted.name} does not slide the hand (scrollLeft ${lifted.slid})`);
        check(lifted.cardInside, `${lifted.name} lifts fully into view at ${at}`);
        check(lifted.previewInside, `${lifted.name}'s details stay inside the hand at ${at}`);
      }
      // A pointer over the last card shows its details, and they stay inside
      // the hand on every side (they opened above the card, cut off at the
      // hand's top, and reached past its right edge).
      await cards.nth(count - 1).hover();
      await untilStill(page);
      const details = await hand.evaluate((section) => {
        const box = section.getBoundingClientRect();
        const faces = section.querySelectorAll(".hand-fan > .hand-slot > button");
        const last = faces[faces.length - 1];
        const preview = last.parentElement.querySelector(".hand-preview");
        if (!preview) return { shown: false, none: true };
        const shown = getComputedStyle(preview).visibility === "visible" && Number(getComputedStyle(preview).opacity) > 0.5;
        const p = preview.getBoundingClientRect();
        return {
          shown,
          inside: p.left >= box.left - 0.5 && p.right <= box.right + 0.5 && p.top >= box.top - 0.5 && p.bottom <= box.bottom + 0.5,
          slid: section.scrollLeft,
          preview: [Math.round(p.left), Math.round(p.top), Math.round(p.right), Math.round(p.bottom)],
          hand: [Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom)],
        };
      });
      check(details.none || details.shown, `the last card shows its details under a pointer at ${at} (${JSON.stringify(details)})`);
      check(details.none || details.inside, `the last card's details stay inside the hand at ${at} (${JSON.stringify(details)})`);
      check(!details.slid, `hovering the last card does not slide the hand at ${at}`);
      await t.shot(`fan-${size.width}x${size.height}`);
    }
  },
};
