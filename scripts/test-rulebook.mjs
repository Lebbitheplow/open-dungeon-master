// The rulebook (/rulebook): the SRD 5.1 bound as pages, its markdown, its
// search, and the three routes that serve it.
//
// The book's claims worth guarding: it is the whole reference document (every
// chapter, every spell, monster and magic item, the legal notice); every
// page parses into blocks that leave no markdown behind; the quick links a
// table reaches for land on anchors that exist; search puts the rule itself
// first; and the routes are closed to anyone not signed in.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-rulebook-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-routes.mjs", import.meta.url);

const { rulebookContents, rulebookPage, rulebookPages, rulebookSearch, QUICK_LINKS } = await import(
  "../src/lib/rulebook/book.ts"
);
const { anchorSlug, blockText, inlineText, parseBook, parseInline, stripInline } = await import(
  "../src/lib/rulebook/markdown.ts"
);
const { queryTerms, snippetFor, stem } = await import("../src/lib/rulebook/search.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function anchorsOf(blocks, out = []) {
  for (const block of blocks) {
    if (block.anchor) out.push(block.anchor);
    if (block.blocks) anchorsOf(block.blocks, out);
  }
  return out;
}

try {
  // ---- the book ----
  await test("the book holds every chapter of the SRD in order", () => {
    const { chapters, pageCount } = rulebookContents();
    assert.deepEqual(
      chapters.map((chapter) => chapter.title),
      [
        "Races",
        "Classes",
        "Beyond 1st Level",
        "Personality and Background",
        "Equipment",
        "Feats",
        "Using Ability Scores",
        "Adventuring",
        "Combat",
        "Spellcasting",
        "Spells",
        "Running the Game",
        "Magic Items",
        "Monsters",
        "Creatures",
        "Nonplayer Characters",
        "Appendices",
      ],
    );
    assert.equal(pageCount, rulebookPages().length);
    const count = (id) => chapters.find((chapter) => chapter.id === id).entries.length;
    assert.equal(count("classes"), 12);
    assert.equal(count("races"), 10, "racial traits and the nine SRD races");
    assert.equal(count("spells"), 319, "every SRD 5.1 spell");
    assert.ok(count("magic-items") >= 240);
    assert.ok(count("monsters") + count("creatures") + count("npcs") >= 318);
  });

  await test("folios count every page once, from 1", () => {
    const folios = rulebookContents().chapters.flatMap((chapter) => chapter.entries.map((entry) => entry.folio));
    assert.deepEqual(folios, folios.map((_, index) => index + 1));
  });

  await test("page ids are unique and safe for an address", () => {
    const ids = rulebookPages().map((page) => page.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[a-z0-9-]{1,96}$/);
  });

  await test("spells are grouped by level, cantrips first", () => {
    const spells = rulebookContents().chapters.find((chapter) => chapter.id === "spells").entries;
    assert.equal(spells[0].group, "Cantrips");
    assert.equal(spells.at(-1).group, "9th Level");
    const fireball = spells.find((entry) => entry.title === "Fireball");
    assert.equal(fireball.group, "3rd Level");
    assert.equal(fireball.meta, "3rd-level evocation");
  });

  await test("a monster keeps its family beside a plain name", () => {
    const page = rulebookPage("adult-red-dragon-chromatic").page;
    assert.equal(page.title, "Adult Red Dragon");
    assert.equal(page.family, "Chromatic");
    assert.equal(page.meta, "Huge dragon, chaotic evil");
    assert.equal(rulebookPage("druid-npc").page.title, "Druid");
    assert.equal(rulebookPage("druid").page.kind, "class");
  });

  await test("a page knows its chapter and the pages either side", () => {
    const combat = rulebookPage("combat");
    assert.equal(combat.chapter.numeral, "IX");
    assert.equal(combat.prev.id, "adventuring");
    assert.equal(combat.next.id, "spellcasting");
    assert.equal(rulebookPage("racial-traits").prev, null);
    assert.equal(rulebookPage("legal-information").next, null);
    assert.equal(rulebookPage("no-such-page"), null);
  });

  await test("the legal notice carries the CC-BY-4.0 attribution", () => {
    const legal = rulebookPage("legal-information").page.md;
    assert.match(legal, /System Reference Document 5\.1/);
    assert.match(legal, /Creative Commons Attribution 4\.0/);
    assert.equal(rulebookContents().source.license, "CC-BY-4.0");
  });

  await test("every quick link lands on an anchor that exists", () => {
    assert.ok(QUICK_LINKS.length >= 10);
    for (const link of QUICK_LINKS) {
      const found = rulebookPage(link.page);
      assert.ok(found, `${link.label}: no page ${link.page}`);
      if (link.at) assert.ok(anchorsOf(parseBook(found.page.md)).includes(link.at), `${link.label}: no #${link.at}`);
    }
  });

  await test("links between pages point at pages that exist", () => {
    for (const page of rulebookPages()) {
      for (const match of page.md.matchAll(/\]\(page:([^)]+)\)/g)) {
        assert.ok(rulebookPage(match[1]), `${page.id} links to a missing page ${match[1]}`);
      }
    }
  });

  // ---- the markdown ----
  await test("every page parses with no markdown left in its text", () => {
    for (const page of rulebookPages()) {
      const text = parseBook(page.md).map(blockText).join(" ");
      assert.ok(!/\*\*|__|\]\(/.test(text), `${page.id} leaves markdown behind`);
      assert.ok(!/(^|\s)#{1,6}\s/.test(text), `${page.id} leaves a heading mark behind`);
    }
  });

  await test("headings, tables, captions, lists and sidebars parse", () => {
    const blocks = parseBook(
      [
        "Some **bold** words.",
        "",
        "## Grappling",
        "",
        "**Table- The Barbarian**",
        "",
        "| Level | Rages |",
        "|:-----:|------:|",
        "| 1st   | 2     |",
        "|       |       |",
        "",
        "- one",
        "  carried on",
        "- two",
        "",
        "># Combat Step by Step",
        ">",
        ">1. **Determine surprise.** The GM decides.",
        "",
        "## Grappling",
      ].join("\n"),
    );
    assert.deepEqual(
      blocks.map((block) => block.kind),
      ["paragraph", "heading", "table", "list", "sidebar", "heading"],
    );
    const table = blocks[2];
    assert.equal(table.caption, "The Barbarian");
    assert.deepEqual(table.align, ["center", "right"]);
    assert.deepEqual(table.rows, [["1st", "2"]], "the empty trailing row is dropped");
    assert.deepEqual(blocks[3].items, ["one carried on", "two"]);
    assert.equal(blocks[4].title, "Combat Step by Step");
    assert.equal(blocks[4].anchor, "combat-step-by-step");
    assert.equal(blocks[4].blocks[0].kind, "list");
    assert.equal(blocks[1].anchor, "grappling");
    assert.equal(blocks[5].anchor, "grappling-2", "a repeated heading gets its own anchor");
  });

  await test("inline runs: bold italic, italic, links, and stray asterisks", () => {
    const nodes = parseInline("***Bite***. *Melee Weapon Attack:* +14 to hit, see [Nightmare](page:nightmare).");
    assert.equal(nodes[0].bold && nodes[0].italic, true);
    assert.equal(inlineText(nodes), "Bite. Melee Weapon Attack: +14 to hit, see Nightmare.");
    const link = nodes.find((node) => typeof node !== "string" && node.page);
    assert.equal(link.page, "nightmare");
    assert.equal(stripInline("*If you lose your book"), "If you lose your book", "an unclosed opener is dropped");
    assert.equal(stripInline("2 * 3 = 6"), "2 * 3 = 6", "a spaced asterisk is kept");
    assert.equal(stripInline("[a site](https://example.com)"), "a site", "outside links become plain text");
    assert.equal(anchorSlug("Two-Weapon Fighting"), "two-weapon-fighting");
  });

  // ---- search ----
  await test("stems join the forms of a word", () => {
    assert.equal(stem("grappling"), stem("grapple"));
    assert.equal(stem("grappled"), stem("grapple"));
    assert.equal(stem("attacks"), stem("attack"));
    assert.equal(stem("abilities"), stem("ability"));
    assert.deepEqual(queryTerms("the rules of hiding"), [stem("rules"), stem("hiding")]);
    assert.deepEqual(queryTerms("the"), ["the"], "a query of only stop words still searches");
  });

  const top = (query) => rulebookSearch(query).hits[0];
  await test("search puts the rule itself first", () => {
    assert.deepEqual([top("grapple").page, top("grapple").at], ["combat", "grappling"]);
    assert.deepEqual([top("opportunity attack").page, top("opportunity attack").at], ["combat", "opportunity-attacks"]);
    assert.deepEqual([top("concentration").page, top("concentration").at], ["spellcasting", "concentration"]);
    assert.deepEqual([top("long rest").page, top("long rest").at], ["adventuring", "long-rest"]);
    assert.deepEqual([top("exhaustion").page, top("exhaustion").at], ["conditions", "exhaustion"]);
    assert.deepEqual([top("sneak attack").page, top("sneak attack").at], ["rogue", "sneak-attack"]);
  });

  await test("search finds an entry by its name", () => {
    assert.equal(top("fireball").page, "fireball");
    assert.equal(top("Bag of Holding").page, "bag-of-holding");
    assert.equal(top("adult red dragon").page, "adult-red-dragon-chromatic");
  });

  await test("search reads a half-typed last word", () => {
    const pages = rulebookSearch("grapp").hits.map((hit) => hit.page);
    assert.ok(pages.includes("combat"));
    assert.ok(rulebookSearch("zzzzqx").hits.length === 0);
    assert.deepEqual(rulebookSearch("   ").hits, []);
  });

  await test("search keeps at most three passages a page and forty in all", () => {
    const { hits } = rulebookSearch("attack");
    assert.ok(hits.length <= 40);
    const perPage = new Map();
    for (const hit of hits) perPage.set(hit.page, (perPage.get(hit.page) ?? 0) + 1);
    assert.ok([...perPage.values()].every((count) => count <= 3));
  });

  await test("a snippet opens near the first word that matched", () => {
    const text = `${"Filler words. ".repeat(40)}The grappled creature is held fast.`;
    const snippet = snippetFor(text, [stem("grapple")]);
    assert.match(snippet, /grappled/);
    assert.ok(snippet.length < 240);
    assert.equal(snippetFor("Short text.", ["x"]), "Short text.");
  });

  // ---- the routes ----
  const { createUser } = await import("../src/lib/db/users.ts");
  const { mintSession } = await import("../src/lib/auth.ts");
  const contentsRoute = await import("../src/app/api/rulebook/route.ts");
  const pageRoute = await import("../src/app/api/rulebook/pages/[id]/route.ts");
  const searchRoute = await import("../src/app/api/rulebook/search/route.ts");
  const params = (id) => ({ params: Promise.resolve({ id }) });

  await test("the routes are closed to a caller who is not signed in", async () => {
    globalThis.__odmTestToken = "";
    assert.equal((await contentsRoute.GET()).status, 401);
    assert.equal((await pageRoute.GET(new Request("http://x/api/rulebook/pages/combat"), params("combat"))).status, 401);
    assert.equal((await searchRoute.GET(new Request("http://x/api/rulebook/search?q=cover"))).status, 401);
  });

  await test("a signed-in reader gets contents, pages and search", async () => {
    const user = createUser(`reader-${randomBytes(3).toString("hex")}`, "x");
    globalThis.__odmTestToken = mintSession(user.id).token;
    const contents = await (await contentsRoute.GET()).json();
    assert.equal(contents.chapters.length, 17);
    assert.equal(contents.chapters[0].entries[0].md, undefined, "the contents carry no page text");
    const combat = await pageRoute.GET(new Request("http://x/api/rulebook/pages/combat"), params("combat"));
    assert.equal(combat.status, 200);
    assert.match((await combat.json()).page.md, /Initiative/);
    const missing = await pageRoute.GET(new Request("http://x"), params("../etc/passwd"));
    assert.equal(missing.status, 404);
    const found = await (await searchRoute.GET(new Request("http://x/api/rulebook/search?q=cover"))).json();
    assert.equal(found.hits[0].at, "cover");
    const long = await searchRoute.GET(new Request(`http://x/api/rulebook/search?q=${"a".repeat(5000)}`));
    assert.equal(long.status, 200, "an overlong query is cut, not refused");
  });

  console.log(`\n${passed} rulebook checks passed`);
} finally {
  globalThis.__odmTestToken = "";
  removeTempDir(dir);
}
