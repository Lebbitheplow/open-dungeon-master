// Which content-pack documents are written for the 2024 rules. ODM's engine
// is the 2014 rules (SRD 5.1): a 2024 species raises no ability score and
// fixes no languages, and a 2024 feat's text is not what the engine applies
// (the 2024 Alert adds the proficiency bonus; the engine gives +5). The pack
// backfilled these rows wherever their name was new, so they are left out
// of what a 2014 character is offered, at read time. The rows stay in the
// pack, and a stored character that already names one still loads.
export const EDITION_2024_DOCUMENTS: ReadonlySet<string> = new Set(["srd-2024"]);

export function isEdition2024(documentSlug: string | null | undefined): boolean {
  return EDITION_2024_DOCUMENTS.has(String(documentSlug ?? ""));
}
