"use client";

import { useEffect, useMemo, useState } from "react";
import { PortraitMedallion } from "@/components/sheet/SheetParts";
import { FxSprite } from "@/components/ui/FxSprite";
import { GameIcon } from "@/components/ui/GameIcon";
import type { AuditEntry, CampaignLocation } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { CharacterPortrait } from "@/lib/ui";

// The table's set pieces (docs/visual-overhaul-plan.md 8c.6): the level-up
// flourish that plays before the level-up dialog opens, and the rest by the
// fire that plays when the party rests. Both are pictures over what the
// engine already did; neither changes a number. Styles: styles/moments.css.

function Face({ sheet }: { sheet: CharacterSheet }) {
  return sheet.portrait ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={sheet.portrait.url} alt={sheet.name} />
  ) : (
    <CharacterPortrait look={{ race: sheet.race, class: sheet.class, gender: sheet.gender }} alt={sheet.name} size="size-full" />
  );
}

// A veil with the turning sigil: what holds the screen while a moment's
// dialog is still loading its code.
export function MomentVeil() {
  return (
    <div className="moment-stage" aria-busy="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/ui/sigil-loading.webp" alt="" className="moment-sigil" />
    </div>
  );
}

const LEVEL_UP_MS = 2600;

export function LevelUpMoment({ sheet, level, onDone }: { sheet: CharacterSheet; level: number; onDone: () => void }) {
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onDone, still ? 900 : LEVEL_UP_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="moment-stage" role="status" onClick={onDone}>
      <div className="moment-levelup">
        <FxSprite sheetId="burst-radiant" className="moment-levelup-burst" />
        <span className="moment-ring" aria-hidden="true" />
        <span className="moment-ring moment-ring-late" aria-hidden="true" />
        <PortraitMedallion classId={sheet.class} className="moment-levelup-medallion">
          <Face sheet={sheet} />
        </PortraitMedallion>
      </div>
      <p className="moment-kicker">
        <GameIcon icon={{ kind: "glyph", key: "rest-level-up" }} size="size-7" /> Level up
      </p>
      <p className="gold-title moment-title">
        {sheet.name} reaches level {level}
      </p>
    </div>
  );
}

const REST_MS = 7000;

function restLine(entry: AuditEntry, sheet: CharacterSheet | undefined): string {
  if (entry.kind === "rest_long") {
    return "fully restored";
  }
  const hp = typeof entry.delta.currentHp === "number" ? entry.delta.currentHp : null;
  if (hp !== null && sheet) {
    return `${hp}/${sheet.maxHp} hit points`;
  }
  return entry.reason || "rested";
}

