// Content-pack monster rows that disagree with the SRD 5.1 stat block they
// copy, corrected when the row is read. The pack itself (data/content/
// open5e.sqlite) is left as imported: a reimport would bring the error back,
// so the correction lives here, keyed by the row's document and slug, and
// only the fields named are replaced.
type Correction = Partial<{
  damage_immunities: string;
  damage_resistances: string;
  damage_vulnerabilities: string;
  condition_immunities: string;
}>;

const CORRECTIONS: Record<string, Correction> = {
  // SRD 5.1 Skeleton: vulnerable to bludgeoning, immune to poison (the row
  // files poison under resistances).
  "wotc-srd/skeleton": { damage_immunities: "poison", damage_resistances: "" },
  // SRD 5.1 Zombie: immune to poison (the row leaves immunities empty).
  "wotc-srd/zombie": { damage_immunities: "poison" },
};

export function correctedMonsterData(data: Record<string, unknown>): Record<string, unknown> {
  const document = String(data.document__slug ?? data.document_slug ?? "wotc-srd");
  const correction = CORRECTIONS[`${document}/${String(data.slug ?? "")}`];
  return correction ? { ...data, ...correction } : data;
}
