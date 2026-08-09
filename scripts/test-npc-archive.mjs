// NPC roster auto-archiving: the staleness threshold, every protection rule,
// and restore-on-mention.
import assert from "node:assert/strict";
import {
  ARCHIVE_ENGAGED_CEILING,
  ARCHIVE_IGNORED_CHAPTERS,
  findArchivedToRestore,
  mentionsNpc,
  shouldArchive,
} from "../src/lib/dm/npc-archive-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

const stale = (extra = {}) => ({
  id: "n1",
  name: "Marla",
  ignored: ARCHIVE_IGNORED_CHAPTERS,
  engaged: 0,
  ...extra,
});

check("an NPC unmentioned past the threshold archives", () => {
  const decision = shouldArchive(stale());
  assert.equal(decision.archive, true);
  assert.match(decision.reason, /unmentioned for/);
});

check("one chapter short of the threshold is kept", () => {
  assert.equal(shouldArchive(stale({ ignored: ARCHIVE_IGNORED_CHAPTERS - 1 })).archive, false);
});

check("archiving waits well past the point the DM is told they are ignored", () => {
  // pressureState() calls an NPC "ignored" at 2; that is a behavioural note,
  // not grounds for removing them from the prompt.
  assert.ok(ARCHIVE_IGNORED_CHAPTERS > 2, "archiving is a stronger claim than the note");
  assert.equal(shouldArchive(stale({ ignored: 2 })).archive, false);
});

check("a recently courted NPC stays even when the last stretch is quiet", () => {
  const decision = shouldArchive(stale({ engaged: ARCHIVE_ENGAGED_CEILING + 1 }));
  assert.equal(decision.archive, false);
  assert.match(decision.reason, /heavily involved/);
});

check("engagement at the ceiling still archives", () => {
  assert.equal(shouldArchive(stale({ engaged: ARCHIVE_ENGAGED_CEILING })).archive, true);
});

check("a romance is never archived", () => {
  // The regression this exists to prevent: dropping someone the party is
  // entangled with out of the prompt mid-thread.
  const decision = shouldArchive(stale({ hasRomance: true, ignored: 99 }));
  assert.equal(decision.archive, false);
  assert.match(decision.reason, /romance/);
});

check("standing and unfinished goals also protect", () => {
  for (const flag of ["hasRelationship", "hasBond", "hasPendingGoal"]) {
    const decision = shouldArchive(stale({ [flag]: true, ignored: 99 }));
    assert.equal(decision.archive, false, `${flag} protects`);
    assert.ok(decision.reason.length > 0, `${flag} explains why`);
  }
});

check("an already-archived NPC is not archived twice", () => {
  const decision = shouldArchive(stale({ archived: true }));
  assert.equal(decision.archive, false);
  assert.match(decision.reason, /already archived/);
});

check("name matching is word-bounded", () => {
  // A substring check would resurrect "Al" every time the DM wrote "always".
  const al = { id: "n2", name: "Al", ignored: 0, engaged: 0 };
  assert.equal(mentionsNpc("we walk along the wall", al), false);
  assert.equal(mentionsNpc("Al waves from the bar", al), true);
});

check("aliases count for restoring", () => {
  const npc = { id: "n1", name: "Marla", aliases: ["Captain Marla"], ignored: 0, engaged: 0 };
  assert.equal(mentionsNpc("Captain Marla returns", npc), true);
});

check("naming an archived NPC restores exactly them", () => {
  const archived = [
    { id: "n1", name: "Marla", archived: true, ignored: 9, engaged: 0 },
    { id: "n2", name: "Bren", archived: true, ignored: 9, engaged: 0 },
  ];
  assert.deepEqual(findArchivedToRestore("Marla steps out of the crowd.", archived), ["n1"]);
  assert.deepEqual(findArchivedToRestore("nobody we know is here", archived), []);
});

check("a live NPC is never in the restore set", () => {
  const npcs = [{ id: "n1", name: "Marla", archived: false, ignored: 0, engaged: 0 }];
  assert.deepEqual(findArchivedToRestore("Marla waves", npcs), []);
});

console.log(`npc-archive: ${passed} tests passed`);
