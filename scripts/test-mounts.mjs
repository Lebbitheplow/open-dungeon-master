// Mounts and vehicles: who can ride what, what it costs, and how fast a
// vessel actually moves.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  canCarry,
  checkMount,
  describeMount,
  DISMOUNT_SAVE_DC,
  dismountSave,
  MOUNTS,
  mountCost,
  mountProfile,
  mountedSpeed,
  VEHICLES,
  vehicleProfile,
  vehicleTravel,
} = await import("../src/lib/srd/mounts.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a mount is findable by slug, by name, and loosely", () => {
  assert.equal(mountProfile("warhorse").slug, "warhorse");
  assert.equal(mountProfile("Riding horse").slug, "riding-horse");
  assert.equal(mountProfile("griffon").speed, 80);
  assert.equal(mountProfile("wyvern"), null);
});

test("every listed mount has a speed and a size", () => {
  for (const mount of MOUNTS) {
    assert.ok(mount.speed > 0, `${mount.slug} needs a speed`);
    assert.ok(mount.size, `${mount.slug} needs a size`);
  }
});

test("PHB p.198: a mount must be one size larger than its rider", () => {
  assert.equal(canCarry("large", "medium"), true);
  assert.equal(canCarry("medium", "small"), true);
  assert.equal(canCarry("medium", "medium"), false);
  assert.equal(canCarry("small", "medium"), false);
});

test("a medium rider cannot take a pony, and is told which rule refused", () => {
  const refused = checkMount({ ref: "pony", riderSize: "medium" });
  assert.ok("error" in refused);
  assert.match(refused.error, /one size larger/);
});

test("a small rider can take a pony", () => {
  const ok = checkMount({ ref: "pony", riderSize: "small" });
  assert.equal(ok.ok, true);
  assert.equal(ok.state.speed, 40);
});

test("an unknown mount is refused with a way forward", () => {
  const refused = checkMount({ ref: "manticore", riderSize: "medium" });
  assert.ok("error" in refused);
  assert.match(refused.error, /Describe one/);
});

test("a custom beast is taken on trust except for the size rule", () => {
  const ok = checkMount({
    ref: "",
    riderSize: "medium",
    custom: { name: "Ashen drake", speed: 70, controlled: true, size: "large" },
  });
  assert.equal(ok.state.name, "Ashen drake");
  assert.equal(ok.state.speed, 70);
  const refused = checkMount({
    ref: "",
    riderSize: "medium",
    custom: { name: "Riding cat", speed: 40, controlled: true, size: "medium" },
  });
  assert.ok("error" in refused);
});

test("an independent mount is marked as one", () => {
  assert.equal(checkMount({ ref: "griffon", riderSize: "medium" }).state.controlled, false);
  assert.equal(checkMount({ ref: "warhorse", riderSize: "medium" }).state.controlled, true);
});

test("a rider moves at the mount's speed, not their own", () => {
  const state = checkMount({ ref: "warhorse", riderSize: "medium" }).state;
  assert.equal(mountedSpeed(state, 30), 60);
  // A fast rider on a slow horse travels at the horse's pace.
  assert.equal(mountedSpeed(checkMount({ ref: "draft-horse", riderSize: "medium" }).state, 50), 40);
  assert.equal(mountedSpeed(null, 30), 30);
});

test("mounting costs half the rider's movement", () => {
  assert.equal(mountCost(30), 15);
  assert.equal(mountCost(25), 12);
  assert.equal(mountCost(0), 0);
});

test("being thrown calls for the save; choosing to get off does not", () => {
  assert.deepEqual(dismountSave("forced-move"), { dc: DISMOUNT_SAVE_DC, ability: "dex" });
  assert.deepEqual(dismountSave("rider-prone"), { dc: DISMOUNT_SAVE_DC, ability: "dex" });
  assert.equal(dismountSave("voluntary"), null);
});

test("a mount describes itself with what matters at the table", () => {
  const line = describeMount(checkMount({ ref: "warhorse", riderSize: "medium" }).state);
  assert.match(line, /Warhorse/);
  assert.match(line, /60 ft/);
  assert.match(line, /shares your initiative/);
});

test("a vehicle is findable, and every one has a crew and a capacity", () => {
  assert.equal(vehicleProfile("longship").crew, 40);
  assert.equal(vehicleProfile("Sailing ship").slug, "sailing-ship");
  assert.equal(vehicleProfile("submarine"), null);
  for (const vehicle of VEHICLES) {
    assert.ok(vehicle.mph > 0);
    assert.ok(vehicle.capacity > 0);
  }
});

test("a fully crewed vessel makes its speed", () => {
  const trip = vehicleTravel(vehicleProfile("longship"), 8, 40);
  assert.equal(trip.miles, 24);
  assert.match(trip.note, /fully crewed/);
});

test("undercrewed is slower, and says so rather than refusing", () => {
  const half = vehicleTravel(vehicleProfile("longship"), 8, 20);
  assert.equal(half.miles, 18);
  assert.match(half.note, /undercrewed/);
  const skeleton = vehicleTravel(vehicleProfile("longship"), 8, 5);
  assert.equal(skeleton.miles, 12);
});

console.log(`mounts: ${passed} tests passed`);
