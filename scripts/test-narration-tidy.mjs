// What the table reads of a turn (src/lib/dm/narration-tidy-logic.ts): a
// fight's bookkeeping taken out of the story, and each sentence said once.
// The inputs are what Qwen3.6-35B at Q2 wrote on an AMD BC-250 on the full
// rules, word for word.
import assert from "node:assert/strict";
import { repeatsNarration, withoutCombatBookkeeping, withoutRepeatedSentences, withoutToolTalk } from "../src/lib/dm/narration-tidy-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

const FIGHT = ["Avery", "Bram", "Silent Cultist 1", "Silent Cultist 2", "Silenced Captain", "Masked Thug 1", "Masked Thug 2"];

check("a turn order recited on one line goes, with the heading that opened the fight", () => {
  assert.equal(
    withoutCombatBookkeeping(
      "**Combat begins.** The undead are surprised. 1. Avery (14) 2. Silent Cultist 2 3. Bram (9) 4. Silent Cultist 1 5. Silenced Captain (12) It is Avery's turn.",
      FIGHT,
      "english",
    ),
    "The undead are surprised. It is Avery's turn.",
  );
});

check("a bold list goes with the clause that introduced it, and the story after it stays", () => {
  assert.equal(
    withoutCombatBookkeeping(
      "Avery takes initiative with a roll of 21, while Bram rolls a 6. The updated order is: 1. **Masked Thug 1** 2. **Avery** 3. **Masked Thug 2** 4. **Bram** **Masked Thug 1** is now directly in Avery's path.",
      FIGHT,
      "english",
    ),
    "Avery takes initiative with a roll of 21, while Bram rolls a 6. **Masked Thug 1** is now directly in Avery's path.",
  );
});

check("what is left of a recited order, and a turn heading, go", () => {
  assert.equal(
    withoutCombatBookkeeping("**Avery's Turn** The thug that attacked you recovers its balance. 1. 2. **Avery** **Bram**", FIGHT, "english"),
    "The thug that attacked you recovers its balance.",
  );
});

check("a round heading and a bulleted summary of the round go", () => {
  assert.equal(
    withoutCombatBookkeeping("**Round 1:**\n* **Masked Thug 1 attacks Bram.**\nThe thugs act on the surprised party's lost turn.", FIGHT, "english"),
    "The thugs act on the surprised party's lost turn.",
  );
});

check("a numbered list of anything but the fight's own names stays", () => {
  const text = "You could: 1. Run for the door 2. Fight them here.";
  assert.equal(withoutCombatBookkeeping(text, FIGHT, "english"), text);
});

check("with no fight running nothing is taken", () => {
  const text = "**Combat begins.** 1. Avery (14) 2. Bram (9)";
  assert.equal(withoutCombatBookkeeping(text, [], "english"), text);
});

check("at every other table the English headings stay as written, and the recited order and the bulleted summary go by the fight's own names", () => {
  for (const language of ["italian", "french", "spanish", "german"]) {
    assert.equal(
      withoutCombatBookkeeping("**Avery's Turn** La nebbia sale. 1. Avery (14) 2. Silent Cultist 2 3. Bram (9)\n* **Masked Thug 1 attacks Bram.**", FIGHT, language),
      "**Avery's Turn** La nebbia sale.",
      language,
    );
  }
});

check("a later call repeating the earlier call's prose says it once", () => {
  assert.deepEqual(
    withoutRepeatedSentences([
      "The inn erupts into chaos as two masked figures burst in. Jory screams.\n\nIt is Avery's turn. What do you do?",
      "The inn erupts into chaos as two masked figures burst in. Bram draws his blade with a curse.",
    ]),
    ["The inn erupts into chaos as two masked figures burst in. Jory screams.\n\nIt is Avery's turn. What do you do?", "Bram draws his blade with a curse."],
  );
});

check("a reply printed twice in one part keeps one copy, and short lines may repeat", () => {
  const paragraph = "The first thug swings, his club whistling through the air at Bram's head.";
  assert.deepEqual(withoutRepeatedSentences([`${paragraph} "Run!" "Run!"\n\n${paragraph}`]), [`${paragraph} "Run!" "Run!"`]);
});

check("a part left with nothing is dropped", () => {
  const line = "Mist curls over the ford, cold and grey in the morning light.";
  assert.deepEqual(withoutRepeatedSentences([line, line]), [line]);
});

check("a reply that is mostly the last turn's narration is a repeat; one shared line or a new scene is not", () => {
  const last =
    "Avery's blade flashes in the dim light of the ravine. The goblin staggers back against the rocks, snarling. The second goblin circles to your left, spear raised. What will you do?";
  assert.equal(repeatsNarration(last, last), true);
  assert.equal(repeatsNarration(`${last} The wind picks up.`, last), true);
  const fresh =
    "Your sword bites deep into the goblin's shoulder and it drops its spear with a howl. The second goblin circles to your left, spear raised. Bram, you are up.";
  assert.equal(repeatsNarration(fresh, last), false, "one sentence carried over is not a repeat");
  assert.equal(repeatsNarration("The goblin staggers back against the rocks, snarling.", last), false, "one sentence is too little to judge");
  assert.equal(repeatsNarration(last, ""), false);
});

check("a sentence naming a DM tool is the model thinking aloud and goes; tool names that are words stay", () => {
  const leaked =
    'Bram presses forward through the mud. The correct next step is to call move_token for Bram to move somewhere. So we interpret: he intends to close in. The goblin snarls.';
  assert.equal(withoutToolTalk(leaked), "Bram presses forward through the mud. So we interpret: he intends to close in. The goblin snarls.");
  const story = "You travel north for a day, then heal at the shrine before you lift the gate.";
  assert.equal(withoutToolTalk(story), story);
});

console.log(`narration tidy: ${passed} checks passed`);
