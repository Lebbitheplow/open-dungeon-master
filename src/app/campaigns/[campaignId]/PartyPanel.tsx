"use client";

import { Check, Crown, Heart, Save, Shield, Wrench } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { LeadEditDialog } from "@/app/campaigns/[campaignId]/LeadEditDialog";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived, formatModifier } from "@/lib/srd";

function SaveToLibraryButton({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  async function save() {
    setState("saving");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet/sync`, {
        method: "POST",
      });
      setState(response.ok ? "saved" : "idle");
      if (response.ok) {
        setTimeout(() => setState("idle"), 2_000);
      }
    } catch {
      setState("idle");
    }
  }
  return (
    <button
      type="button"
      onClick={save}
      disabled={state === "saving"}
      title="Save level, gear, and spells back to your character library"
      className="flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-xs text-stone-400 hover:bg-stone-900 disabled:opacity-50"
    >
      {state === "saved" ? (
        <>
          <Check className="size-3 text-emerald-400" /> Saved
        </>
      ) : (
        <>
          <Save className="size-3" /> Save to library
        </>
      )}
    </button>
  );
}

export function PartyPanel({
  sheets,
  meUserId,
  onAdjustHp,
  spotlightUserIds = [],
  embedded = false,
  isLead = false,
  leadUserId = "",
  canTransferLead = false,
}: {
  sheets: CharacterSheet[];
  meUserId: string;
  onAdjustHp: (delta: number) => void;
  spotlightUserIds?: string[];
  embedded?: boolean;
  isLead?: boolean;
  leadUserId?: string;
  canTransferLead?: boolean;
}) {
  const [editingSheetId, setEditingSheetId] = useState("");
  const editingSheet = sheets.find((sheet) => sheet.id === editingSheetId);
  const Wrapper = embedded ? "div" : "aside";
  return (
    <Wrapper
      className={cn(
        embedded
          ? "space-y-3"
          : "hidden w-64 shrink-0 space-y-3 overflow-y-auto border-l border-stone-800 p-3 lg:block",
      )}
    >
      {embedded ? null : (
        <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-stone-500">Party</h2>
      )}
      {sheets.map((sheet) => {
        const derived = computeSheetDerived(sheet);
        const mine = sheet.userId === meUserId;
        const hpFraction = sheet.maxHp > 0 ? sheet.currentHp / sheet.maxHp : 0;
        return (
          <div
            key={sheet.id}
            className={cn(
              "rounded-lg border p-3",
              mine ? "border-amber-900 bg-amber-950/20" : "border-stone-800 bg-stone-950/40",
              spotlightUserIds.includes(sheet.userId) &&
                "ring-1 ring-amber-500/70 border-amber-700",
            )}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {sheet.name}
              {sheet.userId === leadUserId ? (
                <Crown className="size-3.5 text-amber-300" aria-label="Party lead" />
              ) : null}
            </p>
            <p className="text-xs text-stone-400">
              {sheet.race.replaceAll("_", " ")} {sheet.class} {sheet.level}
            </p>

            <div className="mt-2 flex items-center gap-2 text-sm">
              <Heart className="size-4 text-red-400" />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800">
                <div
                  className={cn(
                    "h-full rounded-full",
                    hpFraction > 0.5 ? "bg-emerald-600" : hpFraction > 0.25 ? "bg-amber-600" : "bg-red-600",
                  )}
                  style={{ width: `${Math.max(0, Math.min(1, hpFraction)) * 100}%` }}
                />
              </div>
              <span className="font-mono text-xs">
                {sheet.currentHp}
                {sheet.tempHp ? `+${sheet.tempHp}` : ""}/{sheet.maxHp}
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-3 text-xs text-stone-400">
              <span className="flex items-center gap-1">
                <Shield className="size-3.5" /> AC {sheet.ac}
              </span>
              <span>PP {derived.passivePerception}</span>
              <span>Init {formatModifier(derived.initiative)}</span>
            </div>

            {sheet.conditions.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {sheet.conditions.map((condition) => (
                  <span
                    key={condition}
                    className="rounded-full bg-red-950 px-2 py-0.5 text-xs text-red-300"
                  >
                    {condition}
                  </span>
                ))}
              </div>
            ) : null}

            {mine ? (
              <div className="mt-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAdjustHp(-1)}
                    className="flex-1 rounded border border-stone-700 py-1 text-xs hover:bg-stone-900"
                  >
                    -1 HP
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdjustHp(1)}
                    className="flex-1 rounded border border-stone-700 py-1 text-xs hover:bg-stone-900"
                  >
                    +1 HP
                  </button>
                </div>
                {sheet.libraryCharacterId ? (
                  <SaveToLibraryButton campaignId={sheet.campaignId} />
                ) : null}
              </div>
            ) : null}

            {isLead ? (
              <button
                type="button"
                onClick={() => setEditingSheetId(sheet.id)}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-xs text-stone-400 hover:bg-stone-900"
                title="Party lead: correct this character's stats"
              >
                <Wrench className="size-3" /> Adjust
              </button>
            ) : null}

            {canTransferLead && sheet.userId !== leadUserId ? (
              <button
                type="button"
                onClick={async () => {
                  await fetch(`/api/campaigns/${sheet.campaignId}/lead`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: sheet.userId }),
                  });
                }}
                className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-xs text-stone-400 hover:bg-stone-900"
                title="Hand the party lead to this player"
              >
                <Crown className="size-3" /> Make party lead
              </button>
            ) : null}
          </div>
        );
      })}

      {editingSheet ? (
        <LeadEditDialog
          campaignId={editingSheet.campaignId}
          sheet={editingSheet}
          onClose={() => setEditingSheetId("")}
        />
      ) : null}
    </Wrapper>
  );
}
