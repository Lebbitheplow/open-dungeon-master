"use client";

import { Mic2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CastMember } from "@/lib/dm/cast";
import type { Speaker } from "@/lib/dm/speech";

// Who the DM is speaking as (docs/vtt-parity-implementation-plan.md 8.1):
// the narrator, anyone in the cast, or a monster on the board. Sits under
// the composer's modes when the seat is narrating.

export function SpeakerPicker({
  speaker,
  onChange,
  cast,
  monsters,
}: {
  speaker: Speaker | null;
  onChange: (speaker: Speaker | null) => void;
  cast: CastMember[];
  monsters: Array<{ id: string; name: string }>;
}) {
  const value = speaker ? `${speaker.kind}:${speaker.id || speaker.name}` : "narrator";
  const face = speaker?.kind === "npc" ? cast.find((member) => member.id === speaker.id)?.portraitUrl : "";
  return (
    <label className="mb-2 flex items-center gap-1.5 text-[11px] text-stone-400">
      {face ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={face} alt="" className="size-6 rounded-full border border-amber-700/60 object-cover" />
      ) : (
        <Mic2 className="size-3.5 text-amber-600" />
      )}
      Speaking as
      <select
        value={value}
        onChange={(event) => {
          const [kind, rest] = event.target.value.split(":", 2);
          if (kind === "npc") {
            const member = cast.find((entry) => entry.id === rest);
            onChange(member ? { kind: "npc", id: member.id, name: member.name } : null);
          } else if (kind === "monster") {
            const monster = monsters.find((entry) => entry.id === rest);
            onChange(monster ? { kind: "monster", id: monster.id, name: monster.name } : null);
          } else {
            onChange(null);
          }
        }}
        className={cn(
          "rounded-md border bg-stone-950 px-1.5 py-1 text-[11px]",
          speaker ? "border-amber-700 text-amber-100" : "border-stone-700 text-stone-300",
        )}
      >
        <option value="narrator">The narrator</option>
        {cast.length ? (
          <optgroup label="The cast">
            {cast.map((member) => (
              <option key={member.id} value={`npc:${member.id}`}>
                {member.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {monsters.length ? (
          <optgroup label="On the board">
            {monsters.map((monster) => (
              <option key={monster.id} value={`monster:${monster.id}`}>
                {monster.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
