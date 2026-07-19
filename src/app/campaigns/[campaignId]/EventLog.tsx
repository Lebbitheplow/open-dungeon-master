"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Loader2, RotateCcw, ScrollText, Star } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CharacterEvent } from "@/lib/db/character-events";
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
    case "use_item":
      return `${name} uses ${delta.item}`;
    case "purchase":
      return delta.action === "sell"
        ? `${name} sells ${delta.item}${Number(delta.qty) > 1 ? ` x${delta.qty}` : ""} for ${Number(delta.price) * Number(delta.qty ?? 1)} gold`
        : `${name} buys ${delta.item}${Number(delta.qty) > 1 ? ` x${delta.qty}` : ""} for ${Number(delta.price) * Number(delta.qty ?? 1)} gold`;
    case "use_resource":
      return `${name} spends ${Number(delta.spent) > 1 ? `${delta.spent} uses of ` : ""}${delta.resource}`;
    case "grant_temp_hp":
      return `${name} gains ${delta.tempHp} temporary HP`;
    case "learn_spell":
      return delta.action === "remove"
        ? `${name} loses the spell ${delta.spell}`
        : `${name} learns the spell ${delta.spell}`;
    case "update_sheet": {
      const changed = Object.keys(delta);
      return `The DM rewrites ${name}'s sheet${changed.length ? ` (${changed.join(", ")})` : ""}`;
    }
    case "undo":
      return `Party lead undid a change to ${name}`;
    case "lead_edit": {
      const changed = Object.keys(delta).filter((key) => key !== "reason");
      return `Party lead corrected ${name}${changed.length ? ` (${changed.join(", ")})` : ""}`;
    }
    default:
      return `${name}: ${entry.kind}`;
  }
}

