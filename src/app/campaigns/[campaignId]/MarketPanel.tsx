"use client";

import { Coins, Loader2, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { formatCopper } from "@/lib/srd/currency";

// The market (docs/vtt-parity-implementation-plan.md 11.1): the shops at
// the party's place, stock as tiles with a price chip in coin, a Buy on
// each, the pack laid out to sell, a haggle button, and a coin arc into
// the purse when money moves. Whoever steers the story opens shops here
// or in the workshop and sees every shop in the world.

type StockView = { itemName: string; qty: number; priceCp: number; askingCp: number; note: string };
type ShopView = {
  id: string;
  name: string;
  kind: string;
  size: string;
  locationName: string;
  keeperName: string;
  keeperPortrait: string;
  stock: StockView[];
  buys: boolean;
  markup: number;
  haggledBy: string[];
};

const KINDS = ["general", "smith", "apothecary", "outfitter", "curiosities"] as const;
const SIZES = ["hamlet", "village", "town", "city"] as const;

export function MarketPanel({
  campaignId,
  steersStory,
  mySheet,
  refreshKey = 0,
  coins,
}: {
  campaignId: string;
  steersStory: boolean;
  mySheet: CharacterSheet | null;
  refreshKey?: number;
  coins?: { characterId: string; direction: "in" | "out"; at: number } | null;
}) {
  const [shops, setShops] = useState<ShopView[] | null>(null);
  const [here, setHere] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [draft, setDraft] = useState({ name: "", kind: "general", size: "village" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/shops`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { shops?: ShopView[]; here?: { id: string; name: string } | null }) => {
        if (!cancelled) {
          setShops(data.shops ?? []);
          setHere(data.here ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShops([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, refreshKey, reload]);

  async function counter(shop: ShopView, action: "buy" | "sell" | "haggle", item = "") {
    setBusy(`${shop.id}:${action}:${item}`);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/shops/${shop.id}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, item, qty: 1, characterId: mySheet?.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(data.error ?? "The keeper shakes their head."));
      } else if (action === "haggle") {
        setError(data.result?.success ? `Haggled well: prices ${data.result.prices}.` : `The keeper is unmoved: prices ${data.result?.prices ?? "rise"}.`);
      }
      setReload((current) => current + 1);
    } finally {
      setBusy("");
    }
  }

  async function open() {
    if (!draft.name.trim()) {
      return;
    }
    setBusy("open");
    try {
      await fetch(`/api/campaigns/${campaignId}/shops`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      setOpening(false);
      setDraft({ name: "", kind: "general", size: "village" });
      setReload((current) => current + 1);
    } finally {
      setBusy("");
    }
  }

  async function close(shop: ShopView) {
    if (!(await appConfirm(`Close ${shop.name} for good?`, { actionLabel: "Close it", tone: "danger" }))) {
      return;
    }
    await fetch(`/api/campaigns/${campaignId}/shops/${shop.id}`, { method: "DELETE" });
    setReload((current) => current + 1);
  }

  const purse = mySheet ? mySheet.gold * 100 + mySheet.copper : 0;
  const coinFx = coins && mySheet && coins.characterId === mySheet.id ? coins : null;

  if (shops === null) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-stone-500">
        <Loader2 className="size-3 animate-spin" /> Looking over the stalls...
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <ShoppingBag className="size-3.5 text-amber-600" /> Market{here ? <span className="text-stone-500">at {here.name}</span> : null}
        </p>
        {mySheet ? (
          <span key={coinFx?.at ?? 0} className="relative flex items-center gap-1 rounded-full border border-amber-900/60 bg-stone-950 px-2 py-0.5 text-[11px] text-amber-200">
            <Coins className="size-3" /> {formatCopper(purse)}
            {coinFx ? <span aria-hidden className={cn("coin-arc pointer-events-none absolute -left-3 top-1/2 text-amber-300", coinFx.direction === "out" && "coin-arc-out")}>●</span> : null}
          </span>
        ) : null}
      </div>
      {error ? <p className="text-[11px] text-amber-300/90">{error}</p> : null}
      {steersStory ? (
        opening ? (
          <div className="flex flex-wrap items-center gap-1 rounded border border-stone-800 bg-stone-950/60 p-2">
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} placeholder="Marla's Sundries" className="min-w-0 flex-1 rounded border border-stone-700 bg-stone-900 px-1.5 py-0.5 text-[11px] outline-none focus:border-amber-600" />
            <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })} className="rounded border border-stone-700 bg-stone-900 px-1 py-0.5 text-[11px]">
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <select value={draft.size} onChange={(event) => setDraft({ ...draft, size: event.target.value })} className="rounded border border-stone-700 bg-stone-900 px-1 py-0.5 text-[11px]">
              {SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy === "open" || !draft.name.trim()} onClick={() => void open()} className="rounded border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[11px] text-amber-100 disabled:opacity-50">
              Open here
            </button>
            <button type="button" onClick={() => setOpening(false)} className="rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setOpening(true)} className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900">
            <Plus className="size-3" /> Open a shop {here ? `at ${here.name}` : ""}
          </button>
        )
      ) : null}
      {!shops.length ? <p className="text-[11px] italic text-stone-600">{here ? `No shops at ${here.name}.` : "The party is nowhere with a market yet."}</p> : null}
      {shops.map((shop) => (
        <section key={shop.id} className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/40 p-2">
          <div className="flex items-center gap-2">
            {shop.keeperPortrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shop.keeperPortrait} alt="" className="size-9 rounded-full border border-amber-800/50 object-cover" />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-full border border-stone-700 bg-stone-900 text-amber-200">
                <ShoppingBag className="size-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-stone-200">{shop.name}</p>
              <p className="truncate text-[10px] text-stone-500">
                {shop.kind}
                {shop.keeperName ? `, kept by ${shop.keeperName}` : ""}
                {steersStory && shop.locationName ? ` at ${shop.locationName}` : ""}
                {shop.markup !== 1 ? ` (prices ${Math.round((shop.markup - 1) * 100)}%)` : ""}
              </p>
            </div>
            {mySheet && !shop.haggledBy.includes(mySheet.id) ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void counter(shop, "haggle")} className="rounded border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-amber-200 disabled:opacity-50">
                Haggle
              </button>
            ) : null}
            {steersStory ? (
              <button type="button" aria-label={`Close ${shop.name}`} onClick={() => void close(shop)} className="rounded p-1 text-stone-600 hover:text-red-300">
                <Trash2 className="size-3" />
              </button>
            ) : null}
          </div>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {shop.stock.map((line) => (
              <li key={line.itemName} className="flex flex-col justify-between rounded border border-stone-800 bg-stone-900/60 p-1.5 transition-transform duration-[var(--dur-quick,150ms)] hover:-translate-y-0.5">
                <span className="truncate text-[11px] text-stone-200" title={line.note || line.itemName}>
                  {line.itemName}
                </span>
                <span className="mt-1 flex items-center justify-between gap-1">
                  <span className="rounded-full border border-amber-900/60 px-1.5 text-[10px] text-amber-200">{formatCopper(line.askingCp)}</span>
                  <span className="text-[10px] text-stone-500">x{line.qty}</span>
                  {mySheet ? (
                    <button type="button" disabled={Boolean(busy) || purse < line.askingCp} onClick={() => void counter(shop, "buy", line.itemName)} className="rounded border border-amber-800/60 px-1.5 py-0.5 text-[10px] text-amber-100 hover:bg-amber-950/50 disabled:opacity-40">
                      {busy === `${shop.id}:buy:${line.itemName}` ? <Loader2 className="size-3 animate-spin" /> : "Buy"}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
            {!shop.stock.length ? <li className="col-span-full text-[11px] italic text-stone-600">Bare shelves.</li> : null}
          </ul>
          {shop.buys && mySheet?.equipment.length ? (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-stone-500 hover:text-stone-300">Sell from your pack</summary>
              <ul className="mt-1 flex flex-wrap gap-1">
                {mySheet.equipment.map((item) => (
                  <li key={item.name}>
                    <button type="button" disabled={Boolean(busy)} onClick={() => void counter(shop, "sell", item.name)} className="rounded border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-300 hover:border-amber-700 hover:text-amber-100 disabled:opacity-50">
                      {item.name}
                      {item.qty > 1 ? ` x${item.qty}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ))}
    </div>
  );
}
