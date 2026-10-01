// The stage rows a token carries on the board (PlayerMapView.tokenConditions):
// every condition with what its metadata says (rounds, "until Kael's turn",
// "save ends (WIS 13)", who laid it), and for a character the combat state
// the engine keeps outside the condition list: concentration, exhaustion,
// the death track, a readied action. Before this a character's token showed
// a health word and bare condition names, so a concentrating cleric, a dying
// fighter and an exhausted ranger looked the same as anyone else.
//
// Pure; the board projection (view.ts) calls it and scripts/test-hand-engine.mjs
// drives it.
import { describeExhaustion, effectiveMaxHp } from "@/lib/dm/condition-logic";
import { healthWord, type HealthWord } from "@/lib/battlemap/health-words";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { regeneratingNote } from "@/lib/battlemap/regeneration-notes";
import { conditionNote, conditionNoteLine, type ConditionMetaLike } from "@/lib/battlemap/condition-notes";

export type StageRow = { id: string; label: string; rounds?: number; note?: string };

type Holder = {
  id: string;
  conditions: string[];
  conditionMeta?: Record<string, ConditionMetaLike | undefined>;
};

export function conditionStageRows(holder: Holder, nameOf: (id: string) => string | null): StageRow[] {
  return holder.conditions.map((condition) => {
    const meta = holder.conditionMeta?.[condition];
    const rounds = meta?.rounds;
    const note = conditionNoteLine(conditionNote(condition, meta, nameOf, holder.id), { skipCounted: true });
    return {
      id: condition.toLowerCase(),
      label: condition,
      ...(typeof rounds === "number" && rounds > 0 && !meta?.untilTurnOf ? { rounds } : {}),
      ...(note ? { note } : {}),
    };
  });
}

type CharacterHolder = Holder & {
  concentratingOn?: string | null;
  exhaustion?: number | null;
  deathSaves?: { successes: number; failures: number; stable?: boolean; dead?: boolean } | null;
  currentHp: number;
};

export function characterStageRows(sheet: CharacterHolder, nameOf: (id: string) => string | null): StageRow[] {
  const rows = conditionStageRows(sheet, nameOf);
  if (sheet.concentratingOn) {
    rows.push({ id: "concentrating", label: `Concentrating: ${sheet.concentratingOn}` });
  }
  const exhaustion = sheet.exhaustion ?? 0;
  if (exhaustion > 0) {
    rows.push({ id: "exhaustion", label: `Exhaustion ${exhaustion}`, note: describeExhaustion(exhaustion) });
  }
  const saves = sheet.deathSaves;
  if (saves && !saves.dead && sheet.currentHp <= 0) {
    rows.push(
      saves.stable
        ? { id: "unconscious", label: "Stable", note: "unconscious, no longer rolling death saves" }
        : {
            id: "unconscious",
            label: `Dying ${saves.successes}/${saves.failures}`,
            note: `death saves: ${saves.successes} success${saves.successes === 1 ? "" : "es"}, ${saves.failures} failure${saves.failures === 1 ? "" : "s"}`,
          },
    );
  }
  return rows;
}

// An enemy's rows: its conditions, its concentration, and a knockout named
// as one rather than read as dying.
export function enemyStageRows(
  enemy: Holder & { concentration?: string | null; currentHp: number },
  nameOf: (id: string) => string | null,
): StageRow[] {
  const rows = conditionStageRows(enemy, nameOf);
  if (enemy.concentration) {
    rows.push({ id: "concentrating", label: `Concentrating: ${enemy.concentration}` });
  }
  const knockedOut = enemy.currentHp <= 0 && enemy.conditionMeta?.unconscious?.source === "knocked out";
  // A troll down at 0 waiting to regenerate (src/lib/dm/regeneration.ts):
  // not dead, and not out of the fight either.
  const regenerating = enemy.currentHp <= 0 && enemy.conditionMeta?.unconscious?.source === "regenerating";
  const stopped = enemy.conditions.includes("regeneration stopped");
  return knockedOut
    ? rows.map((row) => (row.id === "unconscious" ? { ...row, label: "Knocked out", note: "alive at 0 hit points, out of the fight" } : row))
    : regenerating
      ? rows.map((row) =>
          row.id === "unconscious" ? { ...row, label: stopped ? "Down, dies at its turn" : "Down, regenerating", note: regeneratingNote(stopped) } : row,
        )
      : rows;
}

// A character's health word, read against the maximum the rules give right
// now (exhaustion 4 halves it, worn gear that sets Constitution raises it), as
// the party panel and the rail read it: a fighter at full hit points under
// exhaustion 4 is unharmed, not bloodied.
export function characterHealthWord(
  sheet: Pick<CharacterSheet, "currentHp" | "maxHp" | "exhaustion" | "level" | "abilities" | "equipment" | "deathSaves">,
): HealthWord {
  return healthWord(sheet.currentHp, effectiveMaxHp(sheet), { dead: Boolean(sheet.deathSaves?.dead) });
}
