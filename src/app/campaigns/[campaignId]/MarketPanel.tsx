"use client";

import { EmptyState } from "@/components/EmptyState";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { useEffect, useState } from "react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { formatCopper } from "@/lib/srd/currency";
import { KitButton, PanelLoading, panelField } from "./PanelKit";

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
const KIND_OPTIONS = KINDS.map((kind) => ({ value: kind as string, label: kind }));
const SIZE_OPTIONS = SIZES.map((size) => ({ value: size as string, label: size }));

// The coin a price is mostly made of, so a chip leads with the right metal.
function coinGlyph(copper: number): string {
  return copper >= 100 ? "coin-gp" : copper >= 10 ? "coin-sp" : "coin-cp";
}

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
    return <PanelLoading label="Looking over the stalls..." />;
  }
  return (
    <div className="space-y-2">
      <SectionHead
        title="Market"
        glyph="tab-market"
        aside={
          mySheet ? (
            <span key={coinFx?.at ?? 0} className="pk-chip relative py-0.5 text-xs text-amber-200">
              <GameIcon icon={{ kind: "glyph", key: "coin-purse" }} size="size-5" /> {formatCopper(purse)}
              {coinFx ? <span aria-hidden className={cn("coin-arc pointer-events-none absolute -left-3 top-1/2 text-amber-300", coinFx.direction === "out" && "coin-arc-out")}>●</span> : null}
            </span>
          ) : null
        }
      />
      {here ? <p className="-mt-1 text-xs text-stone-500">at {here.name}</p> : null}
      {error ? <p role="status" className="live-in text-xs text-amber-300/90">{error}</p> : null}
      {steersStory ? (
        opening ? (
          <div className="panel reveal flex flex-wrap items-center gap-1.5 rounded-lg p-2.5">
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} placeholder="Marla's Sundries" aria-label="Shop name" className={cn(panelField, "min-w-[9rem] flex-1")} />
            <Select size="sm" label="Kind of shop" value={draft.kind} options={KIND_OPTIONS} onChange={(kind) => setDraft({ ...draft, kind })} className="pk-w-28" />
            <Select size="sm" label="Size of the place" value={draft.size} options={SIZE_OPTIONS} onChange={(size) => setDraft({ ...draft, size })} className="pk-w-24" />
            <KitButton tone="primary" disabled={busy === "open" || !draft.name.trim()} busy={busy === "open"} onClick={() => void open()}>
              Open here
            </KitButton>
            <KitButton onClick={() => setOpening(false)}>Cancel</KitButton>
          </div>
        ) : (
          <KitButton onClick={() => setOpening(true)}>
            <Plus className="size-3.5" /> Open a shop {here ? `at ${here.name}` : ""}
          </KitButton>
        )
      ) : null}
      {!shops.length ? <EmptyState size="sm" art="chest" title={here ? `No shops at ${here.name}.` : "The party is nowhere with a market yet."} /> : null}
      {shops.map((shop) => {
        const canHaggle = Boolean(mySheet && !shop.haggledBy.includes(mySheet.id));
        const shopItems: ContextMenuItem[] = [
          ...(canHaggle ? [{ id: "haggle", label: "Haggle", glyph: "skill-persuasion", disabled: Boolean(busy), onSelect: () => void counter(shop, "haggle") }] : []),
          ...(steersStory ? [{ id: "close", label: `Close ${shop.name}`, glyph: "quest-failed", tone: "danger" as const, separated: canHaggle, onSelect: () => void close(shop) }] : []),
        ];
        return (
          <section key={shop.id} className="panel space-y-2 rounded-lg p-2.5">
            <ContextMenu items={shopItems} label={shop.name} className="group flex items-center gap-2">
              {shop.keeperPortrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shop.keeperPortrait} alt="" className="size-10 rounded-full border border-amber-500/40 object-cover shadow-[0_2px_8px_rgba(4,2,12,0.5)]" />
              ) : (
                <span className="flex size-10 items-center justify-center rounded-full border border-amber-500/25 bg-stone-900/70">
                  <GameIcon icon={{ kind: "glyph", key: "tab-shop" }} size="size-7" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="gold-title truncate text-sm">{shop.name}</p>
                <p className="truncate text-[11px] text-stone-500">
                  {shop.kind}
                  {shop.keeperName ? `, kept by ${shop.keeperName}` : ""}
                  {steersStory && shop.locationName ? ` at ${shop.locationName}` : ""}
                  {shop.markup !== 1 ? ` (prices ${Math.round((shop.markup - 1) * 100)}%)` : ""}
                </p>
              </div>
              {canHaggle ? (
                <KitButton disabled={Boolean(busy)} busy={busy === `${shop.id}:haggle:`} onClick={() => void counter(shop, "haggle")}>
                  Haggle
                </KitButton>
              ) : null}
              {steersStory ? (
                <KitButton tone="iconDanger" always aria-label={`Close ${shop.name}`} onClick={() => void close(shop)}>
                  <Trash2 className="size-3.5" />
                </KitButton>
              ) : null}
            </ContextMenu>
            <ul className="stagger-up grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {shop.stock.map((line) => {
                const buying = busy === `${shop.id}:buy:${line.itemName}`;
                const cannotBuy = Boolean(busy) || purse < line.askingCp;
                return (
                  <ContextMenu
                    as="li"
                    key={line.itemName}
                    label={line.itemName}
                    items={mySheet ? [{ id: "buy", label: `Buy for ${formatCopper(line.askingCp)}`, glyph: coinGlyph(line.askingCp), disabled: cannotBuy, onSelect: () => void counter(shop, "buy", line.itemName) }] : []}
                    className="flex flex-col justify-between rounded-lg border border-stone-700/60 bg-stone-900/50 p-2 transition-transform duration-[var(--dur-quick,150ms)] hover:-translate-y-0.5 hover:border-amber-500/40"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-stone-200" title={line.note || line.itemName}>
                      <GameIcon icon={{ kind: "item", key: line.itemName, family: "item-gear" }} size="size-7" />
                      <span className="truncate">{line.itemName}</span>
                    </span>
                    <span className="mt-1.5 flex items-center justify-between gap-1">
                      <span className="pk-chip text-amber-200">
                        <GameIcon icon={{ kind: "glyph", key: coinGlyph(line.askingCp) }} size="size-4" />
                        {formatCopper(line.askingCp)}
                      </span>
                      <span className="text-[11px] tabular-nums text-stone-500">x{line.qty}</span>
                    </span>
                    {mySheet ? (
                      <KitButton disabled={cannotBuy} busy={buying} onClick={() => void counter(shop, "buy", line.itemName)} className="mt-1.5 w-full justify-center border-amber-500/30 text-amber-100">
                        {buying ? null : "Buy"}
                      </KitButton>
                    ) : null}
                  </ContextMenu>
                );
              })}
              {!shop.stock.length ? <li className="col-span-full text-xs italic text-stone-500">Bare shelves.</li> : null}
            </ul>
            {shop.buys && mySheet?.equipment.length ? (
              <details className="group/sell text-xs">
                <summary className="pk-link pk-tap flex cursor-pointer list-none items-center gap-1">
                  <GameIcon icon={{ kind: "glyph", key: "tab-trade" }} size="size-5" /> Sell from your pack
                  <ChevronDown className="size-3.5 transition-transform group-open/sell:rotate-180" />
                </summary>
                <ul className="stagger mt-1.5 flex flex-wrap gap-1">
                  {mySheet.equipment.map((item) => (
                    <li key={item.name}>
                      <KitButton disabled={Boolean(busy)} onClick={() => void counter(shop, "sell", item.name)}>
                        <GameIcon icon={{ kind: "item", key: item.name, family: "item-gear" }} size="size-4" />
                        {item.name}
                        {item.qty > 1 ? ` x${item.qty}` : ""}
                      </KitButton>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
