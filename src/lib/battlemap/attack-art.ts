import { iconSlug, type IconRef } from "@/lib/icons";

// Choose the action first, then only the anatomy needed to depict it accurately.
// Explicit form groups avoid guessing anatomy from a homebrew creature's name.
const FORM_ANATOMY = new Map<string, string>([
  ["wolf", "mammal"],
  ["dire-wolf", "mammal"],
  ["black-bear", "mammal"],
  ["brown-bear", "mammal"],
  ["panther", "mammal"],
  ["boar", "tusked"],
  ["elk", "antlered"],
  ["ape", "primate"],
  ["giant-ape", "primate"],
  ["crocodile", "reptile"],
  ["giant-spider", "arachnid"],
  ["giant-eagle", "avian"],
  ["giant-octopus", "cephalopod"],
  ["giant-constrictor-snake", "serpent"],
  ["mammoth", "tusked"],
  ["tyrannosaurus-rex", "reptile"],
]);

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
  const anatomy = FORM_ANATOMY.get(iconSlug(form));
  const action = iconSlug(attack);
  const key = BODY_PART_ART.get(action) ?? ANATOMY_ART.get(`${action}:${anatomy}`) ?? "natural-attack";
  return { kind: "action", key };
}
