import { DISEASES, POISONS, type DiseaseSpec } from "@/lib/srd/afflictions";
import { SAMPLE_TRAPS } from "@/lib/srd/trap-specs";

// The SRD's hazards as rows the workshop starts from (GET
// /api/content/hazards): the poisons table, the three sample diseases and
// the sample traps, each with the block a workshop hazard stores (`table`),
// so a copy runs exactly as the original. A copy of a disease keeps that
// disease's own rules (runsAs): cackle fever's falling DC and sight rot's
// penalty are not the general pattern a workshop disease follows.

type CatalogRow = {
  slug: string;
  name: string;
  source: "srd";
  documentSlug: "wotc-srd";
  document: "SRD 5.1";
  data: { desc: string; hazardKind: "trap" | "poison" | "disease" };
  table: Record<string, unknown>;
};

function diseaseSpecOf(id: keyof typeof DISEASES): DiseaseSpec {
  const disease = DISEASES[id];
  return {
    condition: disease.condition,
    infect: { ability: "con", dc: disease.infectDc },
    onset: disease.onset,
    exhaustion: id === "sight_rot" ? 0 : 1,
    ...(id === "sewer_plague" ? { rest: { ability: "con" as const, dc: 11, onSuccess: "improve" as const, onFail: "worsen" as const, successes: 1 } } : {}),
    runsAs: id,
    summary: disease.summary,
  };
}

export function hazardCatalog(q = ""): CatalogRow[] {
  const wanted = q.trim().toLowerCase();
  const rows: CatalogRow[] = [
    ...SAMPLE_TRAPS.map(({ id, name, ...trap }) => ({
      slug: `trap-${id}`,
      name,
      source: "srd" as const,
      documentSlug: "wotc-srd" as const,
      document: "SRD 5.1" as const,
      data: { desc: trap.summary, hazardKind: "trap" as const },
      table: { hazardKind: "trap", trap },
    })),
    ...POISONS.map(({ id, name, ...poison }) => ({
      slug: `poison-${id}`,
      name,
      source: "srd" as const,
      documentSlug: "wotc-srd" as const,
      document: "SRD 5.1" as const,
      data: { desc: poison.summary, hazardKind: "poison" as const },
      table: { hazardKind: "poison", poison },
    })),
    ...(Object.keys(DISEASES) as Array<keyof typeof DISEASES>).map((id) => ({
      slug: `disease-${id}`,
      name: DISEASES[id].name,
      source: "srd" as const,
      documentSlug: "wotc-srd" as const,
      document: "SRD 5.1" as const,
      data: { desc: DISEASES[id].summary, hazardKind: "disease" as const },
      table: { hazardKind: "disease", disease: diseaseSpecOf(id) },
    })),
  ];
  return wanted ? rows.filter((row) => row.name.toLowerCase().includes(wanted)) : rows;
}
