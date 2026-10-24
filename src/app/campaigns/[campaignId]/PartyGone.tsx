"use client";

import { useEffect, useRef, useState } from "react";
import { DEPART_MS, DEPARTING_KEPT_MS, type DepartingSheet, type GoneEntry } from "@/app/campaigns/[campaignId]/departing";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { textKey } from "@/lib/language/text-logic";
import { CharacterPortrait } from "@/lib/ui";
import { usePackArt } from "@/lib/worlds/use-pack-art";

// The companions who left the party (issue 503), at the foot of the Party
// panel. A departure the server makes (a companion's conscience walking it
// out, slipping away, reporting the party, or a plain parting) arrives with
// the sheet's going (sheet_deleted's `departed`): its card stays where the
// party can see it and dims over 600 ms, then files under "Gone" with how
// they went. Reduced motion keeps the colour and the words and drops the
// movement. Every seat sees the same list; nothing here is a secret, and a
// plan a companion still holds never reaches it.

export function PartyGone({
  campaignId,
  departing,
  refreshKey,
  worldPack,
}: {
  campaignId: string;
  departing: readonly DepartingSheet[];
  refreshKey: number;
  worldPack: string;
}) {
  const packArt = usePackArt(worldPack);
  const [gone, setGone] = useState<GoneEntry[]>([]);
  // Departures whose dimming has run: their card is gone and their row is
  // the one that just arrived.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const [arrived, setArrived] = useState("");
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let live = true;
    void fetch(`/api/campaigns/${campaignId}/companions/gone`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { gone?: GoneEntry[] } | null) => {
        if (live && body?.gone) {
          setGone(body.gone);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [campaignId, refreshKey, settled]);

  // Read once per render: the moment a card has been leaving for.
  const [now] = useState(() => Date.now());
  const leaving = departing.filter((entry) => !settled.has(entry.sheet.id) && now - entry.at < DEPARTING_KEPT_MS);

  useEffect(() => {
    const running = timers.current;
    for (const entry of leaving) {
      if (running.has(entry.sheet.id)) {
        continue;
      }
      running.set(
        entry.sheet.id,
        setTimeout(() => {
          running.delete(entry.sheet.id);
          setSettled((before) => new Set([...before, entry.sheet.id]));
          setArrived(textKey(entry.sheet.name));
        }, DEPART_MS),
      );
    }
  }, [leaving]);

  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of running.values()) {
        clearTimeout(timer);
      }
      running.clear();
    };
  }, []);

  // A row waits while its own card is still dimming: the same companion.
  const leavingNames = new Set(leaving.map((entry) => textKey(entry.sheet.name)));
  const rows = gone.filter((entry) => !leavingNames.has(textKey(entry.name)));
  if (!leaving.length && !rows.length) {
    return null;
  }
  return (
    <>
      {leaving.map(({ sheet, how }) => (
        <div
          key={sheet.id}
          data-departing={sheet.id}
          role="status"
          className="party-card party-card-departing panel flex items-center gap-2.5 rounded-xl p-3"
        >
          <CharacterPortrait
            url={sheet.portrait?.url}
            fallback={packArt.characterUrl({ race: sheet.race, class: sheet.class })}
            look={{ race: sheet.race, class: sheet.class, gender: sheet.gender }}
            alt=""
            size="size-12"
            className="party-card-portrait border-stone-700/50"
          />
          <span className="min-w-0">
            <span className="block truncate font-medium">{sheet.name}</span>
            <span className="block text-xs text-stone-400">{how || "Leaves the party"}</span>
          </span>
        </div>
      ))}
      {rows.length ? (
        <section className="party-gone mt-4 space-y-2" aria-labelledby={`party-gone-${campaignId}`} data-party-gone="">
          <SectionHead title={<span id={`party-gone-${campaignId}`}>Gone</span>} glyph="tab-party" level="h3" aside={rows.length} />
          <ul className="space-y-1.5">
            {rows.map((entry) => (
              <li
                key={entry.name}
                data-gone-entry={entry.name}
                className={cn("party-gone-row flex items-center gap-2.5 rounded-lg px-2 py-1.5", arrived === textKey(entry.name) && "party-gone-arrive")}
              >
                <CharacterPortrait
                  url={entry.portraitUrl}
                  fallback={packArt.characterUrl({ race: entry.race, class: entry.class })}
                  look={{ race: entry.race, class: entry.class, gender: entry.gender }}
                  alt=""
                  size="size-10"
                  className="shrink-0 border-stone-700/50"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-stone-200">{entry.name}</span>
                  <span className="block text-xs text-stone-400">{entry.how}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
