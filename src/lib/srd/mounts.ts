// Mounts and vehicles.
//
// Mounted combat is in the PHB (p.198) and ODM enforced none of it: a horse
// was a line of equipment, and "I ride him down" was pure DM assertion. This
// is the rules half of that, and it is deliberately the whole of the PHB rule
// and no more, because mounted combat is four paragraphs and inventing a
// fifth would be house rules with a straight face.
//
// Vehicles are here too but thinner, matching where the SRD leaves them: a
// speed, a capacity and a crew requirement. Nothing simulates a ship's
// helm.
//
// Pure by design: no imports at all, so scripts/test-mounts.mjs can load it.

export type MountProfile = {
  slug: string;
  name: string;
  // Feet per round.
  speed: number;
  // Pounds it carries before it slows, which is the 5e carrying-capacity rule
  // applied to a beast: Strength x 15, doubled for a Large creature.
  carry: number;
  // A controlled mount is one trained to bear a rider (PHB p.198): the rider
  // chooses its actions and it shares their initiative. An independent mount
  // keeps its own initiative and acts as it likes.
  controllable: boolean;
  // Size, which decides who can ride it: a mount must be at least one size
  // larger than its rider.
  size: MountSize;
  blurb: string;
};

export const MOUNT_SIZES = ["small", "medium", "large", "huge"] as const;
export type MountSize = (typeof MOUNT_SIZES)[number];

const SIZE_ORDER: Record<MountSize, number> = { small: 1, medium: 2, large: 3, huge: 4 };

// The SRD's riding animals, with the two flying mounts a table will ask for.
export const MOUNTS: MountProfile[] = [
  {
    slug: "riding-horse",
    name: "Riding horse",
    speed: 60,
    carry: 480,
    controllable: true,
    size: "large",
    blurb: "Fast on a road, useless in a dungeon.",
  },
  {
    slug: "warhorse",
    name: "Warhorse",
    speed: 60,
    carry: 540,
    controllable: true,
    size: "large",
    blurb: "Trained to fight; will not spook at blood.",
  },
  {
    slug: "pony",
    name: "Pony",
    speed: 40,
    carry: 225,
    controllable: true,
    size: "medium",
    blurb: "What a halfling or a gnome actually rides.",
  },
  {
    slug: "draft-horse",
    name: "Draft horse",
    speed: 40,
    carry: 540,
    controllable: true,
    size: "large",
    blurb: "Pulls a cart all day. Not for a charge.",
  },
  {
    slug: "camel",
    name: "Camel",
    speed: 50,
    carry: 480,
    controllable: true,
    size: "large",
    blurb: "Crosses a desert; hates everyone while doing it.",
  },
  {
    slug: "mastiff",
    name: "Mastiff",
    speed: 40,
    carry: 195,
    controllable: true,
    size: "medium",
    blurb: "A small rider's mount, and a tracker.",
  },
  {
    slug: "elk",
    name: "Elk",
    speed: 50,
    carry: 480,
    controllable: false,
    size: "large",
    blurb: "Ridden by those the wild allows. Keeps its own counsel.",
  },
  {
    slug: "griffon",
    name: "Griffon",
    speed: 80,
    carry: 540,
    controllable: false,
    size: "large",
    blurb: "Flies at 80 ft. Independent: it decides.",
  },
];

export function mountProfile(ref: string): MountProfile | null {
  const needle = ref.trim().toLowerCase();
  return (
    MOUNTS.find((mount) => mount.slug === needle) ??
    MOUNTS.find((mount) => mount.name.toLowerCase() === needle) ??
    MOUNTS.find((mount) => mount.name.toLowerCase().includes(needle)) ??
    null
  );
}

// PHB p.198: a mount must be at least one size larger than the rider.
export function canCarry(mount: MountSize, rider: MountSize): boolean {
  return SIZE_ORDER[mount] > SIZE_ORDER[rider];
}

export type MountState = {
  // The mount, as a slug or a free name the DM typed.
  ref: string;
  name: string;
  speed: number;
  // Controlled mounts share the rider's initiative; independent ones do not.
  controlled: boolean;
  size: MountSize;
};

export type MountCheck = { ok: true; state: MountState } | { error: string };

// Mounting. The rules it enforces are the ones the PHB actually states, and
// the errors say which rule refused, because "you cannot do that" teaches a
// table nothing.
export function checkMount(input: {
  ref: string;
  riderSize?: MountSize;
  // A DM writing their own beast: everything is taken on trust except the
  // size rule, which still applies.
  custom?: { name: string; speed: number; controlled: boolean; size: MountSize };
}): MountCheck {
  const riderSize = input.riderSize ?? "medium";
  if (input.custom) {
    const speed = Math.min(200, Math.max(0, Math.round(input.custom.speed)));
    if (!canCarry(input.custom.size, riderSize)) {
      return {
        error: `A mount has to be at least one size larger than its rider; a ${input.custom.size} mount cannot carry a ${riderSize} rider.`,
      };
    }
    return {
      ok: true,
      state: {
        ref: input.custom.name.toLowerCase(),
        name: input.custom.name.slice(0, 60),
        speed,
        controlled: input.custom.controlled,
        size: input.custom.size,
      },
    };
  }
  const profile = mountProfile(input.ref);
  if (!profile) {
    return { error: `No mount called "${input.ref}". Describe one instead and the DM can write it in.` };
  }
  if (!canCarry(profile.size, riderSize)) {
    return {
      error: `A ${riderSize} rider cannot ride a ${profile.size} ${profile.name}; a mount has to be one size larger.`,
    };
  }
  return {
    ok: true,
    state: {
      ref: profile.slug,
      name: profile.name,
      speed: profile.speed,
      controlled: profile.controllable,
      size: profile.size,
    },
  };
}

