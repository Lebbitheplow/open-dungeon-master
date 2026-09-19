"use client";

import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Player-to-player trade (docs/vtt-parity-implementation-plan.md 11.2): two
// columns, what I hand over and what I ask for, coins under each. The
// server checks both sides now and again when the other player accepts.

type Picked = Record<string, number>;

function ItemPicker({ sheet, picked, onChange, title }: { sheet: CharacterSheet; picked: Picked; onChange: (next: Picked) => void; title: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{title}</p>
      {sheet.equipment.length ? (
        <ul className="reveal max-h-48 space-y-0.5 overflow-y-auto pr-1">
          {sheet.equipment.map((item) => {
            const qty = picked[item.name] ?? 0;
            return (
              <li key={item.name} className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  aria-pressed={qty > 0}
                  onClick={() => onChange({ ...picked, [item.name]: qty > 0 ? 0 : 1 })}
                  className={cn("min-w-0 flex-1 truncate rounded border px-1.5 py-0.5 text-left", qty > 0 ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-stone-800 text-stone-400 hover:text-stone-200")}
                >
                  {item.name}
                  {item.qty > 1 ? <span className="text-stone-500"> x{item.qty}</span> : null}
                </button>
                {qty > 0 && item.qty > 1 ? (
                  <NumberStepper
                    min={1}
                    max={item.qty}
                    value={qty}
                    onChange={(next) => onChange({ ...picked, [item.name]: Math.max(1, Math.min(item.qty, next || 1)) })}
                    label={`How many ${item.name}`}
                    size="sm"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[11px] italic text-stone-600">Nothing carried.</p>
      )}
    </div>
  );
}

function CoinField({ label, max, value, onChange }: { label: string; max: number; value: number; onChange: (gold: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] text-stone-400">
      {label}
      <NumberStepper min={0} max={max} value={value} onChange={(next) => onChange(Math.max(0, Math.min(max, next || 0)))} label={label} size="sm" />
      <span className="text-stone-500">gp of {max}</span>
    </div>
  );
}

export function TradeDialog({ campaignId, me, them, onClose }: { campaignId: string; me: CharacterSheet; them: CharacterSheet; onClose: () => void }) {
  const [give, setGive] = useState<Picked>({});
  const [want, setWant] = useState<Picked>({});
  const [giveGold, setGiveGold] = useState(0);
  const [wantGold, setWantGold] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lines = (picked: Picked) => Object.entries(picked).filter(([, qty]) => qty > 0).map(([name, qty]) => ({ name, qty }));
  const empty = !lines(give).length && !lines(want).length && !giveGold && !wantGold;

  async function offer() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/item-proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toCharacterId: them.id, give: lines(give), giveCp: giveGold * 100, want: lines(want), wantCp: wantGold * 100 }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(String(data.error ?? "The offer could not be made."));
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())} title={`Trade with ${them.name}`} icon={<ArrowLeftRight className="size-4 text-amber-400" />} width="w-[min(94vw,40rem)]">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/50 p-2.5">
          <p className="font-display text-sm text-amber-100">{me.name} gives</p>
          <ItemPicker sheet={me} picked={give} onChange={setGive} title="From my pack" />
          <CoinField label="Coin" max={me.gold} value={giveGold} onChange={setGiveGold} />
        </div>
        <div className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/50 p-2.5">
          <p className="font-display text-sm text-amber-100">{them.name} gives</p>
          <ItemPicker sheet={them} picked={want} onChange={setWant} title="From their pack" />
          <CoinField label="Coin" max={them.gold} value={wantGold} onChange={setWantGold} />
        </div>
      </div>
      {error ? <p className="motion-shake mt-2 text-[11px] text-red-400">{error}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded border border-stone-700 px-3 py-1 text-xs text-stone-400 hover:bg-stone-900">
          Never mind
        </button>
        <button type="button" disabled={busy || empty} onClick={() => void offer()} className="flex items-center gap-1 rounded border border-amber-700 bg-amber-950/50 px-3 py-1 text-xs text-amber-100 disabled:opacity-50">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <ArrowLeftRight className="size-3" />} Offer the trade
        </button>
      </div>
    </Dialog>
  );
}
