"use client";

import { Coins, Dices, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { contentSlug } from "@/lib/help";
import { gearFromHomebrewData, type HomebrewGear } from "@/lib/homebrew/gear";
import CatalogBrowser from "./CatalogBrowser";
import ContentPicker from "./ContentPicker";
import { Chip } from "./steps/shared";

const STARTER_PACK: Array<{ name: string; qty: number }> = [
  { name: "Backpack", qty: 1 },
  { name: "Bedroll", qty: 1 },
  { name: "Rations (1 day)", qty: 5 },
  { name: "Rope, Hempen (50 feet)", qty: 1 },
  { name: "Torch", qty: 5 },
  { name: "Waterskin", qty: 1 },
];

// Rarest last, so a browse of the magic items reads like a shelf rather than
// like the alphabet. Anything a pack files under a name not on this list
// sorts after them under its own heading.
const RARITY_ORDER = ["common", "uncommon", "rare", "very rare", "legendary", "artifact"];

// The coin the character starts with, as the server will work it out: never
// typed. Where it comes from is one line under the figure.
export type PurseView = {
  gold: number;
  copper: number;
  source: string;
  // The first thing the purse cannot pay for, in the rules' words.
  problem: string | null;
  // A table that rolls starting wealth: the server's roll, or the button
  // that asks for it.
  wealth: {
    dice: string;
    rolled: { faces: number[]; gold: number } | null;
    busy: boolean;
    error: string;
    onRoll: () => void;
  } | null;
};

// Equipment block of the character builder: the class's starting equipment
// arrives pre-added (removable), its either-or choices picked in `kit`,
// proficient gear is a one-click suggestion, the whole catalog is browsable
// by category, and every row and chip carries the ⓘ that says what the
// thing actually does.
export default function EquipmentSection({
  equipment,
  suggestions,
  onAdd,
  onAddMany,
  onRemove,
  purse,
  kit,
}: {
  // The class kit's choices (KitChoicesSection), for a new character.
  kit?: ReactNode;
  equipment: Array<{ name: string; qty: number; slug?: string }>;
  // Name plus a one-word stat to show beside it ("1d8 slashing", "AC 14").
  suggestions: Array<{ name: string; note: string }>;
  onAdd: (entry: { name: string; qty?: number; slug?: string; gear?: HomebrewGear }) => void;
  onAddMany: (entries: Array<{ name: string; qty: number }>) => void;
  onRemove: (name: string) => void;
  purse: PurseView;
  inputClass: string;
}) {
  const have = new Set(equipment.map((item) => item.name));
  const openSuggestions = suggestions.filter((entry) => !have.has(entry.name));

  return (
    <section className="panel rounded-xl p-4">
      <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Equipment</h2>
      {kit}
      {openSuggestions.length ? (
        <div className="mb-2">
          <p className="mb-1.5 text-xs text-stone-500">Suggested for your class:</p>
          <div className="flex flex-wrap gap-1.5">
            {openSuggestions.map((entry) => (
              <span
                key={entry.name}
                className="flex items-center gap-1 rounded-full border border-amber-900/70 bg-amber-950/30 pl-2.5 pr-2 text-xs text-amber-200"
              >
                <button
                  type="button"
                  onClick={() => onAdd({ name: entry.name })}
                  className="py-1 hover:text-amber-100"
                >
                  + {entry.name}
                  <span className="ml-1 text-amber-200/50">{entry.note}</span>
                </button>
                <InfoButton
                  label={entry.name}
                  reference={{ kind: "items", slug: contentSlug(entry.name), name: entry.name }}
                />
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAddMany(STARTER_PACK)}
          className="rounded-md border border-stone-700 px-2.5 py-1 text-xs text-stone-300 hover:bg-stone-900"
        >
          Add adventurer&apos;s starter pack
        </button>
        <span className="text-xs text-stone-500">plus search armor, weapons, and gear:</span>
      </div>
      <ContentPicker
        kind="items"
        placeholder="Search items (e.g. longsword, chain mail, rope)"
        onPick={(entry) =>
          onAdd({
            name: entry.name,
            slug: entry.slug,
            ...(entry.source === "homebrew"
              ? { gear: gearFromHomebrewData(entry.name, entry.data) ?? undefined }
              : {}),
          })
        }
        renderMeta={(entry) => entry.rarity || entry.kind || ""}
      />
      {/* Searching only finds what you can already name. The catalog itself
          is here, by category, with what this class is proficient with on
          top and a ⓘ on every row. */}
      <CatalogBrowser
        kind="items"
        buttonLabel="Browse every weapon, armor and item"
        selectedNames={equipment.map((item) => item.name)}
        onPick={(entry) =>
          onAdd({
            name: entry.name,
            slug: entry.slug,
            ...(entry.source === "homebrew"
              ? { gear: gearFromHomebrewData(entry.name, entry.data) ?? undefined }
              : {}),
          })
        }
        onUnpick={onRemove}
        recommended={
          suggestions.length
            ? {
                label: "Suggested for your class",
                note: "What this class is proficient with, plus the kit everyone carries.",
                entries: [
                  ...suggestions.map((entry) => ({ name: entry.name, note: entry.note })),
                  ...STARTER_PACK.map((entry) => ({ name: entry.name, note: "kit" })),
                ],
              }
            : undefined
        }
        sections={[
          { key: "items:weapon", label: "Weapons", params: { kind: "weapon" } },
          { key: "items:armor", label: "Armor and shields", params: { kind: "armor" } },
          { key: "items:gear", label: "Adventuring gear", params: { kind: "gear" } },
          {
            key: "items:magic",
            label: "Magic items",
            params: { kind: "magic_item" },
            note: "Ask your DM before starting with one of these.",
            bucketOf: (entry) => {
              const rarity = (entry.rarity ?? "").trim().toLowerCase();
              const order = RARITY_ORDER.indexOf(rarity);
              return {
                key: rarity || "unspecified",
                label: rarity ? rarity.replace(/^./, (c) => c.toUpperCase()) : "Rarity not given",
                order: order === -1 ? RARITY_ORDER.length : order,
              };
            },
          },
        ]}
        metaOf={(entry) => entry.rarity || entry.cost || ""}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {equipment.map((item) => (
          <Chip
            key={item.name}
            label={item.qty > 1 ? `${item.name} x${item.qty}` : item.name}
            homebrew={item.slug?.startsWith("homebrew:") ?? false}
            info={
              item.slug?.startsWith("homebrew:")
                ? undefined
                : {
                    reference: {
                      kind: "items",
                      slug: item.slug ?? contentSlug(item.name),
                      name: item.name,
                    },
                  }
            }
            onRemove={() => onRemove(item.name)}
          />
        ))}
      </div>
      <div className="mt-3 space-y-1.5">
        {purse.wealth && !purse.wealth.rolled ? (
          <button
            type="button"
            onClick={purse.wealth.onRoll}
            disabled={purse.wealth.busy}
            aria-busy={purse.wealth.busy}
            className="flex items-center gap-2 rounded-md border border-amber-800/70 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-950/60 disabled:opacity-60 motion-press"
          >
            {purse.wealth.busy ? <Loader2 className="size-3.5 animate-spin" /> : <Dices className="size-3.5" />}
            Roll starting wealth ({purse.wealth.dice})
          </button>
        ) : null}
        <div className="flex items-baseline gap-2">
          <Coins className="size-3.5 self-center text-amber-300/80" />
          <span className="text-xs text-stone-400">Coin left after the gear</span>
          <span key={`${purse.gold}-${purse.copper}`} className="reveal font-mono text-sm text-amber-200">
            {purse.gold} gp{purse.copper ? ` ${purse.copper} cp` : ""}
          </span>
        </div>
        <p className="text-[11px] text-stone-500">
          {purse.wealth?.rolled
            ? `The server rolled ${purse.wealth.rolled.faces.join(", ")} on ${purse.wealth.dice}: ${purse.wealth.rolled.gold} gp. `
            : ""}
          {purse.source}
        </p>
        {purse.wealth?.error ? (
          <p role="alert" className="reveal motion-shake text-[11px] text-red-400">
            {purse.wealth.error}
          </p>
        ) : null}
        {purse.problem ? (
          <p role="alert" className={cn("reveal text-[11px] text-amber-300")}>
            {purse.problem}
          </p>
        ) : null}
      </div>
    </section>
  );
}
