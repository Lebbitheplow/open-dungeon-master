// What a character is trained in, from what grants it.
//
// A class gives two saving throws, its armor, weapon and tool training and a
// count of skills from its own list; a background gives skills, tools and
// languages; a race gives what its traits say; a class taken second gives the
// multiclass row and never a saving throw. Training is derived and written by
// the server. Skills, expertise and chosen languages are the player's picks,
// so they are checked: every pick needs a grant that offers it.
import type { Ability, ClassEntry, Proficiencies } from "@/lib/schemas/sheet";
import { findSkill } from "@/lib/srd";
import { expertiseSlotsFor } from "@/lib/srd/features";
import { multiclassGrantsFor } from "@/lib/srd/multiclass";
import { repeatedGrants } from "@/lib/srd/racial-grants";
import {
  splitToolGrants,
  toolChoiceOf,
  toolPickProblem,
  toolPicksOwed,
} from "@/lib/srd/tool-choices";
import {
  lower,
  uniqueNames,
  type BackgroundGrants,
  type ClassGrants,
  type RaceGrants,
} from "@/lib/srd/legality/types";

export type ProficiencyInput = {
  sent: Proficiencies;
  classes: ClassEntry[];
  classOf: (classId: string) => ClassGrants | null;
  race: RaceGrants;
  background: BackgroundGrants | null;
  racialTool: string;
  // Training the stored character already holds, on an edit: earned in play
  // (a second class's pick, a DM's grant) and kept.
  held?: Proficiencies | null;
  // A character made here names the tools an open grant leaves to it ("three
  // musical instruments"). A stored one may still carry the grant's words.
  requireToolPicks?: boolean;
};

export type ProficiencyVerdict = { problems: string[]; proficiencies: Proficiencies };

type Slot = { label: string; count: number; from: Set<string> | null };

