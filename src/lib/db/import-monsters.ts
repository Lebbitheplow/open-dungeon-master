import { getDatabase, parseJson } from "@/lib/db/core";
import { resolveMonster } from "@/lib/bestiary";
import { createHomebrewMonster, listHomebrewMonsters, type HomebrewMonster } from "@/lib/bestiary/homebrew-monsters";
import { draftFromData } from "@/lib/bestiary/monster-draft";
import { getCampaignById } from "@/lib/db/campaigns";
import { createHomebrew, getAuthorsHomebrew, listHomebrew, tableAuthors, type HomebrewEntry } from "@/lib/db/homebrew";
import { getWorldDoc, hasWorldDoc, saveWorldDoc } from "@/lib/db/world-forge";
import { rosterMonsters } from "@/lib/db/workshop-bundle-shelf";
import { textKey } from "@/lib/language/text-logic";

// Hand-built monsters across a campaign import between different authors
// (audit finding WF-07). A Cast member's stat block and a fight's roster
// name a monster as "homebrew:<id>", and a hand-built monster is its
// author's: at a table whose authors (src/lib/db/homebrew.ts tableAuthors)
// do not include that author, the reference answered to nothing and the
// NPC or the fight lost its rules. Now the monster travels: copied into the
// target table owner's bestiary, or the owner's identical one reused, and
// the copied rows pointed at it. The import is the authority: whoever may
// import from the source may see what its rows fight as.

const HOMEBREW = "homebrew:";
// A stat block's rules, the same whatever order their keys were saved in.
const stable = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(stable).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`
      : JSON.stringify(value) ?? "";

const homebrewRef = (ref: unknown): ref is string => typeof ref === "string" && ref.trim().startsWith(HOMEBREW) && !ref.trim().startsWith(`${HOMEBREW}@`);

const rosterOf = (json: unknown): string[] => rosterMonsters(parseJson<unknown[]>(typeof json === "string" ? json : "[]", []));

// The hand-built monster refs a campaign's NPCs and fights name.
export function monsterRefsOf(campaignId: string, kinds: { npcs: boolean; encounters: boolean }, only?: { npcs: string[]; encounters: string[] }): string[] {
  const db = getDatabase();
  const refs: string[] = [];
  if (kinds.npcs) {
    const rows = db.prepare(`SELECT id, stat_block FROM npcs WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string; stat_block: unknown }>;
    for (const row of rows) if ((!only || only.npcs.includes(row.id)) && homebrewRef(row.stat_block)) refs.push(row.stat_block.trim());
  }
  if (kinds.encounters) {
    const rows = db.prepare(`SELECT id, enemies_json FROM encounter_templates WHERE campaign_id = ?`).all(campaignId) as Array<{ id: string; enemies_json: unknown }>;
    for (const row of rows) if (!only || only.encounters.includes(row.id)) refs.push(...rosterOf(row.enemies_json).filter(homebrewRef).map((ref) => ref.trim()));
  }
  return [...new Set(refs)];
}

// Of those, the ones the target table cannot use, with the monster each
// names at the source.
export function foreignMonsters(sourceId: string, campaignId: string, refs: string[]): Array<{ ref: string; entry: HomebrewEntry }> {
  const target = getCampaignById(campaignId);
  if (!target) return [];
  const authors = { userIds: tableAuthors(campaignId) };
  const sourceAuthors = tableAuthors(sourceId);
  const out: Array<{ ref: string; entry: HomebrewEntry }> = [];
  for (const ref of new Set(refs)) {
    if (resolveMonster(ref, target.gameSettings, authors)) continue;
    const entry = getAuthorsHomebrew(sourceAuthors, ref.slice(HOMEBREW.length));
    if (entry && entry.kind === "monster") out.push({ ref, entry });
  }
  return out;
}

// The author's own records a campaign's World entries link to, of one kind
// (src/lib/worldforge/model.ts Binding).
export function boundRefsOf(campaignId: string, kind: "monster" | "item"): string[] {
  if (!hasWorldDoc(campaignId)) return [];
  const refs = Object.values(getWorldDoc(campaignId).entries)
    .flatMap((entry) => entry.bindings)
    .filter((binding) => binding.kind === kind && homebrewRef(binding.ref))
    .map((binding) => binding.ref.trim());
  return [...new Set(refs)];
}

// A World entry's links, of one kind, moved to the records that arrived.
function relink(campaignId: string, kind: "monster" | "item", moved: Map<string, string>) {
  if (!moved.size || !hasWorldDoc(campaignId)) return;
  const doc = getWorldDoc(campaignId);
  let changed = false;
  for (const entry of Object.values(doc.entries)) {
    entry.bindings = entry.bindings.map((binding) => {
      const to = binding.kind === kind ? moved.get(binding.ref.trim()) : undefined;
      if (!to) return binding;
      changed = true;
      return { ...binding, ref: to };
    });
  }
  if (changed) saveWorldDoc(campaignId, doc);
}

