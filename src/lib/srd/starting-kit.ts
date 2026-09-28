// A new character's free kit: its class's starting equipment with the
// either-or choices it made (SRD 5.1, "Starting Equipment" in each class).
// Pure: the kits are data (src/lib/srd/starting-kit-data.ts,
// src/lib/srd/genre-kits.ts), and the weapons a slot may take come from the
// weapon table. The server (src/lib/srd/sheet-legality.ts), the builder
// (src/app/characters/builder) and the engine's companions all resolve a kit
// here, so the three can never disagree about what a class starts with.
import { defaultArmor } from "@/lib/srd/armor";
import { GENRE_KITS } from "@/lib/srd/genre-kits";
import {
  CLASS_KITS,
  INSTRUMENTS,
  type ClassKit,
  type KitItem,
  type KitOption,
  type KitSlot,
} from "@/lib/srd/starting-kit-data";
import { SRD_WEAPONS, defaultLoadout } from "@/lib/srd/weapons";

export type { ClassKit, KitItem, KitLine, KitOption, KitSlot } from "@/lib/srd/starting-kit-data";

// The choices a request makes, stored on the sheet so the builder reopens
// with them: for each line of the class's kit, in order, the option taken
// (0 is the book's (a)); and for each open slot of the options taken, in
// order, the item named for it.
export type KitChoices = { options: number[]; picks: string[] };

const lower = (value: string) => value.trim().toLowerCase();

export function classKitFor(classId: string): ClassKit | null {
  const id = lower(classId).replace(/-/g, "_");
  return CLASS_KITS[id] ?? GENRE_KITS[id] ?? null;
}

// Weapons of ODM's settings that the table files under "simple". "Any simple
// weapon" in an SRD kit means the SRD's.
const SETTING_SIMPLE = new Set(["Machete", "Crowbar", "Silvered Stake", "Censer Mace", "Hurled Vial"]);

// What a slot may be filled with, in the weapon table's order.
export function slotChoices(slot: KitSlot): string[] {
  if (slot.filter === "instrument") {
    return INSTRUMENTS.filter((name) => !(slot.except ?? []).includes(name));
  }
  const category = slot.filter.startsWith("simple") ? "simple" : "martial";
  const meleeOnly = slot.filter.endsWith("-melee");
  return SRD_WEAPONS.filter(
    (weapon) =>
      weapon.category === category &&
      (!meleeOnly || weapon.kind === "melee") &&
      !SETTING_SIMPLE.has(weapon.name),
  ).map((weapon) => weapon.name);
}

const SLOT_WORDS: Record<KitSlot["filter"], string> = {
  simple: "a simple weapon",
  "simple-melee": "a simple melee weapon",
  martial: "a martial weapon",
  "martial-melee": "a martial melee weapon",
  instrument: "a musical instrument",
};

export function describeSlot(slot: KitSlot): string {
  return slot.except?.length ? `${SLOT_WORDS[slot.filter]} other than the ${slot.except.join(", ")}` : SLOT_WORDS[slot.filter];
}

// Domains whose bonus proficiencies reach the cleric kit's "(if proficient)"
// options: heavy armor for Life (SRD 5.1) and the Player's Handbook's
// Nature, Tempest and War (with Forge, Order and Twilight from later books);
// martial weapons, and so the warhammer, for Tempest, War and Twilight.
const HEAVY_DOMAINS = ["life", "nature", "tempest", "war", "forge", "order", "twilight"];
const MARTIAL_DOMAINS = ["tempest", "war", "twilight"];

export type KitTraining = { armor: string[]; weapons: string[]; subclass?: string };

function domainOf(subclass: string | undefined, list: string[]): boolean {
  const name = lower(subclass ?? "").replace(/\s*domain\s*/g, "");
  return list.includes(name);
}

// Whether a character may take an option: false only for an "(if
// proficient)" option it lacks the training for.
export function optionAllowed(option: KitOption, who: KitTraining): boolean {
  if (option.requires === "heavy-armor") {
    return who.armor.some((term) => lower(term).includes("heavy")) || domainOf(who.subclass, HEAVY_DOMAINS);
  }
  if (option.requires === "warhammer") {
    return (
      who.weapons.some((term) => /martial|warhammer/.test(lower(term))) ||
      domainOf(who.subclass, MARTIAL_DOMAINS)
    );
  }
  return true;
}

export type ResolvedKit = {
  items: KitItem[];
  // The choices as the server reads them: every line answered, every slot
  // named, so a sheet stored with them reopens exactly.
  choices: KitChoices;
  problems: string[];
};

