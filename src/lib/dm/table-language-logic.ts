// The table-language directive: what tells every model call that writes for
// people which language the table plays in, and which words must stay the
// engine's own. Pure and alias-free so scripts/test-table-language.mjs can
// load it directly.
//
// One wording for every prose call: what stays English (anything the engine
// looks up by name) is the same everywhere, and a second wording would
// drift. It names no section of the DM's prompt, since most prose calls are
// not the DM turn, and no rule for image prompts, which every image job
// rewrites into English (src/lib/image-english.ts). English tables get no
// directive, so their prompts are unchanged.

import { TABLE_LANGUAGE_NAMES, type TableLanguage } from "../schemas/game-settings-options.ts";

export function languageDirective(language: TableLanguage): string {
  if (language === "english") {
    return "";
  }
  const name = TABLE_LANGUAGE_NAMES[language].english;
  return `TABLE LANGUAGE: The players read ${name}. Write everything they will read in ${name}: narration, dialogue, and any new text you put in a tool argument or a reply field (a name you invent, a summary, a reason, a note). Never translate what the game matches exactly: names it already knows (characters, spells, items, conditions, creatures, skills), copied as the game writes them, or by their English rules name if it has not listed them yet; and every listed value and JSON key, written exactly as listed. If unsure whether the game matches a name, use English. In narration, call things by their ${name} names.`;
}

// A prose call's system prompt with the directive appended: unchanged for an
// English table.
export function withLanguage(system: string, language: TableLanguage): string {
  const directive = languageDirective(language);
  return directive ? `${system}\n\n${directive}` : system;
}