// After the copy: the monsters the copied NPCs and fights need, and the
// ones the copied World entries link to (`world`), brought into the target
// owner's bestiary, and the copied rows and links pointed at them.
export function bringMonsters(
  sourceId: string,
  campaignId: string,
  copied: { npcs: string[]; encounters: string[] },
  world = false,
): { brought: string[]; reused: string[] } {
  const target = getCampaignById(campaignId);
  const source = getCampaignById(sourceId);
  if (!target || !source) return { brought: [], reused: [] };
  const refs = [
    ...(copied.npcs.length || copied.encounters.length ? monsterRefsOf(campaignId, { npcs: true, encounters: true }, copied) : []),
    ...(world ? boundRefsOf(campaignId, "monster") : []),
  ];
  const foreign = foreignMonsters(sourceId, campaignId, refs);
  if (!foreign.length) return { brought: [], reused: [] };

  const owner = target.ownerUserId;
  const mine = new Map<string, HomebrewMonster>(listHomebrewMonsters(owner).map((monster) => [textKey(monster.draft.name), monster]));
  const moved = new Map<string, string>();
  const brought: string[] = [];
  const reused: string[] = [];
  for (const { ref, entry } of foreign) {
    const draft = draftFromData(entry.name, entry.data);
    const desc = typeof (entry.data as { desc?: unknown }).desc === "string" ? String((entry.data as { desc?: unknown }).desc) : "";
    const held = mine.get(textKey(entry.name));
    if (held && stable(held.draft.stats) === stable(draft.stats)) {
      moved.set(ref, held.slug);
      reused.push(entry.name);
      continue;
    }
    // A monster of that name with other rules is the owner's own: this one
    // arrives beside it under the source's name, as a bundle's does.
    let name = entry.name;
    if (held) {
      const base = `${entry.name} [${source.title}]`.slice(0, 80);
      name = base;
      for (let attempt = 2; mine.has(textKey(name)); attempt += 1) name = `${base.slice(0, 74)} ${attempt}`;
    }
    const made = createHomebrewMonster(owner, { ...draft, name }, desc);
    mine.set(textKey(name), made);
    moved.set(ref, made.slug);
    brought.push(name);
  }

  const db = getDatabase();
  const setStat = db.prepare(`UPDATE npcs SET stat_block = ? WHERE id = ? AND campaign_id = ?`);
  for (const id of copied.npcs) {
    const row = db.prepare(`SELECT stat_block FROM npcs WHERE id = ?`).get(id) as { stat_block: unknown } | undefined;
    const next = homebrewRef(row?.stat_block) ? moved.get(row.stat_block.trim()) : undefined;
    if (next) setStat.run(next, id, campaignId);
  }
  const setRoster = db.prepare(`UPDATE encounter_templates SET enemies_json = ? WHERE id = ? AND campaign_id = ?`);
  for (const id of copied.encounters) {
    const row = db.prepare(`SELECT enemies_json FROM encounter_templates WHERE id = ?`).get(id) as { enemies_json: unknown } | undefined;
    const enemies = parseJson<unknown[]>(typeof row?.enemies_json === "string" ? row.enemies_json : "[]", []);
    if (!Array.isArray(enemies)) continue;
    let changed = false;
    const next = enemies.map((enemy) => {
      const ref = typeof enemy === "string" ? enemy : enemy && typeof enemy === "object" ? (enemy as { monster?: unknown }).monster : undefined;
      const to = homebrewRef(ref) ? moved.get(ref.trim()) : undefined;
      if (!to) return enemy;
      changed = true;
      return typeof enemy === "string" ? to : { ...(enemy as object), monster: to };
    });
    if (changed) setRoster.run(JSON.stringify(next), id, campaignId);
  }
  if (world) relink(campaignId, "monster", moved);
  return { brought, reused };
}

// Hand-built items a World entry links to that the target table's authors
// do not have, with the item each names at the source.
export function foreignItems(sourceId: string, campaignId: string, refs: string[]): Array<{ ref: string; entry: HomebrewEntry }> {
  const targetAuthors = tableAuthors(campaignId);
  const sourceAuthors = tableAuthors(sourceId);
  const out: Array<{ ref: string; entry: HomebrewEntry }> = [];
  for (const ref of new Set(refs)) {
    const id = ref.slice(HOMEBREW.length);
    if (getAuthorsHomebrew(targetAuthors, id)?.kind === "item") continue;
    const entry = getAuthorsHomebrew(sourceAuthors, id);
    if (entry && entry.kind === "item") out.push({ ref, entry });
  }
  return out;
}

// After a world's copy: the items its entries link to, brought into the
// target owner's Homebrew the way monsters are (an identical one reused,
// one of the same name with other rules kept beside it), and the links
// pointed at them. Shops and inventories then find them as this table's.
export function bringItems(sourceId: string, campaignId: string): { brought: string[]; reused: string[] } {
  const target = getCampaignById(campaignId);
  const source = getCampaignById(sourceId);
  if (!target || !source) return { brought: [], reused: [] };
  const foreign = foreignItems(sourceId, campaignId, boundRefsOf(campaignId, "item"));
  if (!foreign.length) return { brought: [], reused: [] };
  const owner = target.ownerUserId;
  const mine = new Map<string, HomebrewEntry>(listHomebrew(owner, "item").map((item) => [textKey(item.name), item]));
  const moved = new Map<string, string>();
  const brought: string[] = [];
  const reused: string[] = [];
  for (const { ref, entry } of foreign) {
    const held = mine.get(textKey(entry.name));
    if (held && stable(held.data) === stable(entry.data)) {
      moved.set(ref, `${HOMEBREW}${held.id}`);
      reused.push(entry.name);
      continue;
    }
    let name = entry.name;
    if (held) {
      const base = `${entry.name} [${source.title}]`.slice(0, 80);
      name = base;
      for (let attempt = 2; mine.has(textKey(name)); attempt += 1) name = `${base.slice(0, 74)} ${attempt}`;
    }
    const made = createHomebrew(owner, { kind: "item", name, data: { desc: "", ...entry.data } as Parameters<typeof createHomebrew>[1]["data"] });
    mine.set(textKey(name), made);
    moved.set(ref, `${HOMEBREW}${made.id}`);
    brought.push(name);
  }
  relink(campaignId, "item", moved);
  return { brought, reused };
}
