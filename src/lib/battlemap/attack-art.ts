import type { IconRef } from "@/lib/icons";
import { textKey } from "@/lib/language/text-logic";

// Choose the action first, then only the anatomy needed to depict it accurately.
// Explicit form groups avoid guessing anatomy from a homebrew creature's name.
// These are visual groups, not biological classifications: the mammal bite
// has canine teeth, so a deer, rodent or whale must not inherit it just for
// being a mammal. Venomous snakes likewise do not use constrictor teeth.
const ANATOMY_FORMS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["mammal", ["Wolf", "Dire Wolf", "Black Bear", "Brown Bear", "Polar Bear", "Panther", "Lion", "Tiger", "Saber-Toothed Tiger", "Cat", "Mastiff", "Hyena", "Giant Hyena", "Jackal", "Badger", "Giant Badger", "Weasel", "Giant Weasel", "Baboon", "Bat", "Giant Bat"]],
  ["reptile", ["Crocodile", "Giant Crocodile", "Lizard", "Giant Lizard", "Plesiosaurus", "Tyrannosaurus Rex"]],
  ["serpent", ["Constrictor Snake", "Giant Constrictor Snake"]],
  ["arachnid", ["Spider", "Giant Spider", "Giant Wolf Spider"]],
  ["tusked", ["Boar", "Giant Boar", "Elephant", "Mammoth"]],
  ["antlered", ["Elk", "Giant Elk"]],
  ["primate", ["Ape", "Giant Ape"]],
];
const FORM_ANATOMY = new Map(ANATOMY_FORMS.flatMap(([anatomy, forms]) => forms.map((form) => [textKey(form), anatomy] as const)));

// These attack names identify the striking body part without a species guess.
const BODY_PART_ART = new Map<string, string>([
  ["beak", "strike-beak"],
  ["talon", "strike-talons"], ["talons", "strike-talons"],
  ["tentacle", "strike-tentacles"], ["tentacles", "strike-tentacles"],
  ["tusk", "strike-tusks"], ["tusks", "strike-tusks"],
]);

const ANATOMY_ART = new Map<string, string>([
  ["bite:mammal", "strike-bite-mammal"],
  ["bite:reptile", "strike-bite-reptile"],
  ["bite:serpent", "strike-bite-serpent"],
  ["bite:arachnid", "strike-bite-arachnid"],
  ["claw:mammal", "strike-claw-mammal"],
  ["claws:mammal", "strike-claw-mammal"],
  ["ram:antlered", "strike-ram-antlers"],
  ["fist:primate", "strike-fist-primate"],
  ["constrict:serpent", "strike-constrict"],
  ["gore:tusked", "strike-tusks"],
  ["tail:reptile", "strike-tail-reptile"],
]);

export function beastAttackIcon(form: string, attack: string): IconRef {
  const anatomy = FORM_ANATOMY.get(textKey(form));
  const action = textKey(attack);
  const key = BODY_PART_ART.get(action) ?? ANATOMY_ART.get(`${action}:${anatomy}`) ?? "natural-attack";
  return { kind: "action", key };
}
