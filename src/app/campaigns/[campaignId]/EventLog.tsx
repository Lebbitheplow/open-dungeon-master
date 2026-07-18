"use client";

import { ScrollText } from "lucide-react";
import type { AuditEntry } from "@/app/campaigns/[campaignId]/useCampaignStream";
import type { CharacterSheet } from "@/lib/schemas/sheet";

function describeEntry(entry: AuditEntry, name: string): string {
  const delta = entry.delta;
  switch (entry.kind) {
    case "apply_damage":
      return `${name} takes ${delta.amount} damage${delta.type ? ` (${delta.type})` : ""} (${delta.currentHp} HP)`;
    case "heal":
      return `${name} heals ${delta.amount} (${delta.newHp} HP)`;
    case "award_xp":
      return `${name} gains ${delta.amount} XP (${delta.newXp} total)`;
    case "modify_gold":
      return `${name} ${Number(delta.delta) >= 0 ? "gains" : "loses"} ${Math.abs(Number(delta.delta))} gold (${delta.gold} gp)`;
    case "grant_item":
      return `${name} receives ${delta.name}${Number(delta.qty) > 1 ? ` x${delta.qty}` : ""}`;
    case "remove_item":
      return `${name} loses ${delta.name}${Number(delta.removed) > 1 ? ` x${delta.removed}` : ""}`;
    case "set_condition":
      return `${name} is ${delta.condition}`;
    case "clear_condition":
      return `${name} is no longer ${delta.condition}`;
    case "use_spell_slot":
      return `${name} expends a level ${delta.level} spell slot`;
    default:
      return `${name}: ${entry.kind}`;
  }
}

// Chronological feed of DM-driven sheet changes, from the audit log.
export function EventLog({
  auditLog,
  sheets,
}: {
  auditLog: AuditEntry[];
  sheets: CharacterSheet[];
}) {
  const nameFor = (entry: AuditEntry) =>
    entry.characterName ??
    sheets.find((sheet) => sheet.id === entry.characterId)?.name ??
    "Someone";

  if (!auditLog.length) {
    return (
      <p className="px-1 py-6 text-center text-xs text-stone-600">
        No stat changes yet. Damage, loot, XP, and conditions the DM applies will show here.
      </p>
    );
  }

  return (
    <ol className="space-y-1.5">
      {[...auditLog].reverse().map((entry) => (
        <li
          key={entry.id}
          className="rounded-md border border-stone-800 bg-stone-950/40 px-2.5 py-1.5 text-xs text-stone-300"
        >
          <ScrollText className="mr-1.5 inline size-3 text-amber-600" />
          {describeEntry(entry, nameFor(entry))}
          {entry.reason ? (
            <span className="block pl-4.5 text-[11px] text-stone-500">{entry.reason}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
