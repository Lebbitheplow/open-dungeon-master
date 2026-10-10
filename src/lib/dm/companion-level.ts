import { admitSheet } from "@/lib/characters/admit";
import { tableAuthors } from "@/lib/db/homebrew";
import {
  classGrantsFor,
  featFactsFor,
  raceGrantsFor,
  spellFactsFor,
  subclassIsOffered,
} from "@/lib/characters/catalog";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { defaultRng } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import type {
  Ability,
  AbilityScores,
  CharacterSheet,
  CreateSheetInput,
  Spellcasting,
} from "@/lib/schemas/sheet";
import { levelForXp } from "@/lib/srd";
import { applyAsiChoices, earnedAsiCountFor } from "@/lib/srd/asi";
import { asiTaken } from "@/lib/srd/asi-ledger";
import {
  abilityPriority,
  companionImprovements,
  companionSpellPicks,
} from "@/lib/srd/companion-build";
import { fixedDieValue, levelHpGain } from "@/lib/srd/hit-points";
import { castingClassesOf } from "@/lib/srd/legality/spells";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";
import { buildLevelUp, type LevelUpContext, type LevelUpRequest } from "@/lib/srd/level-up";
import { levelUpSpells } from "@/lib/srd/level-up-spells";
import { classListFor } from "@/lib/srd/multiclass";
import { checklistSpellsOn } from "@/lib/srd/spell-lists";
import { casterViewsOf, spellStyleFor, type CasterView } from "@/lib/srd/spell-prep";

// A companion's sheet is made and levelled by the same rules as a player's:
// the legality check at the door (src/lib/characters/admit.ts, the "engine"
// door) and the level-up builder (src/lib/srd/level-up.ts). What differs is
// who chooses. The engine chooses for a companion (src/lib/srd/
// companion-build.ts), and this module is where those choices meet the
// database. Must not import turn.ts, loop.ts, encounter-tools.ts,
// enemy-damage.ts or mutations.ts, for the reason companion-tools.ts gives.

const lower = (value: string) => value.trim().toLowerCase();

function emptyView(classId: string, ability: CasterView["ability"], level: number): CasterView {
  return {
    classId,
    ability,
    level,
    subclass: "",
    style: spellStyleFor(classId),
    known: [],
    prepared: [],
    cantrips: [],
    pending: [],
    spellbook: [],
  };
}

export type CompanionDraft = {
  campaign: Campaign;
  level: number;
  // The sheet as drafted: base scores with the race's increase in them, no
  // improvements yet, and no spell lists.
  sheet: CreateSheetInput;
  // Spells whoever recruited them asked for.
  wantedSpells: string[];
};

export type CompanionSheet =
  | { ok: true; sheet: CreateSheetInput; notes: string[] }
  | { ok: false; error: string };

// A drafted companion as a legal character of its level: the improvements
// its class has earned by then, a spell list the class's tables allow, and
// every derived number written by the legality check.
export function legalCompanionSheet(draft: CompanionDraft): CompanionSheet {
  const { campaign, level } = draft;
  const notes: string[] = [];
  const klass = classGrantsFor(draft.sheet.class);
  if (!klass) {
    // A class no table describes has nothing to be derived from.
    return { ok: true, sheet: draft.sheet, notes };
  }
  const classes = [{ id: klass.id, subclass: "", level }];
  const asiChoices = companionImprovements(
    draft.sheet.abilities,
    abilityPriority(klass),
    earnedAsiCountFor(classes),
  );
  const abilities = applyAsiChoices(draft.sheet.abilities, asiChoices);

  let spellcasting: Spellcasting = null;
  const [casting] = castingClassesOf(classes, classGrantsFor);
  if (casting) {
    const spellOf = (name: string) => spellFactsFor(name, tableAuthors(campaign.id));
    const before = emptyView(klass.id, casting.ability, level);
    const picks = companionSpellPicks({
      before,
      level,
      abilities,
      firstLevel: true,
      freeCantrips: 0,
      candidates: checklistSpellsOn(casting.list),
      wanted: draft.wantedSpells.map((name) => spellOf(name)?.name ?? name),
    });
    const passed = draft.wantedSpells.filter(
      (name) => !picks.some((pick) => lower(pick) === lower(spellOf(name)?.name ?? name)),
    );
    if (passed.length) {
      notes.push(
        `${passed.join(", ")} ${passed.length === 1 ? "is" : "are"} not within a level ${level} ${klass.name}'s reach (off the class's list, above its slots, or past the number it holds), so ${passed.length === 1 ? "it was" : "they were"} left off.`,
      );
    }
    const filed = levelUpSpells({
      before,
      level,
      subclass: "",
      list: casting.list,
      firstLevel: true,
      abilities,
      freeCantrips: 0,
      spellOf,
      picks: { kind: "picks", spells: picks },
    });
    const view = "error" in filed ? before : filed.view;
    spellcasting = {
      ability: casting.ability,
      slots: {},
      known: view.known,
      prepared: view.prepared,
      cantrips: view.cantrips,
      ...(view.style === "spellbook" ? { spellbook: view.spellbook } : {}),
    };
  }

  const admitted = admitSheet({
    door: "engine",
    level,
    sheet: { ...draft.sheet, abilities, asiChoices, spellcasting },
    userId: campaign.ownerUserId,
    campaign,
  });
  if (!admitted.ok) {
    return { ok: false, error: admitted.problems[0] ?? "That companion is not within the rules." };
  }
  return { ok: true, sheet: admitted.sheet, notes };
}

