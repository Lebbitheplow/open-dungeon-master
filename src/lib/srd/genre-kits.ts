// Starting kits for ODM's 36 setting classes (src/lib/classes/*.json). Their
// catalog rows carry no equipment list, so each has a small fixed kit of
// ODM's writing, in the shape of the SRD's (src/lib/srd/starting-kit-data.ts):
// the weapons its training covers, armor it may wear (none for a class with
// no armor training), and the tool its theme turns on. Weapons and armor
// come from the tables the attack and armor engines read, so every piece
// works on the sheet.
import type { ClassKit, KitItem } from "@/lib/srd/starting-kit-data";

const one = (name: string, qty = 1): KitItem => ({ name, qty });
const bullets = one("Bullets", 20);

function odm(label: string, items: KitItem[]): ClassKit {
  return { source: "odm", lines: [{ options: [{ label, items }] }] };
}

export const GENRE_KITS: Record<string, ClassKit> = {
  // Cyberpunk
  netrunner: odm("a dagger, a pistol with 20 rounds and a hacking rig", [
    one("Dagger"), one("Pistol"), bullets, one("Hacking Rig"),
  ]),
  street_samurai: odm("a monoblade, a pistol with 20 rounds and an armorweave vest", [
    one("Monoblade"), one("Pistol"), bullets, one("Armorweave Vest"),
  ]),
  rigger: odm("a pistol with 20 rounds, an armorweave vest and drone controls", [
    one("Pistol"), bullets, one("Armorweave Vest"), one("Drone Controls"),
  ]),
  fixer: odm("a dagger, a pistol with 20 rounds, an armorweave vest and a forgery kit", [
    one("Dagger"), one("Pistol"), bullets, one("Armorweave Vest"), one("Forgery Kit"),
  ]),
  esper: odm("a machete and two daggers", [one("Machete"), one("Dagger", 2)]),
  trauma_doc: odm("a pistol with 20 rounds, an armorweave vest and a medic's kit", [
    one("Pistol"), bullets, one("Armorweave Vest"), one("Medic's Kit"),
  ]),
  // Dark fantasy
  witch_hunter: odm("a longsword, a pistol with 20 rounds, a chain shirt and manacles", [
    one("Longsword"), one("Pistol"), bullets, one("Chain Shirt"), one("Manacles"),
  ]),
  plague_doctor: odm("a dagger, a pistol with 20 rounds, leather armor and a herbalism kit", [
    one("Dagger"), one("Pistol"), bullets, one("Leather"), one("Herbalism Kit"),
  ]),
  grave_knight: odm("a longsword, a shield, a chain shirt and a dagger", [
    one("Longsword"), one("Shield"), one("Chain Shirt"), one("Dagger"),
  ]),
  penitent: odm("a flail and a whip", [one("Flail"), one("Whip")]),
  dirgesinger: odm("a dagger, leather armor and a lute", [one("Dagger"), one("Leather"), one("Lute")]),
  vermin_lord: odm("a club, a sawed-off scattergun with 20 rounds, leather armor and a poisoner's kit", [
    one("Club"), one("Sawed-off Scattergun"), bullets, one("Leather"), one("Poisoner's Kit"),
  ]),
  // Horror
  exorcist: odm("a censer mace, two silvered stakes, leather armor and a holy symbol", [
    one("Censer Mace"), one("Silvered Stake", 2), one("Leather"), one("Holy Symbol"),
  ]),
  occultist: odm("a dagger, three hurled vials and a component pouch", [
    one("Dagger"), one("Hurled Vial", 3), one("Component Pouch"),
  ]),
  survivor: odm("a machete, a revolver with 20 rounds and leather armor", [
    one("Machete"), one("Revolver"), bullets, one("Leather"),
  ]),
  slayer: odm("a longsword, a hunting rifle with 20 rounds and a chain shirt", [
    one("Longsword"), one("Hunting Rifle"), bullets, one("Chain Shirt"),
  ]),
  parapsychologist: odm("a revolver with 20 rounds, leather armor and field instruments", [
    one("Revolver"), bullets, one("Leather"), one("Field Instruments"),
  ]),
  apostate: odm("two daggers and two hurled vials", [one("Dagger", 2), one("Hurled Vial", 2)]),
  // Mystery
  detective: odm("a club, a revolver with 20 rounds, leather armor and an investigator's kit", [
    one("Club"), one("Revolver"), bullets, one("Leather"), one("Investigator's Kit"),
  ]),
  alienist: odm("a dagger, a quarterstaff and a medic's kit", [
    one("Dagger"), one("Quarterstaff"), one("Medic's Kit"),
  ]),
  grifter: odm("a sword cane, a pistol with 20 rounds, leather armor and a disguise kit", [
    one("Sword Cane"), one("Pistol"), bullets, one("Leather"), one("Disguise Kit"),
  ]),
  enforcer: odm("a warhammer, a sawed-off scattergun with 20 rounds and studded leather", [
    one("Warhammer"), one("Sawed-off Scattergun"), bullets, one("Studded Leather"),
  ]),
  muckraker: odm("a dagger, a revolver with 20 rounds and a photographer's kit", [
    one("Dagger"), one("Revolver"), bullets, one("Photographer's Kit"),
  ]),
  spirit_medium: odm("a dagger, a silvered stake, leather armor and a seance kit", [
    one("Dagger"), one("Silvered Stake"), one("Leather"), one("Seance Kit"),
  ]),
  // Post-apocalyptic
  scavenger: odm("a crowbar, a hunting rifle with 20 rounds, leather armor and tinker's tools", [
    one("Crowbar"), one("Hunting Rifle"), bullets, one("Leather"), one("Tinker's Tools"),
  ]),
  road_warrior: odm("a battleaxe, a sawed-off scattergun with 20 rounds and hide armor", [
    one("Battleaxe"), one("Sawed-off Scattergun"), bullets, one("Hide"),
  ]),
  aberrant: odm("a spear and a dagger", [one("Spear"), one("Dagger")]),
  salvage_tech: odm("a shock baton, a pistol with 20 rounds, leather armor and tinker's tools", [
    one("Shock Baton"), one("Pistol"), bullets, one("Leather"), one("Tinker's Tools"),
  ]),
  waste_preacher: odm("a mace, hide armor and a herbalism kit", [
    one("Mace"), one("Hide"), one("Herbalism Kit"),
  ]),
  packmaster: odm("a spear, a shortbow with a quiver of 20 arrows and hide armor", [
    one("Spear"), one("Shortbow"), one("Quiver"), one("Arrows", 20), one("Hide"),
  ]),
  // Steampunk
  machinist: odm("a light hammer, a pistol with 20 rounds, a brass carapace and tinker's tools", [
    one("Light Hammer"), one("Pistol"), bullets, one("Brass Carapace"), one("Tinker's Tools"),
  ]),
  aeronaut: odm("a rapier, a pistol with 20 rounds, leather armor and navigator's tools", [
    one("Rapier"), one("Pistol"), bullets, one("Leather"), one("Navigator's Tools"),
  ]),
  alchemist: odm("a dagger, three hurled vials, leather armor and alchemist's supplies", [
    one("Dagger"), one("Hurled Vial", 3), one("Leather"), one("Alchemist's Supplies"),
  ]),
  gadgeteer: odm("a shock baton, a pistol with 20 rounds, leather armor and tinker's tools", [
    one("Shock Baton"), one("Pistol"), bullets, one("Leather"), one("Tinker's Tools"),
  ]),
  aether_channeler: odm("a quarterstaff and a dagger", [one("Quarterstaff"), one("Dagger")]),
  steam_knight: odm("a warhammer, a shield and chain mail", [
    one("Warhammer"), one("Shield"), one("Chain Mail"),
  ]),
};