// Every pick placed on a slot that offers it, or null when they cannot all
// be. The lists are a handful long, so plain backtracking is enough.
function placePicks(picks: string[], slots: Slot[]): boolean {
  const left = slots.map((slot) => slot.count);
  // The pick with the fewest slots open to it goes first.
  const ordered = [...picks].sort(
    (a, b) =>
      slots.filter((slot) => !slot.from || slot.from.has(a)).length -
      slots.filter((slot) => !slot.from || slot.from.has(b)).length,
  );
  const place = (index: number): boolean => {
    if (index === ordered.length) {
      return true;
    }
    for (let slot = 0; slot < slots.length; slot += 1) {
      if (left[slot] > 0 && (!slots[slot].from || slots[slot].from!.has(ordered[index]))) {
        left[slot] -= 1;
        if (place(index + 1)) {
          return true;
        }
        left[slot] += 1;
      }
    }
    return false;
  };
  return place(0);
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function judgeProficiencies(input: ProficiencyInput): ProficiencyVerdict {
  const problems: string[] = [];
  const { sent, race, background, held } = input;
  const [first, ...others] = input.classes;
  const primary = input.classOf(first.id);
  const heldSkills = new Set((held?.skills ?? []).map(lower));
  const heldLanguages = new Set((held?.languages ?? []).map(lower));

  // ---- training: one legal answer, so it is written, not read ----
  const secondary = others.map((entry) => multiclassGrantsFor(entry.id));
  const armor = uniqueNames([
    ...(primary?.armor ?? []),
    ...(race.armor ?? []),
    ...secondary.flatMap((grant) => grant.armor),
    ...(held?.armor ?? []),
  ]);
  const weapons = uniqueNames([
    ...(primary?.weapons ?? []),
    ...(race.weapons ?? []),
    ...secondary.flatMap((grant) => grant.weapons),
    ...(held?.weapons ?? []),
  ]);
  const toolChoice = race.toolChoice;
  const racialTool =
    toolChoice && toolChoice.from.some((tool) => lower(tool) === lower(input.racialTool))
      ? input.racialTool
      : "";
  if (input.racialTool && !racialTool) {
    problems.push(
      `${input.racialTool} is not a tool the ${race.name} may choose${toolChoice ? `; pick one of ${toolChoice.from.join(", ")}` : ""}.`,
    );
  }
  // A grant that leaves the tool to the player ("three musical
  // instruments", "one gaming set") is answered by named tools. A sheet that
  // names none keeps the grant's own wording, as sheets stored before the
  // choice existed do.
  const granted = splitToolGrants([
    ...(primary?.tools ?? []),
    ...(background?.tools ?? []),
    ...secondary.flatMap((grant) => grant.tools),
  ]);
  const fixedTools = uniqueNames([...granted.fixed, ...(race.tools ?? []), racialTool].filter(Boolean));
  const heldTools = new Set((held?.tools ?? []).map(lower));
  const fixedToolKeys = new Set(fixedTools.map(lower));
  const toolPicks = uniqueNames(
    (sent.tools ?? []).filter(
      (tool) => !toolChoiceOf(tool) && !fixedToolKeys.has(lower(tool)) && !heldTools.has(lower(tool)),
    ),
  ).map(lower);
  let chosenTools: string[] = [];
  if (granted.choices.length && toolPicks.length) {
    const problem = toolPickProblem(granted.choices, toolPicks);
    if (problem) {
      problems.push(problem);
    }
    chosenTools = toolPicks;
  }
  if (input.requireToolPicks && granted.choices.length) {
    // Picks kept from the stored character (an edit) answer their choice too.
    const named = (sent.tools ?? []).filter((tool) => !toolChoiceOf(tool) && !fixedToolKeys.has(lower(tool)));
    const owed = toolPicksOwed(granted.choices, named);
    if (owed && !problems.some((problem) => problem.startsWith("Choose "))) {
      problems.push(owed);
    }
  }
  // In the grants' own order; the named picks take the place of the words.
  const answered = (tool: string) => !(chosenTools.length && toolChoiceOf(tool));
  const tools = uniqueNames([
    ...(primary?.tools ?? []).filter(answered),
    ...(background?.tools ?? []).filter(answered),
    ...(race.tools ?? []),
    racialTool,
    ...secondary.flatMap((grant) => grant.tools).filter(answered),
    ...chosenTools,
    ...(held?.tools ?? []),
  ]);
  const saves = uniqueNames([...(primary?.saves ?? []), ...(held?.saves ?? [])]) as Ability[];

  // ---- skills ----
  const fixed = uniqueNames([...(background?.skills ?? []), ...(race.skills ?? [])].map(lower));
  const sentSkills = uniqueNames(sent.skills.map(lower));
  for (const skill of sentSkills) {
    if (!findSkill(skill)) {
      problems.push(`"${skill}" is not one of the eighteen skills.`);
    }
  }
  const picks = sentSkills.filter(
    (skill) => findSkill(skill) && !fixed.includes(skill) && !heldSkills.has(skill),
  );
  const slots: Slot[] = [];
  if (background?.skillChoice) {
    slots.push({
      label: `${background.name}`,
      count: background.skillChoice.count,
      from: new Set(background.skillChoice.from.map(lower)),
    });
  }
  if (primary) {
    slots.push({
      label: primary.name,
      count: primary.skillChoices.count,
      from: primary.skillChoices.from.length
        ? new Set(primary.skillChoices.from.map(lower))
        : null,
    });
  }
  if (race.skillChoice) {
    slots.push({ label: race.name, count: race.skillChoice.count, from: null });
  }
  // The same skill from the background and the race: the player chooses
  // another in its place (SRD 5.1, Backgrounds).
  const repeated = repeatedGrants(background?.skills, race.skills).length;
  if (repeated) {
    slots.push({ label: "the repeated grant", count: repeated, from: null });
  }
  secondary.forEach((grant, index) => {
    if (grant.skillChoice) {
      slots.push({
        label: others[index].id,
        count: grant.skillChoice.count,
        from: grant.skillChoice.from.length ? new Set(grant.skillChoice.from.map(lower)) : null,
      });
    }
  });
  if (picks.length && !placePicks(picks, slots)) {
    const offered = slots
      .map(
        (slot) =>
          `${plural(slot.count, "skill")} from ${slot.label}${slot.from ? ` (${[...slot.from].join(", ")})` : " (any)"}`,
      )
      .join("; ");
    problems.push(
      `The skills chosen (${picks.join(", ")}) are more than, or other than, what this character is offered: ${offered || "no skill of their choice"}. ${fixed.length ? `${fixed.join(" and ")} come with the background and race.` : ""}`.trim(),
    );
  }
  const skills = uniqueNames([
    ...fixed,
    ...(held?.skills ?? []).map(lower).filter((skill) => findSkill(skill)),
    ...sentSkills.filter((skill) => findSkill(skill)),
  ]);

  // ---- expertise ----
  const heldExpertise = new Set((held?.expertise ?? []).map(lower));
  const expertise = uniqueNames([...(held?.expertise ?? []), ...(sent.expertise ?? [])].map(lower));
  const unproficient = expertise.filter((skill) => !skills.includes(skill));
  if (unproficient.length) {
    problems.push(
      `Expertise doubles a proficiency the character has; ${unproficient.join(", ")} ${unproficient.length === 1 ? "is" : "are"} not among their skills.`,
    );
  }
  const expertiseSlots = input.classes.reduce(
    (sum, entry) => sum + expertiseSlotsFor(entry.id, entry.level),
    0,
  );
  const expertisePicks = expertise.filter((skill) => !heldExpertise.has(skill));
  if (expertisePicks.length > Math.max(0, expertiseSlots - heldExpertise.size)) {
    problems.push(
      expertiseSlots
        ? `This character has earned expertise in ${plural(expertiseSlots, "skill")}, not ${expertise.length}.`
        : `Expertise is a rogue's feature (1st and 6th level) and a bard's (3rd and 10th); this character has none to pick.`,
    );
  }

  // ---- languages ----
  const spoken = uniqueNames([
    ...race.languages,
    ...input.classes.flatMap((entry) => input.classOf(entry.id)?.languages ?? []),
    ...(background?.knownLanguages ?? []),
  ]);
  const spokenKeys = new Set(spoken.map(lower));
  const chosen = uniqueNames(sent.languages).filter(
    (language) => !spokenKeys.has(lower(language)) && !heldLanguages.has(lower(language)),
  );
  const languageSlots = (race.bonusLanguages ?? 0) + (background?.languages ?? 0);
  if (chosen.length > languageSlots) {
    problems.push(
      `${race.name}${background ? ` and ${background.name}` : ""} give ${plural(languageSlots, "language")} of the player's choice; ${chosen.length} were chosen (${chosen.join(", ")}).`,
    );
  }
  const languages = uniqueNames([
    ...spoken,
    ...(held?.languages ?? []),
    ...chosen,
  ]);

  return {
    problems,
    proficiencies: { saves, skills, expertise, languages, tools, armor, weapons },
  };
}
