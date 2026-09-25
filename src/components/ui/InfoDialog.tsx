"use client";

import { Info, Loader2 } from "lucide-react";
import { Tooltip } from "@/components/ui/Tooltip";
import { GameIcon } from "@/components/ui/GameIcon";
import type { IconRef } from "@/lib/icons";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/Dialog";
import type { ItemSheet } from "@/lib/help/item-sheet";

// The "what does this do?" affordance, used everywhere a game term appears.
//
// Built on the shared Dialog rather than a popover on purpose: Radix tooltips
// never open on a touch tap, and the session layout is used on phones. A
// dialog behaves identically with a mouse, a finger and a keyboard.
//
// Text can be passed directly (features, glossary terms) or fetched lazily
// from the content pack by {kind, slug} for spells, feats and items, which is
// what /api/content/[kind]/[slug] was built for.

// `name` lets the lookup recover when a row's slug is not the plain
// slugified name (third-party documents pick their own), by falling back to
// a search.
export type ContentRef = { kind: string; slug: string; name?: string };

// Content-pack descriptions are markdown-ish: headings, bold, italics, tables.
// Rendering the handful of constructs that actually appear is far cheaper than
// a markdown dependency, and unknown syntax degrades to plain text rather than
// showing raw asterisks. Table rows keep their pipes inside a monospace block.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      out.push(text.slice(last, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    index += 1;
    if (token.startsWith("**")) {
      out.push(
        <strong key={key} className="font-medium text-stone-200">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <em key={key} className="text-stone-300">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

export function renderRules(text: string): ReactNode {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks.map((block, blockIndex) => {
    const trimmed = block.trim();
    if (!trimmed) {
      return null;
    }
    // Tables: keep the alignment by rendering the raw rows in a scroll box.
    if (trimmed.split("\n").every((line) => line.trim().startsWith("|"))) {
      return (
        <pre
          key={blockIndex}
          className="overflow-x-auto rounded-md bg-stone-900/60 p-2 text-[11px] leading-relaxed text-stone-400"
        >
          {trimmed}
        </pre>
      );
    }
    const lines = trimmed.split("\n");
    if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
      return (
        <ul key={blockIndex} className="list-disc space-y-1 pl-4">
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>
              {renderInline(line.replace(/^\s*[-*+]\s+/, ""), `${blockIndex}-${lineIndex}`)}
            </li>
          ))}
        </ul>
      );
    }
    // A heading line becomes a small label rather than showing its hashes.
    const heading = /^#{1,6}\s+(.*)$/.exec(lines[0]);
    const body = heading ? lines.slice(1).join("\n") : trimmed;
    return (
      <div key={blockIndex}>
        {heading ? (
          <p className="reveal mb-1 text-xs font-medium uppercase tracking-wide text-amber-200/80">
            {heading[1]}
          </p>
        ) : null}
        {body.trim() ? <p>{renderInline(body, String(blockIndex))}</p> : null}
      </div>
    );
  });
}

// Loads a content-pack entry's description on first open, so opening a sheet
// with forty spells on it costs nothing until one is actually inspected.
function ContentBody({ reference }: { reference: ContentRef }) {
  const [state, setState] = useState<{ text: string | null; loading: boolean }>({
    text: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { describeContentEntry } = await import("@/lib/help");
        const response = await fetch(
          `/api/content/${reference.kind}/${encodeURIComponent(reference.slug)}`,
        );
        if (response.ok) {
          const data = await response.json();
          const text = describeContentEntry(data?.entry?.data);
          if (text) {
            if (!cancelled) {
              setState({ text, loading: false });
            }
            return;
          }
        }
        // The slug guessed from the name missed, or the row it found carries
        // no text. Search by name and take an exact match.
        const wanted = (reference.name ?? reference.slug).trim().toLowerCase();
        const search = await fetch(
          `/api/content/${reference.kind}?q=${encodeURIComponent(wanted)}&limit=20`,
        );
        const results = search.ok ? ((await search.json()).results ?? []) : [];
        const hit = results.find(
          (entry: { name: string }) => entry.name.trim().toLowerCase() === wanted,
        );
        if (!cancelled) {
          setState({ text: describeContentEntry(hit?.data), loading: false });
        }
      } catch {
        if (!cancelled) {
          setState({ text: null, loading: false });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reference.kind, reference.slug, reference.name]);

  if (state.loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500">
        <Loader2 className="size-4 animate-spin" /> Looking it up...
      </p>
    );
  }
  if (!state.text) {
    return (
      <p className="text-sm text-stone-500">
        No description available. The content pack may not be installed, or this entry was added by
        hand.
      </p>
    );
  }
  return <>{renderRules(state.text)}</>;
}

