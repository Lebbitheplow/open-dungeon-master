"use client";

import { readLoad, useLoadStatus } from "@/lib/load-state";
import { EmptyState } from "@/components/EmptyState";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { useEffect, useRef, useState } from "react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { formatCopper, formatPrice } from "@/lib/srd/currency";
import { KitButton, LoadFailed, panelField, PanelLoading, RowMenu, SettingToggle } from "./PanelKit";
import { MarketShopEditor, type Named } from "./MarketShopEditor";
import type { StockLine } from "@/lib/dm/shop-logic";
import type { MarketRequest } from "@/lib/dm/table-tabs";
import { GameTerm } from "@/components/ui/GameTerm";

// The market (docs/vtt-parity-implementation-plan.md 11.1): the shops at
// the party's place, stock as tiles with a price chip in coin, a Buy on
// each, the pack laid out to sell, a haggle button, and a coin arc into
// the purse when money moves. Whoever steers the story sees every shop in
// the world; whoever holds the prep (the DM seat, the lead of an
// AI-narrated table, the workshop's author: the server says which, #171)
// opens shops here or in the workshop and writes their shelves.

type StockView = { itemName: string; qty: number; priceCp: number; askingCp: number; note: string };
type ShopView = {
  id: string;
  name: string;
  kind: string;
  size: string;
  locationId: string;
  keeperNpcId: string;
  restockDays: number;
  preparedStock: StockLine[] | null;
  locationName: string;
  keeperName: string;
  keeperPortrait: string;
  stock: StockView[];
  buys: boolean;
  markup: number;
  haggledBy: string[];
  haggles: Array<{ ids: string[]; steps: number; skill: HaggleSkill }>;
  // The viewer's own price at this shop, moved by a haggle they were at
  // the counter for, and that haggle's step (null: they have not haggled).
  yourMarkup: number;
  yourHaggle: number | null;
  // Where that haggle left the viewer's prices, in the server's words.
  yourPrices: string | null;
  haggleDc: number;
};

type HaggleSkill = "persuasion" | "intimidation" | "deception";

// A haggle's outcome for the person who made it, in the rules' own words.
// `moved` is false at an end of the price ladder, where a step had nowhere
// to go; `prices` is where it left them, in the server's words.
function haggleOutcome(steps: number, moved: boolean, prices: string): string {
  if (steps < 0) {
    return moved ? `You talked the keeper down: your prices here are ${prices}.` : "You talked the keeper down, but your prices here are already at their lowest.";
  }
  if (steps === 0) {
    return "The keeper holds firm: your prices stay where they were.";
  }
  return moved
    ? `A bad failure (you missed the DC by 5 or more): your prices here are ${prices}.`
    : "A bad failure (you missed the DC by 5 or more), but your prices here are already at their highest.";
}

// Where the viewer's haggle left their prices, for the line under a shop.
function haggledLine(steps: number, prices: string): string {
  return steps < 0 ? `You haggled here: your prices are ${prices}.` : steps === 0 ? "You haggled here: the keeper held firm." : `You haggled here and pushed too hard: your prices are ${prices}.`;
}

const KINDS = ["general", "smith", "apothecary", "outfitter", "curiosities"] as const;
const SIZES = ["hamlet", "village", "town", "city"] as const;
const KIND_OPTIONS = KINDS.map((kind) => ({ value: kind as string, label: kind }));
const SIZE_OPTIONS = SIZES.map((size) => ({ value: size as string, label: size }));

// The coin a price is mostly made of, so a chip leads with the right metal.
function coinGlyph(copper: number): string {
  return copper >= 100 ? "coin-gp" : copper >= 10 ? "coin-sp" : "coin-cp";
}

// The last Browse wares the Market answered. Kept outside the panel, which
// remounts each time its section is opened again, so a later visit to the
// Market is not taken for the same press.
let lastFocusedAt = 0;

