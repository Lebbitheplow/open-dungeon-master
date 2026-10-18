// Text settings a panel edits in place and saves on blur or Enter.
//
// Each draft remembers the saved value it was last in step with, its base.
// A draft still at its base is untouched: when the saved settings change
// under it (another window, another lead), it follows them. A draft the
// player has typed into keeps their words, and committing it saves them over
// whatever arrived meanwhile, so the last change made on purpose wins. A
// draft nobody typed into is never saved, so focusing and leaving a field
// that showed an older value cannot write it back over a newer choice.
export type SettingDrafts<K extends string> = {
  drafts: Record<K, string>;
  base: Record<K, string>;
};

export function draftsFrom<K extends string>(saved: Record<K, string>): SettingDrafts<K> {
  return { drafts: { ...saved }, base: { ...saved } };
}

// Whether the drafts were last in step with these saved values.
export function inStep<K extends string>(state: SettingDrafts<K>, saved: Record<K, string>): boolean {
  return (Object.keys(saved) as K[]).every((field) => state.base[field] === saved[field]);
}

// The drafts once the saved values have changed. An untouched draft follows,
// and so does one whose words are now what is saved (the player's own commit
// coming back); one holding words not saved yet is left alone.
export function followSaved<K extends string>(state: SettingDrafts<K>, saved: Record<K, string>): SettingDrafts<K> {
  const drafts = { ...state.drafts };
  for (const field of Object.keys(saved) as K[]) {
    if (drafts[field] === state.base[field] || drafts[field].trim() === saved[field]) {
      drafts[field] = saved[field];
    }
  }
  return { drafts, base: { ...saved } };
}

export function editDraft<K extends string>(state: SettingDrafts<K>, field: K, value: string): SettingDrafts<K> {
  return { ...state, drafts: { ...state.drafts, [field]: value } };
}

// What committing `field` saves: the player's words, trimmed, or null when
// the draft was not typed into or already says what is saved.
export function commitValue<K extends string>(state: SettingDrafts<K>, saved: Record<K, string>, field: K): string | null {
  if (state.drafts[field] === state.base[field]) {
    return null;
  }
  const value = state.drafts[field].trim();
  return value === saved[field] ? null : value;
}