function StatTile({ label, value, note }: { label: string; value: string | null; note?: string | null }) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/60 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p>
      <p className={cn("font-display text-base leading-tight", value ? "text-amber-100" : "text-stone-600")}>
        {value ?? "—"}
      </p>
      {note ? <p className="text-[11px] leading-tight text-stone-400">{note}</p> : null}
    </div>
  );
}

function ItemSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-amber-200/80">{title}</p>
      {children}
    </section>
  );
}

function RuleList({ rows }: { rows: Array<{ label: string; text: string | null }> }) {
  return (
    <dl className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
          <dt className="shrink-0 font-medium text-stone-200 sm:w-32">{row.label}</dt>
          <dd className="text-stone-400">{row.text ?? ""}</dd>
        </div>
      ))}
    </dl>
  );
}

// The item card: what it is, weight and value always on show, then the
// armour or weapon stats, then the long text when there is any. The facts
// come from every row that shares the name plus the bundled SRD tables
// (src/lib/help/item-sheet.ts), so a v1 table row with no prose, a v2 gear
// row with no stats and a genre item the pack lacks all get a full card.
function ItemBody({ reference }: { reference: ContentRef }) {
  const [state, setState] = useState<{ sheet: ItemSheet | null; loading: boolean }>({
    sheet: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const name = (reference.name ?? reference.slug).trim();
      const wanted = name.toLowerCase();
      const readJson = async (response: Response) => (response.ok ? response.json() : null);
      try {
        const [{ buildItemSheet }, direct, search] = await Promise.all([
          import("@/lib/help/item-sheet"),
          fetch(`/api/content/items/${encodeURIComponent(reference.slug)}`).then(readJson).catch(() => null),
          fetch(`/api/content/items?q=${encodeURIComponent(wanted)}&limit=20`).then(readJson).catch(() => null),
        ]);
        const hits = ((search?.results ?? []) as Array<{ name: string; data?: Record<string, unknown> }>)
          .filter((entry) => entry.name.trim().toLowerCase() === wanted)
          .map((entry) => entry.data);
        const sheet = buildItemSheet(name, [direct?.entry?.data, ...hits]);
        if (!cancelled) {
          setState({ sheet, loading: false });
        }
      } catch {
        if (!cancelled) {
          setState({ sheet: null, loading: false });
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reference.slug, reference.name]);

  if (state.loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-stone-500">
        <Loader2 className="size-4 animate-spin" /> Looking it up...
      </p>
    );
  }
  const sheet = state.sheet;
  if (!sheet) {
    return (
      <p className="text-sm text-stone-500">
        No details available. The content pack may not be installed, or this item was added by hand.
      </p>
    );
  }

  const tags = [
    sheet.rarity,
    sheet.attunement ? "Requires attunement" : null,
    sheet.bonus ? `+${sheet.bonus} magic` : null,
  ].filter((tag): tag is string => Boolean(tag));
  const tiles: Array<{ label: string; value: string | null; note?: string | null }> = [
    { label: "Weight", value: sheet.weight },
    { label: "Value", value: sheet.cost },
  ];
  if (sheet.armor) {
    tiles.push({ label: sheet.armor.shield ? "AC bonus" : "Armor class", value: sheet.armor.ac });
  }
  if (sheet.weapon) {
    tiles.push({
      label: "Damage",
      value: sheet.weapon.damage ?? "None",
      note: sheet.weapon.damageType,
    });
    if (sheet.weapon.range) {
      tiles.push({ label: "Range", value: sheet.weapon.range });
    }
  }

  const armorRows: Array<{ label: string; text: string | null }> = [];
  if (sheet.armor) {
    if (sheet.armor.shield) {
      armorRows.push({ label: "Shield", text: "Carried in one hand; only one shield counts at a time." });
    }
    if (sheet.armor.dex) {
      armorRows.push({ label: "Dexterity", text: sheet.armor.dex });
    }
    armorRows.push({
      label: "Strength",
      text: sheet.armor.strength
        ? `Needs ${sheet.armor.strength}; below that, your speed drops by 10 feet while wearing it.`
        : "No minimum.",
    });
    armorRows.push({
      label: "Stealth",
      text: sheet.armor.stealthDisadvantage
        ? "Disadvantage on Dexterity (Stealth) checks while wearing it."
        : "No penalty.",
    });
  }
  const weaponRows: Array<{ label: string; text: string | null }> = [];
  if (sheet.weapon) {
    if (sheet.bonus) {
      weaponRows.push({ label: `+${sheet.bonus} weapon`, text: `Adds ${sheet.bonus} to attack and damage rolls.` });
    }
    for (const property of sheet.weapon.properties) {
      weaponRows.push({ label: property.name, text: property.blurb });
    }
    if (sheet.weapon.damageType && sheet.weapon.damageBlurb) {
      weaponRows.push({ label: `${capitalize(sheet.weapon.damageType)}`, text: sheet.weapon.damageBlurb });
    }
    if (!sheet.weapon.damage) {
      weaponRows.push({ label: "No damage", text: "It does not hurt on its own; its special rules say what it does." });
    }
  }

  return (
    <div className="space-y-4">
      {sheet.type || tags.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {sheet.type ? <span className="text-sm font-medium text-stone-200">{sheet.type}</span> : null}
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-amber-200/20 bg-amber-200/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-200/80"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))]">
        {tiles.map((tile) => (
          <StatTile key={tile.label} {...tile} />
        ))}
      </div>
      {armorRows.length ? (
        <ItemSection title="Armor">
          <RuleList rows={armorRows} />
        </ItemSection>
      ) : null}
      {weaponRows.length ? (
        <ItemSection title="Weapon">
          <RuleList rows={weaponRows} />
        </ItemSection>
      ) : null}
      {sheet.description ? (
        <ItemSection title="Description">
          <div className="space-y-2 border-t border-stone-800 pt-2">{renderRules(sheet.description)}</div>
        </ItemSection>
      ) : null}
    </div>
  );
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// The ⓘ button plus its dialog. `label` names the thing; `text` is its
// description, or omit it and pass `reference` to fetch one.
export function InfoButton({
  label,
  text,
  reference,
  meta,
  className,
  size = "sm",
}: {
  label: string;
  text?: string | null;
  reference?: ContentRef;
  // A short line under the title: spell level and school, feature level, and
  // so on.
  meta?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  // Nothing to say and nothing to look up: render no control at all rather
  // than a button that opens an empty box.
  if (!text?.trim() && !reference) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={`What is ${label}?`}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:text-amber-200",
          className,
        )}
      >
        <Info className={size === "md" ? "size-4" : "size-3.5"} />
      </button>
      <InfoDialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        meta={meta}
        text={text}
        reference={reference}
      />
    </>
  );
}

// A list of named things, each with its own ⓘ. Replaces the comma-joined
// strings the sheets used to print for features, feats and spells.
export function InfoChipList({
  items,
  emptyText,
}: {
  items: Array<{
    name: string;
    text?: string | null;
    meta?: string;
    reference?: ContentRef;
    // Rendered after the name, e.g. "(story)" for a feature the DM granted.
    note?: string;
    // The painted icon that leads the chip, when the thing has one.
    icon?: IconRef;
  }>;
  emptyText?: string;
}) {
  if (!items.length) {
    return emptyText ? <p className="text-xs text-stone-500">{emptyText}</p> : null;
  }
  return (
    <div className="stagger-pop flex flex-wrap gap-1.5">
      {items.map((item) => {
        const line = firstLine(item.text);
        return (
          <span key={item.name} className="info-chip">
            <Tooltip
              content={
                <span className="flex items-start gap-2.5">
                  {item.icon ? <GameIcon icon={item.icon} size="size-12" className="shrink-0" /> : null}
                  <span className="min-w-0">
                    <span className="block font-display text-[13px] tracking-wide text-amber-100">{item.name}</span>
                    {item.meta ? <span className="block text-[10px] uppercase tracking-wider text-stone-500">{item.meta}</span> : null}
                    <span className="mt-0.5 block text-stone-300">{line ?? "Select the mark beside it for the full entry."}</span>
                  </span>
                </span>
              }
            >
              <span className="flex min-w-0 items-center gap-1.5" tabIndex={-1}>
                {item.icon ? <GameIcon icon={item.icon} size="size-8" /> : null}
                <span className="truncate">{item.name}</span>
                {item.note ? <span className="text-stone-500">{item.note}</span> : null}
              </span>
            </Tooltip>
            <InfoButton
              label={item.name}
              meta={item.meta}
              text={item.text}
              reference={item.reference}
            />
          </span>
        );
      })}
    </div>
  );
}

// The first sentence of a write-up, for the hover preview.
function firstLine(text: string | null | undefined): string | null {
  const plain = text?.replace(/\s+/g, " ").trim();
  if (!plain) return null;
  const stop = plain.search(/[.!?](\s|$)/);
  const line = stop > 0 ? plain.slice(0, stop + 1) : plain;
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

export function InfoDialog({
  open,
  onOpenChange,
  title,
  meta,
  text,
  reference,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  meta?: string;
  text?: string | null;
  reference?: ContentRef;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width="w-[min(92vw,32rem)]">
      {meta ? (
        <p className="reveal mb-3 text-xs uppercase tracking-wide text-amber-200/70">{meta}</p>
      ) : null}
      <div className="space-y-2 text-sm leading-relaxed text-stone-400">
        {text?.trim() ? (
          renderRules(text)
        ) : reference?.kind === "items" ? (
          <ItemBody reference={reference} />
        ) : reference ? (
          <ContentBody reference={reference} />
        ) : null}
        {children}
      </div>
    </Dialog>
  );
}
