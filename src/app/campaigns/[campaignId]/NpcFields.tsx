"use client";

import { Trash2 } from "lucide-react";
import { PERSONALITY_AXES } from "@/lib/dm/npc-logic";
import {
  AXIS_LABELS,
  BLANK_PERSONALITY,
  describeAxis,
  describeRelation,
  removeRelation,
  setRelation,
  type NpcDraft,
  type RelationGraph,
} from "@/lib/npcs/forge";

// The three parts of the NPC forge that are more than a text box.
//
// Split out of DmNpcForgePanel for the same reason MapTools was split out of
// the map studio: the panel around them is fetching, saving and error
// handling, and these are the fields themselves. Neither half decides
// anything; every change here becomes a draft the server validates
// (src/lib/npcs/forge.ts).

// Who somebody is, as words rather than as numbers. The slider moves an
// integer the engine drifts and compares; the label beside it is the only
// part a DM should have to think in.
export function PersonalitySliders({
  draft,
  onChange,
}: {
  draft: NpcDraft;
  onChange: (draft: NpcDraft) => void;
}) {
  const personality = draft.personality ?? BLANK_PERSONALITY;
  return (
    <>
      {PERSONALITY_AXES.map((axis) => (
        <label key={axis} className="flex items-center gap-2 text-[11px] text-stone-500">
          <span className="w-16 shrink-0">{AXIS_LABELS[axis].name}</span>
          <input
            type="range"
            min={-3}
            max={3}
            step={1}
            value={personality[axis] ?? 0}
            onChange={(event) =>
              onChange({
                ...draft,
                personality: { ...personality, [axis]: Number(event.target.value) },
              })
            }
            className="flex-1 accent-amber-500"
          />
          <span className="w-24 shrink-0 text-right text-stone-400">
            {describeAxis(axis, personality[axis] ?? 0)}
          </span>
        </label>
      ))}
      <p className="text-[10px] text-stone-600">
        These drift on their own as the party treats them well or badly. Neither is a real answer,
        and most people are unremarkable on most of it.
      </p>
    </>
  );
}

export const GOAL_FIELDS = [
  ["scene", "Right now, in the next scene"],
  ["session", "Working toward over a few sessions"],
  ["ambition", "What they would give up everything for"],
] as const;

export type GoalField = (typeof GOAL_FIELDS)[number][0];

// Typing a goal is not the same as generating one: an emptied box has to
// clear the goal, where a generated blank has to leave it alone.
export function setGoal(draft: NpcDraft, field: GoalField, value: string): NpcDraft {
  const text = value.slice(0, field === "ambition" ? 300 : 200);
  if (field === "session") {
    return {
      ...draft,
      goals: {
        ...draft.goals,
        session: text
          ? {
              text,
              // The progress belongs to the chapter engine, which advances it
              // on background dice; editing the words must not reset it.
              progress: draft.goals.session?.progress ?? 0,
              target: draft.goals.session?.target ?? 3,
            }
          : undefined,
      },
    };
  }
  return { ...draft, goals: { ...draft.goals, [field]: text || undefined } };
}

export function goalText(draft: NpcDraft, field: GoalField): string {
  return field === "session"
    ? draft.goals.session?.text ?? ""
    : (draft.goals[field] as string | undefined) ?? "";
}

// How somebody feels about other people, and the half of that a stored JSON
// field cannot say: whether the other person agrees, and whether they exist.
// Relations are stored per NPC, so a grudge is one-sided until the other side
// writes one back, which is true to life and worth showing.
export function RelationEditor({
  draft,
  graph,
  others,
  onChange,
}: {
  draft: NpcDraft;
  graph: RelationGraph;
  // Everyone else on the roster, so a link can be made by picking a name
  // rather than by typing one and hoping.
  others: string[];
  onChange: (draft: NpcDraft) => void;
}) {
  const edgeFor = (name: string) =>
    graph.edges.find((entry) => {
      const pair = [entry.from.toLowerCase(), entry.to.toLowerCase()];
      return pair.includes(name.toLowerCase()) && pair.includes(draft.name.toLowerCase());
    });

  return (
    <>
      {draft.relations.map((relation) => {
        const edge = edgeFor(relation.npcName);
        const theirScore = edge?.from === draft.name ? edge?.backScore ?? 0 : edge?.score ?? 0;
        return (
          <div key={relation.npcName} className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 shrink-0 truncate text-xs text-stone-300">
              {relation.npcName}
            </span>
            <input
              type="range"
              min={-3}
              max={3}
              step={1}
              value={relation.score}
              onChange={(event) =>
                onChange({
                  ...draft,
                  relations: setRelation(
                    draft.relations,
                    relation.npcName,
                    Number(event.target.value),
                    relation.note,
                  ),
                })
              }
              className="w-24 accent-amber-500"
            />
            <span className="w-20 shrink-0 text-[11px] text-stone-400">
              {describeRelation(relation.score)}
            </span>
            <input
              value={relation.note ?? ""}
              onChange={(event) =>
                onChange({
                  ...draft,
                  relations: setRelation(
                    draft.relations,
                    relation.npcName,
                    relation.score,
                    event.target.value,
                  ),
                })
              }
              placeholder="why"
              className="min-w-20 flex-1 rounded-md border border-stone-700 bg-stone-950 px-1.5 py-0.5 text-[11px] text-stone-400"
            />
            {edge?.dangling ? (
              <span className="text-[10px] text-amber-300/80">nobody by that name yet</span>
            ) : edge?.mutual ? (
              <span className="text-[10px] text-stone-600">
                they say {describeRelation(theirScore)}
              </span>
            ) : (
              <span className="text-[10px] text-stone-600">one-sided</span>
            )}
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...draft,
                  relations: removeRelation(draft.relations, relation.npcName),
                })
              }
              className="text-stone-600 hover:text-red-300"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-1">
        {others
          .filter(
            (name) =>
              !draft.relations.some(
                (relation) => relation.npcName.toLowerCase() === name.toLowerCase(),
              ),
          )
          .map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange({ ...draft, relations: setRelation(draft.relations, name, 0) })}
              className="rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-500 hover:text-stone-200"
            >
              + {name}
            </button>
          ))}
      </div>
    </>
  );
}
