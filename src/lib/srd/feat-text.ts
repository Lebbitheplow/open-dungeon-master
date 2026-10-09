// A content pack feat's rules as one string, wherever the pack keeps them.
// The 2014 rows carry `desc`; the 2024 rows a `benefits` list of
// paragraphs; Level Up (a5e) and Tome of Heroes keep a one-line intro in
// `desc` and the benefits in `effects_desc`, one per entry, some with a
// leading bullet (issue #147: those feats granted nothing because only
// `desc` was read). One a5e row (Tenacious) has its rules in the
// prerequisite field and nothing else; that text is read as the rules and
// the prerequisite as none. Pure: the server's catalog and the builder's
// fetch both read a row through this.
export type PackFeatText = { desc: string; prerequisite: string };

const line = (value: unknown) =>
  String(value ?? "")
    .replace(/^\s*[*•-]\s*/, "")
    .trim();

// A prerequisite field holding a feat's rules rather than a requirement:
// a long sentence that tells the reader what to do or what they gain.
export function readsAsRules(text: string): boolean {
  return text.length > 60 && /\b(?:you|your|choose|raise|gain|learn)\b/i.test(text);
}

export function packFeatText(data: Record<string, unknown>): PackFeatText {
  const parts: string[] = [];
  const plain = line(data.desc ?? data.description);
  if (plain) {
    parts.push(plain);
  }
  if (Array.isArray(data.benefits)) {
    for (const benefit of data.benefits as Array<{ desc?: unknown }>) {
      const text = line(benefit?.desc);
      if (text) {
        parts.push(text);
      }
    }
  }
  if (Array.isArray(data.effects_desc)) {
    for (const effect of data.effects_desc) {
      const text = line(effect);
      if (text) {
        parts.push(text);
      }
    }
  }
  let prerequisite = String(data.prerequisite ?? "").trim();
  if (readsAsRules(prerequisite)) {
    parts.unshift(prerequisite);
    prerequisite = "";
  }
  return { desc: parts.join(" "), prerequisite };
}
