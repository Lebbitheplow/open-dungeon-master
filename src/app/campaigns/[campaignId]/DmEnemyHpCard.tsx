"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { FieldLabel } from "@/app/campaigns/[campaignId]/DmConsoleParts";
import type { PublicEncounter } from "@/lib/db/encounter-view";

// The DM's hand on an enemy's hit points (U:UD9): the troll regenerates, a
// cult healer patched up the lieutenant, a number was mistyped. Only the DM
// seat reaches the route (src/app/api/campaigns/[campaignId]/dm/enemy-hp),
// and the engine's rules still hold: a dead or fled creature is not brought
// back this way, and a drop to 0 goes through Damage an enemy.
export function DmEnemyHpCard({
  campaignId,
  encounter,
}: {
  campaignId: string;
  encounter: PublicEncounter;
}) {
  const standing = (encounter.enemies ?? []).filter((enemy) => enemy.status === "alive");
  const [enemyId, setEnemyId] = useState("");
  const picked = standing.find((enemy) => enemy.id === enemyId) ?? null;
  const [hp, setHp] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  if (!standing.length) {
    return null;
  }
  const value = hp ?? picked?.currentHp ?? 1;

  async function save() {
    if (!picked) {
      return;
    }
    setBusy(true);
    setError("");
    setDone("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/enemy-hp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enemyId: picked.id, currentHp: value }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; name?: string; hp?: string; woke?: boolean };
      if (!response.ok) {
        setError(data.error ?? "The engine refused that.");
        return;
      }
      setDone(`${data.name ?? picked.name} now has ${data.hp ?? value} hit points${data.woke ? " and wakes" : ""}.`);
      setHp(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cn(ui.card, "reveal mt-3 space-y-2.5 p-3")} aria-label="Correct an enemy's hit points">
      <div>
        <p className="gold-title font-display text-sm tracking-wide">Correct an enemy&apos;s hit points</p>
        <p className="text-xs leading-snug text-stone-400">
          A regeneration, a healer, a slip on the tray. A drop to 0 goes through Damage an enemy.
        </p>
      </div>
      <div>
        <FieldLabel>Enemy</FieldLabel>
        <Select
          value={enemyId}
          onChange={(next) => {
            setEnemyId(next);
            setHp(null);
            setDone("");
            setError("");
          }}
          options={[
            { value: "", label: "Pick an enemy" },
            ...standing.map((enemy) => ({
              value: enemy.id,
              label: `${enemy.name}${enemy.currentHp !== undefined ? ` (${enemy.currentHp}/${enemy.maxHp})` : ""}`,
              icon: { kind: "glyph" as const, key: "system-bestiary" },
            })),
          ]}
          label="Enemy"
          placeholder="Pick an enemy"
        />
      </div>
      {picked ? (
        <div className="reveal flex flex-wrap items-center gap-2">
          <NumberStepper
            value={value}
            min={1}
            max={picked.maxHp ?? 10000}
            onChange={(next) => setHp(next)}
            label={`Hit points for ${picked.name}`}
            suffix={picked.maxHp !== undefined ? `/ ${picked.maxHp}` : undefined}
          />
          <button type="button" onClick={save} disabled={busy} aria-busy={busy} className={ui.btnPrimary}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Set
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="motion-shake text-xs text-red-300">
          {error}
        </p>
      ) : null}
      {done ? <p className="live-in text-xs text-emerald-300">{done}</p> : null}
    </section>
  );
}