function contextFor(campaign: Campaign, sheet: CharacterSheet): LevelUpContext {
  const owner = tableAuthors(campaign.id);
  return {
    hpMethod: campaign.gameSettings.hpMethod ?? "average",
    // A companion keeps to the class it was recruited in.
    multiclassAllowed: false,
    classOf: classGrantsFor,
    racialCantrips: raceGrantsFor(sheet.race, owner)?.cantripChoice?.count ?? 0,
    spellOf: (name) => spellFactsFor(name, owner),
    featOf: (name) => featFactsFor(name, owner),
    subclassOffered: (classId, name) => subclassIsOffered(classId, name, owner),
    rollDie: defaultRng,
  };
}

// One level, with the companion's own choices, through the builder every
// level-up goes through. Null when the rules refuse the level (a companion
// at 0 hit points levels once it is back on its feet).
function levelOnce(campaign: Campaign, sheet: CharacterSheet): CharacterSheet | null {
  const [leading] = classListFor(sheet);
  const klass = classGrantsFor(leading.id);
  if (!klass) {
    // No table for the class: the level, and what any level brings (hit
    // dice, the fixed hit points of the die the sheet holds).
    if (sheet.currentHp <= 0 || sheet.deathSaves?.dead) {
      return null;
    }
    const gain = levelHpGain(fixedDieValue(Number(sheet.hitDice.die.slice(1))), sheet.abilities.con);
    return patchSheet(sheet.id, {
      level: sheet.level + 1,
      maxHp: sheet.maxHp + gain,
      currentHp: sheet.currentHp + gain,
    });
  }
  const after = classListFor(sheet).map((entry, index) =>
    index === 0 ? { ...entry, level: entry.level + 1 } : entry,
  );
  const owed = Math.max(0, earnedAsiCountFor(after) - asiTaken(sheet));
  const asiChoices = companionImprovements(sheet.abilities, abilityPriority(klass), owed);
  const abilities = applyAsiChoices(sheet.abilities, asiChoices);

  let picks: string[] = [];
  const casting = castingClassesOf(after, classGrantsFor).find(
    (entry) => lower(entry.entry.id) === lower(leading.id),
  );
  if (casting) {
    const held = casterViewsOf(sheet).find(
      (view) => !sheet.spellcasting?.casters?.length || lower(view.classId) === lower(leading.id),
    );
    picks = companionSpellPicks({
      before: held
        ? { ...held, classId: leading.id, level: leading.level }
        : emptyView(leading.id, casting.ability, leading.level),
      level: leading.level + 1,
      abilities,
      firstLevel: !held,
      freeCantrips: 0,
      candidates: checklistSpellsOn(casting.list),
    });
  }

  const request: LevelUpRequest = {
    level: sheet.level + 1,
    levelUpClass: leading.id,
    ...(asiChoices.length ? { asiChoices } : {}),
  };
  const context = contextFor(campaign, sheet);
  let built = buildLevelUp(
    sheet,
    picks.length ? { ...request, levelUpSpells: picks } : request,
    context,
  );
  if ("error" in built && picks.length) {
    // The level is not held up by a spell the tables would not take.
    built = buildLevelUp(sheet, request, context);
  }
  if ("error" in built) {
    return null;
  }
  return patchSheet(sheet.id, built.patch);
}

function improvedScores(before: AbilityScores, after: AbilityScores): string {
  const raised = (Object.keys(after) as Ability[])
    .filter((ability) => after[ability] > before[ability])
    .map((ability) => `${ABILITY_NAMES[ability]} ${after[ability]}`);
  return raised.length ? ` Improved: ${raised.join(", ")}.` : "";
}

// Companions have no level-up dialog, so an XP award that crosses a level
// threshold levels them on the spot, one level after another, each built
// from the companion's own choices: hit points by the table's method, the
// improvements its class has earned, new spells for a caster. A subclass is
// a matter of who the character is, and stays as whoever made them left it.
export function autoLevelCompanion(campaign: Campaign, sheetId: string): string | null {
  const start = getSheetById(sheetId);
  if (!start?.isCompanion) {
    return null;
  }
  const target = levelForXp(start.xp);
  let sheet = start;
  while (sheet.level < target) {
    const next = levelOnce(campaign, sheet);
    if (!next || next.level <= sheet.level) {
      break;
    }
    sheet = next;
  }
  if (sheet.level === start.level) {
    return null;
  }
  publishPersisted(campaign.id, "sheet_updated", { sheet });
  insertCharacterEvent({
    libraryCharacterId: null,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "level_up",
    summary: `${sheet.name} reached level ${sheet.level}.`,
  });
  return `${sheet.name} leveled up to ${sheet.level} automatically (companions level with the party).${improvedScores(start.abilities, sheet.abilities)}`;
}