// Adds items to a list, one row per name.
export function mergeItems(into: KitItem[], items: KitItem[]): KitItem[] {
  const out = into.map((item) => ({ ...item }));
  for (const item of items) {
    const held = out.find((entry) => lower(entry.name) === lower(item.name));
    if (held) {
      held.qty += item.qty;
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

// The kit a class's choices come to. A line the request did not answer
// takes the book's first option, and a slot it did not name the slot's
// default: the kit is an allowance, so an unanswered choice gives the least
// surprising reading rather than a refusal. An answer outside the book is
// refused, in words that say what the line offers.
export function resolveKit(
  kit: ClassKit,
  sent: Partial<KitChoices> | null | undefined,
  who: KitTraining,
  className = "class",
): ResolvedKit {
  const problems: string[] = [];
  const options: number[] = [];
  const picks: string[] = [];
  const sentPicks = sent?.picks ?? [];
  let items: KitItem[] = [];
  kit.lines.forEach((line, index) => {
    const asked = sent?.options?.[index];
    let chosen = typeof asked === "number" ? asked : 0;
    if (!line.options[chosen]) {
      problems.push(
        `The ${className}'s starting equipment offers ${line.options.map((option) => option.label).join(" or ")}; choose one of them.`,
      );
      chosen = 0;
    }
    const option = line.options[chosen];
    if (!optionAllowed(option, who)) {
      problems.push(
        `The ${className}'s starting equipment gives ${option.label} only to a character trained for it; choose ${line.options.filter((other) => other !== option && optionAllowed(other, who)).map((other) => other.label).join(" or ")}.`,
      );
    }
    options.push(chosen);
    items = mergeItems(items, option.items);
    for (const slot of option.slots ?? []) {
      const named = (sentPicks[picks.length] ?? "").trim();
      const allowed = slotChoices(slot);
      const match = named ? allowed.find((name) => lower(name) === lower(named)) : slot.default;
      if (!match) {
        problems.push(
          `${named} is not ${describeSlot(slot)}, which is what the ${className}'s "${option.label}" gives; choose one from the weapon table.`,
        );
      }
      const name = match ?? slot.default;
      picks.push(name);
      items = mergeItems(items, [{ name, qty: 1 }]);
    }
  });
  return { items, choices: { options, picks }, problems };
}

// The book's first option of every line and every slot's default: what a
// companion the engine drafts carries.
export function firstChoicesKit(kit: ClassKit): KitItem[] {
  return resolveKit(kit, null, { armor: ["heavy"], weapons: ["martial"] }).items;
}

// The kit a class starts with for a caller that holds a class row: its
// table when it has one, and for a class no table describes (a content
// pack's own) the weapons and armor its training suggests, as before.
export function startingKitFor(
  klass: { id: string; armor: string[]; weapons: string[] },
  sent: Partial<KitChoices> | null | undefined,
  subclass = "",
  className?: string,
): ResolvedKit & { tabled: boolean } {
  const kit = classKitFor(klass.id);
  if (kit) {
    return {
      ...resolveKit(kit, sent, { armor: klass.armor, weapons: klass.weapons, subclass }, className ?? klass.id),
      tabled: true,
    };
  }
  const items = [...defaultLoadout(klass.weapons), ...defaultArmor(klass.armor)].map((item) => ({
    name: item.name,
    qty: 1,
  }));
  return { items, choices: { options: [], picks: [] }, problems: [], tabled: false };
}

// One name per piece, the way the purse check counts a free kit.
export function kitNames(items: KitItem[]): string[] {
  return items.flatMap((item) => Array.from({ length: Math.min(item.qty, 999) }, () => item.name));
}

// The open slots of each line, for the options taken: where each line's
// picks sit in `picks`.
export function kitSlotsByLine(kit: ClassKit, options: number[]): Array<{ start: number; slots: KitSlot[] }> {
  let start = 0;
  return kit.lines.map((line, index) => {
    const slots = (line.options[options[index] ?? 0] ?? line.options[0]).slots ?? [];
    const entry = { start, slots };
    start += slots.length;
    return entry;
  });
}

// The choices after one line takes another option: that line's slots start
// over at their defaults, and every other line keeps its picks.
export function chooseKitOption(kit: ClassKit, current: KitChoices, line: number, option: number): KitChoices {
  const before = kitSlotsByLine(kit, current.options);
  const options = kit.lines.map((_, index) => (index === line ? option : (current.options[index] ?? 0)));
  const picks = kitSlotsByLine(kit, options).flatMap(({ slots }, index) =>
    index === line
      ? slots.map((slot) => slot.default)
      : slots.map((slot, at) => current.picks[before[index].start + at] ?? slot.default),
  );
  return { options, picks };
}

// The choices after one open slot is filled.
export function pickKitSlot(current: KitChoices, index: number, name: string): KitChoices {
  const picks = current.picks.slice();
  picks[index] = name;
  return { options: current.options.slice(), picks };
}
