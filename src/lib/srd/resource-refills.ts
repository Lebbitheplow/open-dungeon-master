// What gives a character's counters back: a rest (the recharge each counter
// has, read at the level it is held, and Sorcerous Restoration) and a new
// initiative roll (Superior Inspiration, Perfect Self, the authored subclass
// refills). Split from the class resource tables
// (src/lib/srd/class-resources.ts), whose counters it refills. Pure and
// database-free.

import { authoredInitiativeRefills } from "@/lib/srd/authored-effects";
import { resourceDef, resourceLevel, type Recharge, type ResourceMap } from "@/lib/srd/class-resources";

// Rest refills: long rests refill everything, short rests only the
// short-recharge pools. With the sheet to hand the refill reads the level the
// counter is held at (Bardic Inspiration on a short rest from bard 5) and the
// features that give some back (Sorcerous Restoration). Inspiration is the
// DM's to give and no rest brings it back.
export function refillResources(
  resources: ResourceMap | undefined,
  rest: Recharge,
  sheet?: {
    level: number;
    classes?: Array<{ id: string; level: number }>;
    features?: Array<{ name: string; classId?: string }>;
  },
): ResourceMap {
  const out: ResourceMap = {};
  for (const [id, state] of Object.entries(resources ?? {})) {
    const def = resourceDef(id);
    if (def?.noRefill) {
      out[id] = state;
      continue;
    }
    const recharge =
      def?.rechargeFor && sheet ? def.rechargeFor(resourceLevel(def, sheet)) : def?.recharge;
    const refill = rest === "long" || recharge === "short";
    out[id] = { max: state.max, used: refill ? 0 : state.used };
  }
  // Sorcerous Restoration (sorcerer 20): 4 expended sorcery points come back
  // on a short rest.
  const points = out.sorcery_points;
  if (
    rest === "short" &&
    points &&
    points.used > 0 &&
    sheet?.features?.some((feature) => feature.name.trim().toLowerCase().startsWith("sorcerous restoration"))
  ) {
    out.sorcery_points = { max: points.max, used: Math.max(0, points.used - 4) };
  }
  return out;
}

// What a new initiative roll gives back (SRD 5.1): Superior Inspiration
// (bard 20) one Bardic Inspiration when none is left, Perfect Self (monk 20)
// four ki when none is left. Null when nothing changes.
export function initiativeRefills(
  resources: ResourceMap | undefined,
  features: Array<{ name: string }>,
): { resources: ResourceMap; notes: string[] } | null {
  const holds = (name: string) =>
    features.some((feature) => feature.name.trim().toLowerCase().startsWith(name));
  const next: ResourceMap = { ...(resources ?? {}) };
  const notes: string[] = [];
  const inspiration = next.bardic_inspiration;
  if (holds("superior inspiration") && inspiration && inspiration.used >= inspiration.max) {
    next.bardic_inspiration = { max: inspiration.max, used: inspiration.max - 1 };
    notes.push("Superior Inspiration: one Bardic Inspiration comes back");
  }
  const ki = next.ki;
  if (holds("perfect self") && ki && ki.used >= ki.max) {
    next.ki = { max: ki.max, used: Math.max(0, ki.max - 4) };
    notes.push("Perfect Self: 4 ki points come back");
  }
  // The authored subclass refills (Relentless, Ever-Ready Shot, Tireless
  // Spirit, Legion of One): src/lib/srd/authored-effects.ts.
  const authored = authoredInitiativeRefills(next, { features });
  if (authored) {
    Object.assign(next, authored.resources);
    notes.push(...authored.notes);
  }
  return notes.length ? { resources: next, notes } : null;
}
