// The table-language directive: what tells every model call that writes for
// people which language the table plays in, and which words must stay the
// engine's own. Pure and alias-free so scripts/test-table-language.mjs can
// load it directly.
//
// One wording for every prose call, never a per-call variant: what stays
// English is the same everywhere (anything the engine looks up by name), and
// a second wording would drift. English tables get nothing, so their
// prompts are byte-identical to what they were before the setting existed.

import { TABLE_LANGUAGE_NAMES, type TableLanguage } from "../schemas/game-settings-options.ts";

export function languageDirective(language: TableLanguage): string {
  if (language === "english") {
    return "";
  }
  const name = TABLE_LANGUAGE_NAMES[language].english;
  return `TABLE LANGUAGE: The players read ${name}. Write narration, dialogue and all new text in ${name}, including new text inside tool arguments: a name you invent, a summary, a reason, a note, a story step. Names the game looks up stay exactly as the game writes them: characters, spells, items, conditions, creatures, skills, and anything else GAME STATE lists or the rules name. Copy them as GAME STATE writes them; for something GAME STATE does not list yet, use its English rules name ("Potion of Healing", never a translation). Fixed-choice values stay exactly as the tool defines them. When a tool offers a separate display name, put the ${name} name there. When unsure whether the game looks a name up, use English. Text only a machine reads, such as an image prompt, is written in English. In a JSON reply, keys and fixed values stay exactly as asked; only the text inside them changes language. In narration, call everything by its ${name} name.`;
}

// A prose call's system prompt with the directive appended: unchanged for an
// English table.
export function withLanguage(system: string, language: TableLanguage): string {
  const directive = languageDirective(language);
  return directive ? `${system}\n\n${directive}` : system;
}
