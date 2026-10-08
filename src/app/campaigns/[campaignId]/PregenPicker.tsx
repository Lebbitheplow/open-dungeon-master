"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

type Hero = { id: string; name: string; tagline: string; blurb: string };

// Ready-made heroes for a seat with no character yet
// (src/lib/starter/pregens.ts). One click seats the hero; the sheet lands
// in the player's library too, so it can be kept, edited or brought to
// another table. Offered in every lobby, not only the starter's: a friend
// who joined with a room code and ten minutes to spare is who it is for.
export function PregenPicker({ campaignId }: { campaignId: string }) {
  const [heroes, setHeroes] = useState<Hero[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/starter")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { pregens?: Hero[] } | null) => setHeroes(data?.pregens ?? []))
      .catch(() => setHeroes([]));
  }, []);

  async function pick(id: string) {
    setBusyId(id);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet/pregen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not seat that hero.");
      }
    } finally {
      setBusyId("");
    }
  }

  if (!heroes?.length) {
    return null;
  }
  return (
    <div className={cn(ui.card, "space-y-2 px-4 py-3")} data-tour="pregen-picker">
      <p className="text-xs uppercase tracking-wide text-stone-500">Or take a ready-made hero</p>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {heroes.map((hero) => (
          <li key={hero.id}>
            <button
              type="button"
              onClick={() => pick(hero.id)}
              disabled={busyId !== ""}
              aria-busy={busyId === hero.id}
              className="motion-press flex w-full flex-col items-start rounded-lg border border-stone-800 bg-stone-950/50 px-3 py-2 text-left hover:border-amber-500/40 disabled:opacity-60"
            >
              <span className="flex items-center gap-1.5 text-sm text-stone-100">
                {busyId === hero.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {hero.tagline}
              </span>
              <span className="text-xs text-stone-500">{hero.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="motion-shake text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