// Watches the audit log for a rest the engine just recorded and gathers the
// party around the fire: a medallion each, and what the rest gave them, which
// is what the log says. A rest already in the log when the table opened does
// not replay.
export function RestMoment({ auditLog, sheets }: { auditLog: AuditEntry[]; sheets: CharacterSheet[] }) {
  const rests = useMemo(() => auditLog.filter((entry) => entry.kind.startsWith("rest_")), [auditLog]);
  const stamp = rests.map((entry) => entry.id).join(",");
  const [seen, setSeen] = useState(stamp);
  const fresh = useMemo(() => {
    const known = new Set(seen.split(","));
    return rests.filter((entry) => !known.has(entry.id));
  }, [rests, seen]);

  useEffect(() => {
    if (!fresh.length) return;
    const timer = window.setTimeout(() => setSeen(stamp), REST_MS);
    return () => window.clearTimeout(timer);
  }, [fresh.length, stamp]);

  if (!fresh.length) {
    return null;
  }
  const long = fresh.some((entry) => entry.kind === "rest_long");
  const byCharacter = new Map(fresh.map((entry) => [entry.characterId, entry]));
  const resting = sheets.filter((sheet) => byCharacter.has(sheet.id));
  return (
    <div className="moment-stage" role="status" onClick={() => setSeen(stamp)}>
      <p className="moment-kicker">
        <GameIcon icon={{ kind: "glyph", key: long ? "rest-long" : "rest-short" }} size="size-7" />
        {long ? "A long rest" : "A short rest"}
      </p>
      <div className="moment-rest">
        <FxSprite sheetId="loop-campfire" loop className="moment-rest-fire" />
        <span className="moment-rest-glow" aria-hidden="true" />
      </div>
      <ul className="moment-rest-party">
        {resting.map((sheet, index) => {
          const entry = byCharacter.get(sheet.id);
          return (
            <li key={sheet.id} className="moment-rest-seat" style={{ animationDelay: `${300 + index * 120}ms` }}>
              <PortraitMedallion classId={sheet.class} className="moment-rest-medallion">
                <Face sheet={sheet} />
              </PortraitMedallion>
              <span className="font-display text-sm text-amber-50">{sheet.name}</span>
              <span className="text-[11px] text-amber-200/80">{entry ? restLine(entry, sheet) : ""}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[11px] text-stone-400">Select anywhere to return to the table</p>
    </div>
  );
}

const LOOT_MS = 3600;

type Gain = { name: string; qty: number };

// How grand the reveal is. The engine keeps no rarity, so the name decides:
// a +2 or +3 is epic, any other known magic item or a +1 is rare, and the
// rest is honest gear.
function lootTier(name: string): "common" | "rare" | "epic" {
  if (/\+[23]\b/.test(name)) return "epic";
  if (/\+1\b/.test(name) || matchMagicItem(name) !== null) return "rare";
  return "common";
}

function packOf(sheet: CharacterSheet): Map<string, number> {
  const pack = new Map<string, number>();
  for (const item of sheet.equipment) {
    pack.set(item.name, (pack.get(item.name) ?? 0) + item.qty);
  }
  return pack;
}

// The reward reveal: when something new lands in the viewer's own pack (a
// find, a purchase, a gift), it turns over on a plate in its tier's colours
// with its painted icon. Read off the sheet itself, so every way an item can
// arrive is covered and nothing about how it arrives changes.
export function LootMoment({ sheet }: { sheet: CharacterSheet | null | undefined }) {
  const signature = sheet ? `${sheet.id}|${sheet.equipment.map((item) => `${item.name}x${item.qty}`).join("|")}` : "";
  const [known, setKnown] = useState({ signature, id: sheet?.id ?? "", pack: sheet ? packOf(sheet) : new Map<string, number>() });
  const [queue, setQueue] = useState<Gain[]>([]);

  if (sheet && known.signature !== signature) {
    const pack = packOf(sheet);
    // A different character under the same seat is a new baseline, not loot.
    if (known.id === sheet.id) {
      const gains: Gain[] = [];
      for (const [name, qty] of pack) {
        const before = known.pack.get(name) ?? 0;
        if (qty > before) gains.push({ name, qty: qty - before });
      }
      if (gains.length) setQueue((waiting) => [...waiting, ...gains].slice(0, 6));
    }
    setKnown({ signature, id: sheet.id, pack });
  }

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setQueue((waiting) => waiting.slice(1)), LOOT_MS);
    return () => window.clearTimeout(timer);
  }, [current]);

  if (!current) {
    return null;
  }
  const tier = lootTier(current.name);
  return (
    <div className="moment-loot" role="status" data-tier={tier} onClick={() => setQueue((waiting) => waiting.slice(1))}>
      <div key={current.name} className="moment-loot-card">
        {tier !== "common" ? <span className="moment-loot-rays" aria-hidden="true" /> : null}
        <span className="moment-loot-plate">
          <GameIcon icon={{ kind: "item", key: current.name, family: "item-gear" }} size="size-20" />
        </span>
        <span className="moment-loot-kicker">{tier === "epic" ? "A treasure" : tier === "rare" ? "A rare find" : "Added to your pack"}</span>
        <span className="moment-loot-name">
          {current.name}
          {current.qty > 1 ? ` x${current.qty}` : ""}
        </span>
      </div>
    </div>
  );
}

const TRAVEL_MS = 3400;

// The travel banner: when the party's current place changes while the table
// is open, its name rides in under a compass rose. A place already current
// when the table opened is not announced.
export function TravelBanner({ locations }: { locations: CampaignLocation[] }) {
  const place = locations.find((location) => location.isCurrent) ?? null;
  const visited = locations.filter((location) => location.visited).map((location) => location.id).join(",");
  const [known, setKnown] = useState({ id: place?.id ?? "", visited });
  const [shown, setShown] = useState<{ id: string; name: string; firstVisit: boolean } | null>(null);

  if (place && place.id !== known.id) {
    // New to the party if it was not among the visited places a moment ago.
    const firstVisit = !known.visited.split(",").includes(place.id);
    if (known.id) setShown({ id: place.id, name: place.name, firstVisit });
    setKnown({ id: place.id, visited });
  } else if (visited !== known.visited) {
    setKnown({ id: known.id, visited });
  }

  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), TRAVEL_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  if (!shown) {
    return null;
  }
  return (
    <div key={shown.id} className="moment-travel" role="status">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/ui/compass-rose.webp" alt="" className="moment-travel-rose" />
      <span className="min-w-0">
        <span className="moment-travel-kicker">{shown.firstVisit ? "New place discovered" : "The party arrives"}</span>
        <span className="gold-title moment-travel-name">{shown.name}</span>
      </span>
    </div>
  );
}
