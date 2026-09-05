"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Dices } from "lucide-react";
import { ui } from "@/lib/ui";

// Monster lookup: the campaign's own genre catalog, then the exact numbers
// start_encounter would spawn. A CR with no match falls back to the DMG's
// by-CR baseline, which is arithmetic rather than invention.
//
// Moved here unchanged from DmTablesPanel so the workshop can fold it into
// a card of its own. The DM console still gets the open section it always
// had; the workshop passes collapsible and gets a header that opens it.

export const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none";

type StatblockMatch = { slug: string; name: string; cr: number; blurb: string };

export function StatblockFinder({
  campaignId,
  collapsible = false,
}: {
  campaignId: string;
  collapsible?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<StatblockMatch[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  // Closed by default in the workshop: the tables are what the DM came for,
  // and a lookup that is not in use should not push the rows down.
  const [open, setOpen] = useState(false);

  async function search() {
    setBusy(true);
    setDetail(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/assist/statblock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await response.json().catch(() => ({}));
      setMatches(data.matches ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function openStatblock(slug: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/assist/statblock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: slug }),
      });
      const data = await response.json().catch(() => ({}));
      setDetail(data.statblock ?? null);
    } finally {
      setBusy(false);
    }
  }

  const stats = detail?.stats as
    | { ac: number; maxHp: number; cr: number; speed: string; attacks: Array<{ name: string; toHit: number; damage: string }> }
    | undefined;

  const controls = (
    <>
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value.slice(0, 80))}
          placeholder="wolf, or leave empty for what fits the party"
          className={inputClass}
        />
        <button
          type="button"
          onClick={search}
          disabled={busy}
          className="shrink-0 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
        >
          Search
        </button>
      </div>
      {matches.length ? (
        <ul className="mt-1.5 space-y-1">
          {matches.map((match) => (
            <li key={match.slug}>
              <button
                type="button"
                onClick={() => openStatblock(match.slug)}
                className="w-full rounded-md border border-stone-800 px-2 py-1 text-left hover:border-stone-700"
              >
                <span className="text-xs text-stone-200">
                  {match.name}
                  <span className="ml-1.5 text-stone-500">CR {match.cr}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {stats ? (
        <div className="mt-1.5 rounded-md border border-stone-800 bg-stone-950/40 px-2 py-1.5 text-xs text-stone-300">
          <p className="text-stone-200">
            {String(detail?.name ?? "")}
            {detail?.synthesized ? (
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-300/80">
                DMG baseline
              </span>
            ) : null}
          </p>
          <p className="text-stone-500">
            AC {stats.ac} · {stats.maxHp} hp · CR {stats.cr} · speed {stats.speed}
          </p>
          {stats.attacks.map((attack) => (
            <p key={attack.name} className="text-stone-400">
              {attack.name}: +{attack.toHit} to hit, {attack.damage}
            </p>
          ))}
        </div>
      ) : null}
    </>
  );

  if (collapsible) {
    return (
      <section className={`${ui.card} p-3`}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left font-display text-sm tracking-wide text-amber-100"
        >
          <Dices className="size-4 text-amber-300" />
          Look up a monster
          {open ? (
            <ChevronDown className="ml-auto size-4 text-stone-500" />
          ) : (
            <ChevronRight className="ml-auto size-4 text-stone-500" />
          )}
        </button>
        {open ? <div className="mt-3">{controls}</div> : null}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <Dices className="size-3.5" />
        Look up a monster
      </p>
      {controls}
    </section>
  );
}
