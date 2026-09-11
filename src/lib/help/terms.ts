// Plain-language blurbs for the closed vocabularies the workshop's pick
// lists offer: conditions, spell schools, weapon properties, damage types,
// creature sizes. A DM ticking "loading" or "frightened" or "evocation"
// should be able to read what it means without leaving the form, and a
// native <option> cannot carry that, so the forms show one glossary button
// per list (src/components/ui/OptionGlossary.tsx) built from these.

export type GlossaryEntry = { name: string; blurb: string };

export const CONDITION_BLURBS: Record<string, string> = {
  blinded: "Cannot see. Fails any check that needs sight; attacks against it have advantage, its own attacks have disadvantage.",
  charmed: "Cannot attack the charmer or target them with harmful effects; the charmer has advantage on social checks against it.",
  deafened: "Cannot hear. Fails any check that needs hearing.",
  exhaustion: "Six worsening levels, from disadvantage on checks to death. Usually one level clears per long rest.",
  frightened: "Disadvantage on checks and attacks while the source of fear is in sight, and cannot willingly move closer to it.",
  grappled: "Speed becomes 0. Ends if the grappler is incapacitated or the two are forced apart.",
  incapacitated: "Cannot take actions or reactions.",
  invisible: "Cannot be seen without magic or a special sense. Attacks against it have disadvantage, its attacks have advantage.",
  paralyzed: "Incapacitated and cannot move or speak. Auto-fails Strength and Dexterity saves; attacks against it have advantage and hit within 5 feet are critical.",
  petrified: "Turned to stone: incapacitated, unaware, weighs ten times as much, resists all damage, immune to poison and disease.",
  poisoned: "Disadvantage on attack rolls and ability checks.",
  prone: "Must crawl or spend half its movement to stand. Disadvantage on attacks; melee attacks against it have advantage, ranged ones disadvantage.",
  restrained: "Speed 0. Attacks against it have advantage, its attacks have disadvantage, and it has disadvantage on Dexterity saves.",
  stunned: "Incapacitated, cannot move, speaks falteringly. Auto-fails Strength and Dexterity saves; attacks against it have advantage.",
  unconscious: "Incapacitated, unaware, drops what it holds and falls prone. Auto-fails Strength and Dexterity saves; attacks have advantage and hit within 5 feet are critical.",
};

export const SPELL_SCHOOL_BLURBS: Record<string, string> = {
  abjuration: "Protection and banishment: wards, shields, dispelling, and sending things back where they came from.",
  conjuration: "Bringing things into being or across distance: summoned creatures, conjured objects, teleportation.",
  divination: "Knowing: seeing far, reading thoughts, finding what is hidden, glimpsing what is to come.",
  enchantment: "Influencing minds: charm, fear, sleep, suggestion, and commands the target cannot refuse.",
  evocation: "Raw energy: fire, lightning, cold and force, most of the blasting spells and the healing ones.",
  illusion: "Deceiving the senses: images, sounds, disguises and phantasms that are not really there.",
  necromancy: "Life and death: draining vitality, raising the dead, speaking with them, and undoing death.",
  transmutation: "Changing what is: shape, size, substance or speed of creatures and things.",
};

export const WEAPON_PROPERTY_BLURBS: Record<string, string> = {
  ammunition: "Needs arrows, bolts or stones to attack at range; the ammunition is spent as it is fired.",
  finesse: "Attack and damage may use Dexterity instead of Strength, whichever is better.",
  heavy: "Too big for Small creatures to use well: they attack with disadvantage.",
  light: "Small enough to fight with one in each hand (two-weapon fighting).",
  loading: "Slow to reload: only one shot per action, bonus action or reaction, however many attacks you have.",
  reach: "Strikes 5 feet further than usual, so 10 feet away instead of 5.",
  thrown: "Can be thrown to make a ranged attack, using the same ability as a melee swing with it.",
  "two-handed": "Needs both hands to attack with, so no shield or second weapon.",
  versatile: "Usable in one hand or two; the two-handed grip does the larger damage die in brackets.",
};

export const DAMAGE_TYPE_BLURBS: Record<string, string> = {
  acid: "Corrosive: sprays, oozes and dissolving breath.",
  bludgeoning: "Blunt force: clubs, hammers, fists, falling.",
  cold: "Freezing: ice breath, rays of frost, winter magic.",
  fire: "Burning: dragon fire, fireballs, torches.",
  force: "Pure magical energy; almost nothing resists it (magic missile, eldritch blast).",
  lightning: "Electricity: bolts, blue dragons, storm magic.",
  necrotic: "Withering life force: undead touches, life drain, most death magic.",
  piercing: "Puncture: arrows, spears, fangs.",
  poison: "Venom and toxins: stings, poisoned blades, poison breath.",
  psychic: "Mental assault: mind flayers, some enchantments, telepathic damage.",
  radiant: "Holy light and searing brilliance: celestials, clerics' spells, the sun.",
  slashing: "Cutting: swords, axes, claws.",
  thunder: "Concussive sound: thunderwave, shatter, a giant's shout.",
};

export const SIZE_BLURBS: Record<string, string> = {
  tiny: "About the size of a cat or smaller; occupies a 2.5 foot square.",
  small: "Halfling-sized; fills a 5 foot square but wields heavy weapons badly.",
  medium: "Human-sized; the default 5 foot square.",
  large: "Horse or ogre sized; fills a 10 foot square.",
  huge: "Giant or young dragon sized; fills a 15 foot square.",
  gargantuan: "Ancient dragons, krakens; 20 feet or more on a side.",
};

// One entry per name, in the order a list shows them; names the table
// does not know get no blurb rather than a wrong one.
export function glossaryFor(
  names: readonly string[],
  blurbs: Record<string, string>,
): GlossaryEntry[] {
  return names.flatMap((name) => {
    const blurb = blurbs[name.toLowerCase()];
    return blurb ? [{ name, blurb }] : [];
  });
}

// The dialog body: one line per option, so the whole list reads at once.
export function glossaryText(entries: readonly GlossaryEntry[]): string {
  return entries.map((entry) => `${entry.name}: ${entry.blurb}`).join("\n\n");
}
