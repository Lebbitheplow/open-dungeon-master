// The size of a counter with no limit, shared by the class-resource tables
// (src/lib/srd/class-resources.ts re-exports both) and the row files that
// spread into them, which cannot load that module without loading themselves.

// What a counter holds when the feature has no limit (Rage at barbarian 20,
// Wild Shape at druid 20). The stored shape stays { max, used }; a spend
// from a counter this size is not counted (src/lib/dm/resource-tools.ts).
export const UNLIMITED_USES = 99;

export function isUnlimited(state: { max: number }): boolean {
  return state.max >= UNLIMITED_USES;
}
