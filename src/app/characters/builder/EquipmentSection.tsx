"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
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

// Equipment block of the character builder: class-appropriate starting
// weapons and armor arrive pre-added (removable), proficient gear is a
// one-click suggestion, the whole catalog is browsable by category, and every
// row and chip carries the ⓘ that says what the thing actually does.
export default function EquipmentSection({
  equipment,
  suggestions,
  onAdd,
  onAddMany,
  onRemove,
  gold,
  setGold,
  inputClass,
}: {
  equipment: Array<{ name: string; qty: number; slug?: string }>;
  // Name plus a one-word stat to show beside it ("1d8 slashing", "AC 14").
  suggestions: Array<{ name: string; note: string }>;
  onAdd: (entry: { name: string; qty?: number; slug?: string; gear?: HomebrewGear }) => void;
  onAddMany: (entries: Array<{ name: string; qty: number }>) => void;
  onRemove: (name: string) => void;
  gold: number;
  setGold: (gold: number) => void;
  inputClass: string;
}) {
  const have = new Set(equipment.map((item) => item.name));
  const openSuggestions = suggestions.filter((entry) => !have.has(entry.name));

  return (
    <section className="panel rounded-xl p-4">
      <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Equipment</h2>
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
      <label className="mt-3 block w-40">
        <span className="mb-1 block text-xs text-stone-400">Starting gold</span>
        <input
          type="number"
          min={0}
          max={100000}
          value={gold}
          onChange={(event) => setGold(Math.max(0, Number(event.target.value) || 0))}
          className={inputClass}
        />
      </label>
    </section>
  );
}