export function MarketPanel({
  campaignId,
  steersStory,
  isDm = false,
  mySheet,
  refreshKey = 0,
  coins,
  focus = null,
  onAskKeeper,
}: {
  campaignId: string;
  // Story authority sees every shop and where it stands.
  steersStory: boolean;
  // Holds the DM seat. The server's word (`canPrep`) decides once the
  // market has loaded; this only covers the first paint.
  isDm?: boolean;
  mySheet: CharacterSheet | null;
  refreshKey?: number;
  coins?: { characterId: string; direction: "in" | "out"; at: number } | null;
  // A Browse wares from the chat: the heading takes focus and that shop
  // comes into view, once per press.
  focus?: MarketRequest | null;
  // Puts an action in the composer, for a sale only the DM can price.
  onAskKeeper?: (text: string) => void;
}) {
  const [shops, setShops] = useState<ShopView[] | null>(null);
  const [here, setHere] = useState<{ id: string; name: string } | null>(null);
  const [places, setPlaces] = useState<Named[]>([]);
  const [keepers, setKeepers] = useState<Named[]>([]);
  const [canPrep, setCanPrep] = useState(isDm);
  const [editing, setEditing] = useState("");
  // A refused or failed read is shown in the server's words with a way to
  // ask again, never as "nothing here yet" (issue 140).
  const { loaded, loadError, settle } = useLoadStatus();

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [draft, setDraft] = useState({ name: "", kind: "general", size: "village", locationId: "", keeperNpcId: "", stockFromPack: true });
  const [reload, setReload] = useState(0);
  // Something the pack and the item's worth leave unpriced: the keeper
  // names a price, so the sale goes to whoever runs the story.
  const [unpriced, setUnpriced] = useState<{ shop: string; item: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [spotlight, setSpotlight] = useState("");
  // Prices are the viewer's own (a haggle they were at the counter for), so
  // a Play as switch to another of their characters reads the shops again.
  const viewerId = mySheet?.id ?? "";

  useEffect(() => {
    let cancelled = false;
    readLoad<{ shops?: ShopView[]; here?: { id: string; name: string } | null; places?: Named[]; keepers?: Named[]; canPrep?: boolean }>(
      fetch(`/api/campaigns/${campaignId}/shops`),
      "The market",
    ).then((outcome) => {
      if (cancelled) {
        return;
      }
      settle(outcome);
      if (outcome.payload) {
        setShops(outcome.payload.shops ?? []);
        setHere(outcome.payload.here ?? null);
        setPlaces(outcome.payload.places ?? []);
        setKeepers(outcome.payload.keepers ?? []);
        setCanPrep(outcome.payload.canPrep ?? isDm);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, refreshKey, reload, settle, isDm, viewerId]);

  // Deferred a tick, as the hero page's heading is: the panel paints the
  // shops on the render that loads them, after this effect is scheduled.
  const loadedShops = shops !== null;
  useEffect(() => {
    if (!focus || !loadedShops || focus.at === lastFocusedAt) {
      return;
    }
    lastFocusedAt = focus.at;
    const id = window.setTimeout(() => {
      headingRef.current?.focus({ preventScroll: true });
      const section = listRef.current?.querySelector<HTMLElement>(`[data-shop-id="${CSS.escape(focus.shopId)}"]`);
      (section ?? headingRef.current)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setSpotlight(section ? focus.shopId : "");
    }, 0);
    return () => window.clearTimeout(id);
  }, [focus, loadedShops]);

  async function counter(shop: ShopView, action: "buy" | "sell" | "haggle", item = "", skill: HaggleSkill = "persuasion") {
    setBusy(`${shop.id}:${action}:${item}`);
    setError("");
    setUnpriced(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/shops/${shop.id}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, item, qty: 1, characterId: mySheet?.id, ...(action === "haggle" ? { skill } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && data.unpriced === true) {
        setUnpriced({ shop: shop.name, item });
      } else if (!response.ok) {
        setError(String(data.error ?? "The keeper shakes their head."));
      } else if (action === "haggle") {
        // The haggler's new markup against the shop's own: equal when the
        // step met an end of the ladder.
        setError(haggleOutcome(Number(data.result?.steps) || 0, Number(data.result?.markup) !== shop.markup, String(data.result?.prices ?? "")));
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
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/shops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, locationId: draft.locationId || here?.id || "" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(data.error ?? "The shop could not be opened."));
        return;
      }
      setOpening(false);
      setDraft({ name: "", kind: "general", size: "village", locationId: "", keeperNpcId: "", stockFromPack: true });
      // A shop started bare opens straight into its shelf.
      if (!draft.stockFromPack && data.shop?.id) {
        setEditing(String(data.shop.id));
      }
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

  if (shops === null && loadError) {

    return <LoadFailed error={loadError} onRetry={() => setReload((current) => current + 1)} />;

  }

  if (shops === null) {
    return <PanelLoading label="Looking over the stalls..." />;
  }
  return (
    <div ref={listRef} className="space-y-2">
      <SectionHead
        headingRef={headingRef}
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
      {unpriced ? (
        <p role="status" className="live-in flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-300/90">
          <span className="min-w-0">The shopkeeper will name a price for {unpriced.item}.</span>
          {onAskKeeper ? (
            <KitButton onClick={() => onAskKeeper(`I offer my ${unpriced.item} to the keeper of ${unpriced.shop} and ask what they would pay.`)}>
              Ask at the counter
            </KitButton>
          ) : null}
        </p>
      ) : null}
      {canPrep ? (
        opening ? (
          <div className="panel reveal flex flex-wrap items-center gap-1.5 rounded-lg p-2.5">
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} placeholder="Marla's Sundries" aria-label="Shop name" className={cn(panelField, "min-w-[9rem] flex-1")} />
            <Select size="sm" label="Kind of shop" value={draft.kind} options={KIND_OPTIONS} onChange={(kind) => setDraft({ ...draft, kind })} className="pk-w-28" />
            <Select size="sm" label="Size of the place" value={draft.size} options={SIZE_OPTIONS} onChange={(size) => setDraft({ ...draft, size })} className="pk-w-24" />
            {places.length ? (
              <Select
                size="sm"
                label="Where it stands"
                value={draft.locationId || here?.id || ""}
                options={[{ value: "", label: "No place yet" }, ...places.map((place) => ({ value: place.id, label: place.name, icon: { kind: "glyph" as const, key: "tab-map" } }))]}
                onChange={(locationId) => setDraft({ ...draft, locationId })}
                className="min-w-[9rem] flex-1"
              />
            ) : null}
            {keepers.length ? (
              <Select
                size="sm"
                label="Who keeps it"
                value={draft.keeperNpcId}
                options={[{ value: "", label: "Nobody named" }, ...keepers.map((npc) => ({ value: npc.id, label: npc.name, icon: { kind: "glyph" as const, key: "system-cast" } }))]}
                onChange={(keeperNpcId) => setDraft({ ...draft, keeperNpcId })}
                className="min-w-[9rem] flex-1"
              />
            ) : null}
            <SettingToggle on={draft.stockFromPack} onToggle={() => setDraft({ ...draft, stockFromPack: !draft.stockFromPack })}>
              Stock the shelves from the content pack
            </SettingToggle>
            {draft.stockFromPack ? null : <span className="live-in basis-full text-[11px] text-stone-500">It opens bare, straight into its shelf, for you to write line by line.</span>}
            <KitButton tone="primary" disabled={busy === "open" || !draft.name.trim()} busy={busy === "open"} onClick={() => void open()}>
              Open it
            </KitButton>
            <KitButton onClick={() => setOpening(false)}>Cancel</KitButton>
          </div>
        ) : (
          <KitButton onClick={() => setOpening(true)}>
            <Plus className="size-3.5" /> Open a shop {here ? `at ${here.name}` : ""}
          </KitButton>
        )
      ) : null}
      {!shops.length ? (
        loadError ? (
          <LoadFailed error={loadError} onRetry={() => setReload((current) => current + 1)} />
        ) : loaded ? (
          <EmptyState size="sm" art="chest" title={here ? `No shops at ${here.name}.` : canPrep ? "No shops yet. Open one and give it a shelf." : "The party is nowhere with a market yet."} />
        ) : null
      ) : null}
      {shops.map((shop) => {
        const canHaggle = Boolean(mySheet && !shop.haggledBy.includes(mySheet.id));
        // A keeper falls for a lie once: after one Deception here, nobody may try another.
        const canDeceive = canHaggle && !shop.haggles.some((deal) => deal.skill === "deception");
        // The haggle's skills: the menu beside Haggle and the shop's own
        // right-click or long-press menu offer the same list.
        const haggleItems: ContextMenuItem[] = canHaggle
          ? [
              { id: "haggle", label: "Haggle (Persuasion)", glyph: "skill-persuasion", disabled: Boolean(busy), onSelect: () => void counter(shop, "haggle") },
              { id: "haggle-intimidation", label: "Haggle by Intimidation (a bad failure: two steps up)", glyph: "skill-intimidation", disabled: Boolean(busy), onSelect: () => void counter(shop, "haggle", "", "intimidation") },
              ...(canDeceive ? [{ id: "haggle-deception", label: "Haggle by Deception (works once per shop)", glyph: "skill-deception", disabled: Boolean(busy), onSelect: () => void counter(shop, "haggle", "", "deception") }] : []),
            ]
          : [];
        const shopItems: ContextMenuItem[] = [
          ...haggleItems,
          ...(canPrep ? [{ id: "edit", label: "Edit the shop and its shelf", glyph: "ui-edit", separated: canHaggle, onSelect: () => setEditing(shop.id) }] : []),
          ...(canPrep ? [{ id: "close", label: `Close ${shop.name}`, glyph: "ui-lock", tone: "danger" as const, onSelect: () => void close(shop) }] : []),
        ];
        if (editing === shop.id) {
          return (
            <MarketShopEditor
              key={shop.id}
              campaignId={campaignId}
              shop={shop}
              places={places}
              keepers={keepers}
              onSaved={() => {
                setEditing("");
                setReload((current) => current + 1);
              }}
              onCancel={() => setEditing("")}
            />
          );
        }
        return (
          <section key={shop.id} data-shop-id={shop.id} data-spotlight={spotlight === shop.id ? "" : undefined} className={cn("panel @container space-y-2 rounded-lg p-2.5", spotlight === shop.id && "ring-1 ring-amber-400/60")}>
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
                {/* Wrapped, not cut: beside Haggle and the prep buttons a
                    20rem panel leaves a name and its markup a few letters. */}
                <p className="gold-title break-words text-sm leading-tight">{shop.name}</p>
                <p className="text-pretty break-words text-[11px] leading-snug text-stone-500">
                  {shop.kind}
                  {shop.keeperName ? `, kept by ${shop.keeperName}` : ""}
                  {steersStory && shop.locationName ? ` at ${shop.locationName}` : ""}
                  {shop.yourMarkup !== 1 ? ` (prices ${shop.yourMarkup > 1 ? "+" : ""}${Math.round((shop.yourMarkup - 1) * 100)}%)` : ""}
                  {shop.kind === "curiosities" || shop.kind === "apothecary" ? (
                    <>
                      {" · "}
                      {/* A finger-sized target (40px) that keeps the line's height. */}
                      <GameTerm id="magic_item_prices" className="-my-3.5 inline-block py-3.5">
                        How magic is priced
                      </GameTerm>
                    </>
                  ) : null}
                </p>
              </div>
              {canHaggle ? (
                <>
                  <KitButton disabled={Boolean(busy)} busy={busy === `${shop.id}:haggle:`} onClick={() => void counter(shop, "haggle")}>
                    Haggle
                  </KitButton>
                  {/* One tap haggles by Persuasion; this door opens the other
                      skills, the same list the shop's own menu holds. */}
                  <RowMenu
                    items={haggleItems}
                    label={`Haggle at ${shop.name}`}
                    trigger={{ label: "Haggle with another skill", icon: <ChevronDown className="size-4" aria-hidden="true" /> }}
                    className="-ml-1.5"
                  />
                </>
              ) : null}
              {canPrep ? (
                <>
                  <KitButton tone="icon" always aria-label={`Edit ${shop.name}`} onClick={() => setEditing(shop.id)}>
                    <Pencil className="size-3.5" />
                  </KitButton>
                  <KitButton tone="iconDanger" always aria-label={`Close ${shop.name}`} onClick={() => void close(shop)}>
                    <Trash2 className="size-3.5" />
                  </KitButton>
                </>
              ) : null}
            </ContextMenu>
            {canHaggle ? (
              <p data-haggle-rules="" className="text-pretty text-[11px] leading-snug text-stone-500">
                Haggling is a Persuasion check against DC {shop.haggleDc}: win and your prices drop a step, fail and they stay where they were, fail by 5 or
                more and they rise a step. One try each, and the price you get is yours, not the whole party&apos;s. The menu beside Haggle offers
                Intimidation and Deception instead.
              </p>
            ) : mySheet && shop.yourHaggle !== null ? (
              <p data-haggle-rules="" className="text-[11px] leading-snug text-stone-500">
                {haggledLine(shop.yourHaggle, shop.yourPrices ?? "")}
              </p>
            ) : null}
            {/* Columns follow the panel, not the window: the side panel is
                narrow on the widest screen, and three columns there left
                no room for a price. */}
            <ul className="stagger-up grid grid-cols-2 gap-1.5 @lg:grid-cols-3">
              {shop.stock.map((line) => {
                const buying = busy === `${shop.id}:buy:${line.itemName}`;
                const cannotBuy = Boolean(busy) || purse < line.askingCp;
                return (
                  <ContextMenu
                    as="li"
                    key={line.itemName}
                    label={line.itemName}
                    items={mySheet ? [{ id: "buy", label: `Buy for ${formatPrice(line.askingCp)}`, glyph: coinGlyph(line.askingCp), disabled: cannotBuy, onSelect: () => void counter(shop, "buy", line.itemName) }] : []}
                    className="flex flex-col justify-between rounded-lg border border-stone-700/60 bg-stone-900/50 p-2 transition-transform duration-[var(--dur-quick,150ms)] hover:-translate-y-0.5 hover:border-amber-500/40"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-stone-200" title={line.note || line.itemName}>
                      <GameIcon icon={{ kind: "item", key: line.itemName, family: "item-gear" }} size="size-7" />
                      <span className="truncate">{line.itemName}</span>
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
                      <span className="pk-chip max-w-full whitespace-normal text-amber-200">
                        <GameIcon icon={{ kind: "glyph", key: coinGlyph(line.askingCp) }} size="size-4" />
                        {formatPrice(line.askingCp)}
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
