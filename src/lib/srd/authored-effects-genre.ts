// The genre classes' at-will features with an action cost (issue 233,
// section 4), in the authored layer's own shapes so its engines carry them:
// a bonus-action route (take_action), a spend (use_resource) and a reaction
// (use_reaction). Their rules text is the catalogs' (src/lib/classes/
// *-features.json), not subclasses.json, so the rows are found by feature
// name (authored-effects.ts heldAuthored), with `classes` naming the genre
// classes a shared name belongs to when it must not reach another class's
// feature of the same name.
//
// Before this every one of them cost nothing: Afterimage's Dash took the
// action, Target Lock was a sentence, Feedback Loop spent the reaction and
// dealt nothing.
import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export type GenreRow = { feature: string; classes?: string[]; entry: AuthoredEntry };

const note = (text: string) => ({ kind: "note" as const, text });

export const GENRE_AUTHORED: GenreRow[] = [
  // ---- the move as a bonus action ----
  { feature: "Afterimage", entry: { subclass: "genre", effects: [{ kind: "bonus_route", action: "dash" }, { kind: "bonus_route", action: "disengage" }] } },
  { feature: "Slippery", entry: { subclass: "genre", effects: [{ kind: "bonus_route", action: "disengage" }, { kind: "bonus_route", action: "hide" }] } },
  { feature: "Escape Artist", entry: { subclass: "genre", effects: [{ kind: "bonus_route", action: "disengage" }, { kind: "bonus_route", action: "hide" }] } },
  { feature: "Rigging Runner", entry: { subclass: "genre", effects: [{ kind: "bonus_route", action: "dash" }] } },
  { feature: "Heavy Hands", entry: { subclass: "genre", effects: [{ kind: "bonus_route", action: "grapple" }] } },
  // ---- marks: the bonus action, then every attack on the creature ----
  {
    feature: "Target Lock",
    entry: { subclass: "genre", spends: [{ name: "Target Lock", action: "bonus", does: { kind: "buff", condition: "target lock", rounds: 600, quarry: true } }] },
  },
  {
    feature: "Hunter's Brand",
    entry: { subclass: "genre", spends: [{ name: "Hunter's Brand", action: "bonus", does: { kind: "buff", condition: "hunter's brand", rounds: 600, quarry: true } }] },
  },
  {
    feature: "Quarry",
    entry: { subclass: "genre", spends: [{ name: "Quarry", action: "bonus", does: { kind: "buff", condition: "quarry", rounds: 600, quarry: true } }] },
  },
  // ---- bonus actions ----
  {
    feature: "Deathly Pact Blade",
    entry: { subclass: "genre", spends: [{ name: "Deathly Pact Blade", action: "bonus", does: note("The bonded weapon is in hand, wherever it was, and it counts as magical.") }] },
  },
  {
    feature: "Ashen Hymn",
    entry: { subclass: "genre", spends: [{ name: "Ashen Hymn", action: "bonus", does: { kind: "buff", condition: "ashen hymn", rounds: 10 } }] },
  },
  {
    feature: "Candlelight Vigil",
    entry: { subclass: "genre", spends: [{ name: "Candlelight Vigil", action: "bonus", does: { kind: "buff", condition: "candlelight vigil", rounds: 10 } }] },
  },
  {
    feature: "Head of Steam",
    entry: { subclass: "genre", spends: [{ name: "Head of Steam", action: "bonus", does: { kind: "buff", condition: "head of steam", rounds: 1 } }] },
  },
  {
    feature: "Tinker's Speed",
    entry: { subclass: "genre", spends: [{ name: "Tinker's Speed", action: "bonus", does: note("A gadget is drawn, swapped or deployed.") }] },
  },
  {
    feature: "Master Uplink",
    entry: { subclass: "genre", spends: [{ name: "Master Uplink", aliases: ["Command Drones", "Command Drone"], action: "bonus", does: note("The drones act on the rigger's command this turn.") }] },
  },
  {
    feature: "Wind-Up Ally",
    entry: { subclass: "genre", spends: [{ name: "Wind-Up Ally", aliases: ["Command Familiar"], action: "bonus", does: note("The familiar acts on the machinist's command this turn.") }] },
  },
  {
    // "your beast attacks when you command it as a bonus action"
    feature: "Extra Attack",
    classes: ["packmaster"],
    entry: { subclass: "genre", spends: [{ name: "Command Beast", aliases: ["Command the Beast"], action: "bonus", does: note("The beast attacks on the packmaster's command this turn.") }] },
  },
  // ---- actions ----
  {
    feature: "Scent of Corruption",
    entry: { subclass: "genre", spends: [{ name: "Scent of Corruption", action: "action", does: note("The GM says whether the creature within 30 feet is a fiend, undead or shapechanger, or under a curse or a charm.") }] },
  },
  {
    feature: "Field Instruments",
    entry: { subclass: "genre", spends: [{ name: "Field Instruments", action: "action", does: note("The GM says whether the supernatural is present within 60 feet, and its rough direction.") }] },
  },
  // ---- reactions ----
  { feature: "ICE Pick", entry: { subclass: "genre", reactions: [{ name: "ICE Pick", does: { kind: "ac_vs_hit", amount: 2 } }] } },
  { feature: "Feedback Loop", entry: { subclass: "genre", reactions: [{ name: "Feedback Loop", does: { kind: "strike_back", amount: "cha", type: "psychic" } }] } },
  { feature: "Barrow Ward", entry: { subclass: "genre", reactions: [{ name: "Barrow Ward", does: { kind: "reduce", amount: "cha+prof", who: "ally", rangeFt: 10 } }] } },
  { feature: "Penance Shared", entry: { subclass: "genre", reactions: [{ name: "Penance Shared", does: { kind: "take_for_ally", rangeFt: 5, share: "halved" } }] } },
  { feature: "The Mark Burns Back", entry: { subclass: "genre", reactions: [{ name: "The Mark Burns Back", does: { kind: "strike_back", amount: "cha+level", type: "necrotic" } }] } },
  { feature: "Bodyguard", entry: { subclass: "genre", reactions: [{ name: "Bodyguard", does: { kind: "take_for_ally", rangeFt: 5 } }] } },
  { feature: "Duelist's Flourish", entry: { subclass: "genre", reactions: [{ name: "Duelist's Flourish", does: { kind: "attack", rangeFt: 5 } }] } },
  { feature: "Intercept Protocol", entry: { subclass: "genre", reactions: [{ name: "Intercept Protocol", does: { kind: "take_for_ally", rangeFt: 5 } }] } },
  { feature: "Blood Bond", entry: { subclass: "genre", reactions: [{ name: "Blood Bond", does: { kind: "take_for_ally", rangeFt: 30, share: "split" } }] } },
];
