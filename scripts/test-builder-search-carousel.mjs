// The builder's picking quick wins (backlog Q6, Q11, Q12, Q14), checked in
// the markup the components render and, where a behaviour lives in a handler
// a static render cannot reach, in the source that holds it. The pure rules
// (the search haystack, the spoken position, the swipe threshold) are pinned
// in test-lineage-cards.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-dialog-inline.mjs", import.meta.url);
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const noop = () => {};

// Q12. Every grid has its search box, however few cards it holds, and Enter
// on a single match chooses it.
{
  const { OptionCardGrid } = await import("../src/app/characters/builder/OptionCardGrid.tsx");
  const markup = renderToStaticMarkup(
    createElement(OptionCardGrid, {
      groups: [
        {
          label: null,
          options: [
            { id: "fighter", name: "Fighter", art: "/a.webp", tagline: "Core class", chips: ["Tank"] },
            { id: "rogue", name: "Rogue", art: "/b.webp", tagline: "Core class", chips: ["Striker"] },
          ],
        },
      ],
      value: "",
      onChoose: noop,
      onDetails: noop,
      noun: "class",
    }),
  );
  assert.match(markup, /<input[^>]*type="search"[^>]*aria-label="Search classes"/, `a two-card grid has a search box: ${markup.slice(0, 400)}`);
  assert.ok(markup.includes("Searches names, roles and the other words on each card."), "the box says what it searches");

  const grid = read("src/app/characters/builder/OptionCardGrid.tsx");
  assert.ok(!/SEARCH_FROM/.test(grid), "no card-count threshold hides the box");
  assert.match(grid, /event\.key === "Enter" && lone/, "Enter acts only on a single match");
  assert.match(grid, /onChoose\(lone\.id\)/, "and chooses it");
  // Focus follows the wizard into the step only for a hovering fine pointer,
  // so a phone's keyboard does not cover the cards.
  assert.match(grid, /\(hover: hover\) and \(pointer: fine\)/, "focus on entry is for keyboard and mouse only");
  assert.match(grid, /wizard-step-heading/, "focus follows the wizard's step-entry focus");
  console.log("ok: the grid always searches, Enter picks a lone match, focus on entry skips touch (Q12)");
}

// Q6 and Q14. The carousel names where it is, preloads its neighbours and
// pages on a swipe.
{
  const { LineageCarousel } = await import("../src/app/characters/builder/LineageCarousel.tsx");
  const slide = (id, name, recommended) => ({
    id,
    name,
    asi: { cha: 2 },
    speed: 30,
    languages: ["Common"],
    note: "",
    art: `/assets/placeholders/character-race/${id}-neutral.webp`,
    group: recommended ? "Fits this setting" : "All lineages",
    recommended,
    info: {},
  });
  const slides = [slide("dwarf", "Dwarf", true), slide("tiefling", "Tiefling", true), slide("elf", "Elf", false)];
  const render = (index) =>
    renderToStaticMarkup(
      createElement(LineageCarousel, { slides, index, onIndexChange: noop, chosenId: "", onChoose: noop }),
    );

  const recommended = render(1);
  assert.match(
    recommended,
    /<span class="sr-only" aria-live="polite" aria-atomic="true">Tiefling, 2 of 3, recommended<\/span>/,
    "the live position names the lineage and its seal",
  );
  assert.match(recommended, /aria-hidden="true">2(<!-- -->)? \/ (<!-- -->)?3<\/span>/, "the visual count is not read twice");
  assert.match(render(2), /aria-atomic="true">Elf, 3 of 3<\/span>/, "no seal where none applies");

  const carousel = read("src/app/characters/builder/LineageCarousel.tsx");
  // The paging buttons sit outside the slide keyed by lineage, so the one
  // that was pressed keeps focus through the step.
  const keyed = carousel.indexOf("key={slide.id}");
  assert.ok(keyed > carousel.indexOf("aria-label={`Next: ${next.name}`}"), "the paging buttons are not re-mounted per slide");
  assert.match(carousel, /new Image\(\)/, "the neighbouring plates are fetched ahead");
  assert.match(carousel, /onTouchEnd=/, "a touch swipe pages");
  assert.match(carousel, /swipeStep\(/, "through the tested threshold");
  console.log("ok: the carousel names the lineage, preloads its neighbours and swipes (Q6, Q14)");
}

// Q11. The companion builder fills a phone, and a library companion joins
// only after a second, named tap.
{
  const dialog = read("src/app/campaigns/[campaignId]/CompanionBuilderDialog.tsx");
  assert.match(dialog, /"fixed inset-0 z-50 h-dvh w-full/, "full screen below the tablet breakpoint");
  assert.match(dialog, /sm:max-h-\[88dvh\] sm:w-\[min\(48rem,94vw\)\]/, "the centred card from a tablet up");
  const posts = [...dialog.matchAll(/post\(\{ libraryCharacterId: ([\w.]+) \}\)/g)].map((match) => match[1]);
  assert.deepEqual(posts, ["pending.id"], "the only library add is the confirm button's");
  assert.match(dialog, /Add \{pending\.name\} to the party at level \{level\}\?/, "the question names who and at what level");
  assert.match(dialog, /Change first/, "#321's Change first stays");
  assert.match(dialog, /worldPackId=\{worldPackId\}/, "#321's world pack stays");
  console.log("ok: the companion builder is full screen on a phone and asks before a library add (Q11)");
}
