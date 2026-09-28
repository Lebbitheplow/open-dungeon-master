// What a correction may not store, whoever makes it.
//
// The lead's sheet edit and the DM's tools are permissive on purpose: they
// exist to put right what the rules engine or a player got wrong, so they
// are not held to what a player may spend. They are still held to what a
// sheet can MEAN. A counter with five uses spent out of one is not a
// generous ruling, it is a number the engine's own spends and rests were
// never written to read. The schema bounds each number of a counter apart;
// this module holds the two together.
//
// Hit points above the maximum and a fourth attuned item are held by
// patchSheet itself (src/lib/db/sheets.ts), which every writer passes.
//
// Pure by design: no "@/" value imports and no I/O.

type Counter = { max: number; used: number };
type Dice = { total: number; spent: number };

export type CorrectionPatch = {
  resources?: Record<string, Counter>;
  hitDice?: Dice & Record<string, unknown>;
  hitDicePools?: Array<Dice & { classId: string } & Record<string, unknown>>;
  spellcasting?: {
    slots?: Record<string, Counter>;
    pact?: (Counter & Record<string, unknown>) | undefined;
  } | null;
};

const words = (id: string) => id.replace(/_/g, " ");

// The patch with every counter's spent number held to what the counter has,
// and one line for each that was held, for whoever made the correction.
export function coherentCorrection<T extends CorrectionPatch>(patch: T): { patch: T; held: string[] } {
  const held: string[] = [];
  const next: T = { ...patch };

  if (patch.resources) {
    const resources: Record<string, Counter> = {};
    for (const [id, counter] of Object.entries(patch.resources)) {
      if (counter.used > counter.max) {
        held.push(`${words(id)} has ${counter.max}, so ${counter.max} are spent, not ${counter.used}`);
        resources[id] = { ...counter, used: counter.max };
      } else {
        resources[id] = counter;
      }
    }
    next.resources = resources;
  }

  if (patch.hitDice && patch.hitDice.spent > patch.hitDice.total) {
    held.push(`there are ${patch.hitDice.total} hit dice, so ${patch.hitDice.total} are spent, not ${patch.hitDice.spent}`);
    next.hitDice = { ...patch.hitDice, spent: patch.hitDice.total };
  }

  if (patch.hitDicePools) {
    next.hitDicePools = patch.hitDicePools.map((pool) => {
      if (pool.spent <= pool.total) {
        return pool;
      }
      held.push(`${words(pool.classId)} has ${pool.total} hit dice, so ${pool.total} are spent, not ${pool.spent}`);
      return { ...pool, spent: pool.total };
    });
  }

  if (patch.spellcasting) {
    const spellcasting = { ...patch.spellcasting };
    if (spellcasting.slots) {
      const slots: Record<string, Counter> = {};
      for (const [level, slot] of Object.entries(spellcasting.slots)) {
        if (slot.used > slot.max) {
          held.push(`there are ${slot.max} level ${level} slots, so ${slot.max} are spent, not ${slot.used}`);
          slots[level] = { ...slot, used: slot.max };
        } else {
          slots[level] = slot;
        }
      }
      spellcasting.slots = slots;
    }
    if (spellcasting.pact && spellcasting.pact.used > spellcasting.pact.max) {
      held.push(`there are ${spellcasting.pact.max} pact slots, so ${spellcasting.pact.max} are spent, not ${spellcasting.pact.used}`);
      spellcasting.pact = { ...spellcasting.pact, used: spellcasting.pact.max };
    }
    next.spellcasting = spellcasting as T["spellcasting"];
  }

  return { patch: next, held };
}