// While mounted, the rider moves at the mount's speed rather than their own
// (PHB p.198). Their own speed is not added; a fast rider on a slow horse
// travels at the horse's pace.
export function mountedSpeed(mount: MountState | null, riderSpeed: number): number {
  return mount ? mount.speed : riderSpeed;
}

// Being knocked off. PHB p.198: if an effect moves the mount against its
// will, or the rider is knocked prone, the rider must make a DC 10 Dexterity
// save or fall prone in a space within 5 feet of the mount. A save is not
// required when the rider dismounts deliberately.
export const DISMOUNT_SAVE_DC = 10;

export type DismountCause = "forced-move" | "mount-prone" | "rider-prone" | "voluntary";

export function dismountSave(cause: DismountCause): { dc: number; ability: "dex" } | null {
  return cause === "voluntary" ? null : { dc: DISMOUNT_SAVE_DC, ability: "dex" };
}

// PHB p.198: mounting or dismounting costs half the rider's movement.
export function mountCost(riderSpeed: number): number {
  return Math.floor(Math.max(0, riderSpeed) / 2);
}

// ---- vehicles ----

export type VehicleProfile = {
  slug: string;
  name: string;
  // Miles per hour on the surface it belongs to.
  mph: number;
  // Pounds of cargo.
  capacity: number;
  // How many hands it needs to move at all.
  crew: number;
  passengers: number;
  blurb: string;
};

export const VEHICLES: VehicleProfile[] = [
  { slug: "cart", name: "Cart", mph: 2, capacity: 200, crew: 1, passengers: 2, blurb: "One draft animal, one bad axle." },
  { slug: "wagon", name: "Wagon", mph: 2, capacity: 2000, crew: 1, passengers: 8, blurb: "The party's baggage train." },
  { slug: "carriage", name: "Carriage", mph: 2, capacity: 600, crew: 1, passengers: 4, blurb: "For arriving somewhere respectable." },
  { slug: "rowboat", name: "Rowboat", mph: 1.5, capacity: 300, crew: 1, passengers: 3, blurb: "Crosses a river. Slowly." },
  { slug: "keelboat", name: "Keelboat", mph: 1, capacity: 4000, crew: 1, passengers: 6, blurb: "River and coastal trade." },
  { slug: "longship", name: "Longship", mph: 3, capacity: 10000, crew: 40, passengers: 150, blurb: "Oars and a sail; beaches anywhere." },
  { slug: "sailing-ship", name: "Sailing ship", mph: 2, capacity: 100000, crew: 20, passengers: 20, blurb: "Open water and a hold worth raiding." },
  { slug: "galley", name: "Galley", mph: 4, capacity: 150000, crew: 80, passengers: 40, blurb: "Fast, hungry for rowers." },
  { slug: "airship", name: "Airship", mph: 8, capacity: 8000, crew: 10, passengers: 20, blurb: "Where the setting allows one." },
];

export function vehicleProfile(ref: string): VehicleProfile | null {
  const needle = ref.trim().toLowerCase();
  return (
    VEHICLES.find((vehicle) => vehicle.slug === needle) ??
    VEHICLES.find((vehicle) => vehicle.name.toLowerCase() === needle) ??
    VEHICLES.find((vehicle) => vehicle.name.toLowerCase().includes(needle)) ??
    null
  );
}

// How far a vehicle gets in a stretch of travel, and whether it can move at
// all. Undercrewed is not a refusal: a longship with ten rowers still moves,
// just badly, and telling the table that is more useful than stopping them.
export function vehicleTravel(
  vehicle: VehicleProfile,
  hours: number,
  crewAboard: number,
): { miles: number; note: string } {
  const ratio = vehicle.crew > 0 ? Math.min(1, crewAboard / vehicle.crew) : 1;
  // Below half crew a vessel is barely under way; the halving is ODM's own
  // simplification of a rule the SRD does not print, and is called out as
  // such rather than passed off as 5e.
  const factor = ratio >= 1 ? 1 : ratio >= 0.5 ? 0.75 : 0.5;
  const miles = Math.round(vehicle.mph * Math.max(0, hours) * factor * 10) / 10;
  const note =
    factor === 1
      ? `${vehicle.name}: ${vehicle.mph} mph, fully crewed.`
      : `${vehicle.name} is undercrewed (${crewAboard} of ${vehicle.crew}); it makes ${Math.round(factor * 100)}% of its speed.`;
  return { miles, note };
}

export function describeMount(state: MountState): string {
  return `${state.name}, speed ${state.speed} ft.${state.controlled ? ", controlled (shares your initiative)" : ", independent (acts on its own initiative)"}`;
}
