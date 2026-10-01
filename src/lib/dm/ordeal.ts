// Coming back from the dead is an ordeal (SRD 5.1, Raise Dead and
// Resurrection): -4 to attack rolls and saving throws, one less after each
// long rest. The condition's name carries what is left
// ("returned from death (-3)"); src/lib/srd/condition-effects.ts reads it.

// A long rest eases it: the -4 is one less after each, gone after the
// fourth; and it ends Contact Other Plane's insanity. Pure: the conditions
// in, the conditions out.
export function easeOrdeal(conditions: string[]): string[] {
  return conditions.flatMap((entry) => {
    // Contact Other Plane's insanity lasts until a long rest (spell-self.ts).
    if (/^insane \(contact other plane\)$/i.test(entry.trim())) {
      return [];
    }
    const match = /^returned from death \(-(\d)\)$/i.exec(entry.trim());
    if (!match) {
      return [entry];
    }
    const left = Number(match[1]) - 1;
    return left > 0 ? [`returned from death (-${left})`] : [];
  });
}
