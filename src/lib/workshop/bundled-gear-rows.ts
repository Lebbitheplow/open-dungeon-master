import { SRD_ARMOR } from "@/lib/srd/armor";
import { SRD_GEAR } from "@/lib/srd/adventuring-gear";
import { bundledPriceCopper } from "@/lib/srd/starting-wealth";
import { SRD_WEAPONS, SRD_WEAPON_WEIGHT_LB } from "@/lib/srd/weapons";

// SRD 5.1's mundane equipment with no content pack installed: the Weapons,
// Armor and Adventuring Gear tables ODM bundles (src/lib/srd/weapons.ts,
// armor.ts, adventuring-gear.ts), as catalog rows. The workshop can start a
// copy of a longsword or a backpack from one and the copy weighs and costs
// what the book says (docs/workshop-rulebook-audit-pr169.md F08, F09); the
// weapon and armour blocks come from the same tables (catalog-mechanics.ts
// itemMechanicsOf).

const BOOK = "System Reference Document 5.1";

export type BundledGearRow = {
  slug: string;
  name: string;
  source: "srd";
  documentSlug: "wotc-srd";
  document: string;
  kind: "weapon" | "armor" | "gear";
  rarity: "";
  cost: string;
  category: string;
  weight: number;
  data: Record<string, unknown>;
};

const slugOf = (name: string) => `srd-gear:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

// "15 gp", "2 sp", "5 cp" as the book prints a price.
function costText(copper: number | null): string {
  if (copper === null) return "";
  if (copper % 100 === 0) return `${copper / 100} gp`;
  if (copper % 10 === 0) return `${copper / 10} sp`;
  return `${copper} cp`;
}

const weightText = (pounds: number | null) => (pounds ? `${pounds} lb.` : "");

let rows: BundledGearRow[] | null = null;

function allRows(): BundledGearRow[] {
  if (rows) return rows;
  const row = (name: string, kind: BundledGearRow["kind"], category: string, pounds: number | null, extra: Record<string, unknown> = {}): BundledGearRow => {
    const cost = costText(bundledPriceCopper(name));
    return {
      slug: slugOf(name),
      name,
      source: "srd",
      documentSlug: "wotc-srd",
      document: BOOK,
      kind,
      rarity: "",
      cost,
      category,
      weight: pounds ?? 0,
      data: { desc: "", type: category, cost, weight: weightText(pounds), ...extra },
    };
  };
  rows = [
    // The SRD's own weapons: the ones its table prices (the genre weapons
    // are ODM's, not the book's).
    ...SRD_WEAPONS.filter((weapon) => (weapon.category === "simple" || weapon.category === "martial") && bundledPriceCopper(weapon.name) !== null).map((weapon) =>
      row(weapon.name, "weapon", `${weapon.category === "simple" ? "Simple" : "Martial"} ${weapon.kind === "melee" ? "Melee" : "Ranged"} Weapons`, SRD_WEAPON_WEIGHT_LB[weapon.name] ?? null, {
        damage: weapon.damage,
        properties: weapon.properties ?? [],
      }),
    ),
    ...SRD_ARMOR.filter((armor) => !armor.genres?.length).map((armor) =>
      row(armor.name, "armor", armor.category === "shield" ? "Shield" : `${armor.category[0].toUpperCase()}${armor.category.slice(1)} Armor`, armor.weightLb, {
        ac: armor.baseAc,
        ...(armor.strengthRequirement ? { strength_requirement: armor.strengthRequirement } : {}),
        ...(armor.stealthDisadvantage ? { stealth_disadvantage: true } : {}),
      }),
    ),
    ...SRD_GEAR.map((gear) => row(gear.name, "gear", "Adventuring Gear", gear.weightLb)),
  ];
  return rows;
}

export function bundledGearRows(q = "", kind?: string): BundledGearRow[] {
  const wanted = q.trim().toLowerCase();
  return allRows().filter((entry) => (!kind || entry.kind === kind) && (!wanted || entry.name.toLowerCase().includes(wanted)));
}

export function bundledGearRow(slug: string): BundledGearRow | null {
  return allRows().find((entry) => entry.slug === slug) ?? null;
}