// Confirmation for undos that would clobber newer changes to the same
// fields (the server answered 409 with warnings).
function ConfirmUndoDialog({
  warnings,
  busy,
  onConfirm,
  onCancel,
}: {
  warnings: string[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <AlertDialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 w-[22rem] -translate-x-1/2 -translate-y-1/2",
          )}
        >
          <AlertDialog.Title className="font-display text-lg tracking-wide text-amber-50">
            Undo anyway?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-xs text-stone-400">
            Newer changes touched the same fields; undoing will overwrite them.
          </AlertDialog.Description>
          <ul className="mt-2 space-y-1">
            {warnings.slice(0, 5).map((warning, index) => (
              <li key={index} className="text-[11px] leading-4 text-amber-300/80">
                {warning}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel className={ui.btnSmall}>Cancel</AlertDialog.Cancel>
            <button type="button" onClick={onConfirm} disabled={busy} className={ui.btnPrimary}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Undo anyway
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type FeedItem =
  | { type: "audit"; seq: number; entry: AuditEntry }
  | { type: "milestone"; seq: number; event: CharacterEvent };

// Chronological feed of DM-driven sheet changes and character milestones.
// The party lead can undo individual sheet changes, or revert every change
// from one DM turn. Undo restores sheet stats only.
export function EventLog({
  campaignId,
  auditLog,
  sheets,
  characterEvents = [],
  isLead = false,
}: {
  campaignId: string;
  auditLog: AuditEntry[];
  sheets: CharacterSheet[];
  characterEvents?: CharacterEvent[];
  isLead?: boolean;
}) {
  const [busyId, setBusyId] = useState("");
  const [confirming, setConfirming] = useState<{
    warnings: string[];
    run: () => Promise<void>;
  } | null>(null);

  const nameForCharacter = (characterId: string) =>
    sheets.find((sheet) => sheet.id === characterId)?.name ?? "Someone";
  const nameFor = (entry: AuditEntry) =>
    entry.characterName ?? nameForCharacter(entry.characterId);

  async function post(url: string, body: Record<string, unknown>, busyKey: string) {
    setBusyId(busyKey);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        setConfirming({
          warnings: Array.isArray(data.warnings) ? data.warnings : [],
          run: async () => {
            await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...body, confirm: true }),
            });
            setConfirming(null);
          },
        });
      }
    } finally {
      setBusyId("");
    }
  }

  const undoEntry = (entry: AuditEntry) =>
    post(`/api/campaigns/${campaignId}/audit/${entry.id}/undo`, {}, entry.id);
  const revertTurn = (turnId: string) =>
    post(`/api/campaigns/${campaignId}/audit/revert-turn`, { turnId }, `turn:${turnId}`);

  const feed: FeedItem[] = [
    ...auditLog.map((entry) => ({ type: "audit" as const, seq: entry.seq, entry })),
    ...characterEvents.map((event) => ({ type: "milestone" as const, seq: event.seq, event })),
  ].sort((a, b) => b.seq - a.seq);

  if (!feed.length) {
    return (
      <p className="px-1 py-6 text-center text-xs text-stone-600">
        No stat changes yet. Damage, loot, XP, conditions, and milestones the DM applies will show
        here.
      </p>
    );
  }

  // Live (still undoable) audit entries per DM turn, for the group revert.
  const liveByTurn = new Map<string, number>();
  for (const entry of auditLog) {
    if (entry.turnId && entry.undoable && !entry.revertedAt && entry.kind !== "undo") {
      liveByTurn.set(entry.turnId, (liveByTurn.get(entry.turnId) ?? 0) + 1);
    }
  }
  const revertShownForTurn = new Set<string>();

  return (
    <>
      <ol className="space-y-1.5">
        {feed.map((item) => {
          if (item.type === "milestone") {
            return (
              <li
                key={`m-${item.event.id}`}
                className="rounded-md border border-amber-900/40 bg-amber-950/15 px-2.5 py-1.5 text-xs text-stone-300"
              >
                <Star className="mr-1.5 inline size-3 text-amber-400" />
                {nameForCharacter(item.event.campaignCharacterId)}: {item.event.summary}
              </li>
            );
          }
          const entry = item.entry;
          const reverted = Boolean(entry.revertedAt);
          const canUndo = isLead && entry.undoable && !reverted;
          const turnId = entry.turnId ?? "";
          const showRevertTurn =
            isLead &&
            turnId &&
            (liveByTurn.get(turnId) ?? 0) >= 2 &&
            !revertShownForTurn.has(turnId);
          if (showRevertTurn) {
            revertShownForTurn.add(turnId);
          }
          return (
            <li key={entry.id} className="space-y-1">
              {showRevertTurn ? (
                <button
                  type="button"
                  disabled={busyId === `turn:${turnId}`}
                  onClick={() => revertTurn(turnId)}
                  title="Undo every sheet change from this DM turn (stats only)"
                  className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-stone-700 py-0.5 text-[10px] text-stone-500 hover:bg-stone-900 hover:text-amber-300"
                >
                  {busyId === `turn:${turnId}` ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3" />
                  )}
                  Revert this turn ({liveByTurn.get(turnId)})
                </button>
              ) : null}
              <div
                className={cn(
                  "rounded-md border border-stone-800 bg-stone-950/40 px-2.5 py-1.5 text-xs text-stone-300",
                  reverted && "opacity-60",
                )}
              >
                <div className="flex items-start gap-1.5">
                  <span className={cn("min-w-0 flex-1", reverted && "line-through text-stone-500")}>
                    <ScrollText className="mr-1.5 inline size-3 text-amber-600" />
                    {describeEntry(entry, nameFor(entry))}
                  </span>
                  {reverted ? (
                    <span className="shrink-0 rounded-full border border-stone-800 px-1.5 text-[9px] uppercase tracking-wide text-stone-600">
                      undone
                    </span>
                  ) : null}
                  {canUndo ? (
                    <button
                      type="button"
                      disabled={busyId === entry.id}
                      onClick={() => undoEntry(entry)}
                      title="Undo this change (restores the sheet fields it touched)"
                      className="shrink-0 text-stone-600 hover:text-amber-300"
                    >
                      {busyId === entry.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RotateCcw className="size-3" />
                      )}
                    </button>
                  ) : null}
                </div>
                {entry.reason ? (
                  <span className="block pl-4.5 text-[11px] text-stone-500">{entry.reason}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {confirming ? (
        <ConfirmUndoDialog
          warnings={confirming.warnings}
          busy={false}
          onConfirm={() => void confirming.run()}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
