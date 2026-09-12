"use client";

import { X } from "lucide-react";
import { ContentPick } from "@/components/ui/ContentPick";
import { normalizeCreatureType } from "@/lib/bestiary/statblock";
import { cn } from "@/lib/cn";
import { MonsterTile, ui } from "@/lib/ui";
import { packArtKey } from "@/lib/worlds/art";
import { input, removeAt, replaceAt, type SectionProps } from "@/app/workshop/plugin/types";

// The pack's bestiary: real stat blocks wearing the world's names. A row is
// picked from the content pack, which supplies the slug, the challenge
// rating and the creature type, none of which a person should ever type;
// they write the name and a line. A monster built by hand in the Bestiary
// tool has no slug and cannot be here, which src/lib/workshop/to-pack.ts
// explains in its refusal.

function formatCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

export function MonsterSection({ draft, onDraft }: SectionProps) {
  const list = draft.monsters;
  const set = (next: typeof list) => onDraft({ ...draft, monsters: next });
  return (
    <section className={ui.card + " p-4"}>
      <h3 className="font-display text-base tracking-wide text-amber-200">Monsters</h3>
      <p className="mb-3 text-[11px] text-stone-500">
        Pick a creature from the content pack and give it the world&apos;s name. The stat block, rating and type come with it. Upload a picture for it under Pictures.
      </p>
      <div className="space-y-1.5">
        {list.map((entry, index) => (
          <div key={`${entry.slug}-${index}`} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-stone-800 p-2">
            <MonsterTile
              type={entry.type || null}
              cr={entry.cr}
              genre={draft.baseGenre}
              seed={entry.slug}
              art={draft.art[packArtKey("monster", entry.slug)] ?? null}
              size="size-8"
            />
            <span className="w-full text-[11px] text-stone-400 sm:w-40">
              {entry.slug}
              <span className="block text-stone-600">
                CR {formatCr(entry.cr)}
                {entry.type ? `, ${entry.type}` : ""}
              </span>
            </span>
            <input
              value={entry.name}
              maxLength={60}
              placeholder="Called here"
              aria-label={`Name for ${entry.slug}`}
              onChange={(event) => set(replaceAt(list, index, { ...entry, name: event.target.value }))}
              className={cn(input, "w-40 min-w-0")}
            />
            <input
              value={entry.blurb}
              maxLength={200}
              placeholder="One line about it"
              aria-label="Blurb"
              onChange={(event) => set(replaceAt(list, index, { ...entry, blurb: event.target.value }))}
              className={cn(input, "min-w-0 flex-1")}
            />
            <button
              type="button"
              onClick={() => set(removeAt(list, index))}
              aria-label={`Remove ${entry.slug}`}
              className="rounded-md p-1 text-stone-600 hover:text-red-300"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <ContentPick
          kind="monsters"
          label="Find a monster to rename"
          placeholder="Find a monster to rename"
          onPick={(entry) => {
            if (entry.source !== "open5e" || list.some((current) => current.slug === entry.slug)) {
              return;
            }
            set([
              ...list,
              {
                slug: entry.slug,
                name: "",
                cr: typeof entry.data.cr === "number" ? entry.data.cr : 0,
                type: normalizeCreatureType(entry.data.type) ?? "",
                blurb: "",
              },
            ]);
          }}
        />
        <p className="mt-1 text-[11px] text-stone-500">
          Only content-pack creatures can be listed; a hand-built monster has no stat block on the other server.
        </p>
      </div>
    </section>
  );
}
