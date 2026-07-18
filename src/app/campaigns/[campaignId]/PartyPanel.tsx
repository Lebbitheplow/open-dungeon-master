"use client";

import { Check, Crown, Heart, ImagePlus, Save, Shield, StickyNote, UserRound } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { CharacterMenu } from "@/app/campaigns/[campaignId]/CharacterMenu";
import { CharacterNotesDialog } from "@/app/campaigns/[campaignId]/CharacterNotesDialog";
import { CharacterSheetDialog } from "@/app/campaigns/[campaignId]/CharacterSheetDialog";
import { LeadEditDialog } from "@/app/campaigns/[campaignId]/LeadEditDialog";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import type { CampaignMember } from "@/lib/campaign-types";
import type { Note } from "@/lib/db/notes";
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
  notes = [],
  members = [],
  refreshNotes,
}: {
  sheets: CharacterSheet[];
  meUserId: string;
  onAdjustHp: (delta: number) => void;
  spotlightUserIds?: string[];
  embedded?: boolean;
  isLead?: boolean;
  leadUserId?: string;
  canTransferLead?: boolean;
  notes?: Note[];
  members?: CampaignMember[];
  refreshNotes?: () => Promise<void>;
}) {
  const [editingSheetId, setEditingSheetId] = useState("");
  const [viewingSheetId, setViewingSheetId] = useState("");
  const [croppingSheetId, setCroppingSheetId] = useState("");
  const [notesSheetId, setNotesSheetId] = useState("");
  const editingSheet = sheets.find((sheet) => sheet.id === editingSheetId);
  const viewingSheet = sheets.find((sheet) => sheet.id === viewingSheetId);
  const croppingSheet = sheets.find((sheet) => sheet.id === croppingSheetId);
  const notesSheet = sheets.find((sheet) => sheet.id === notesSheetId);
  const Wrapper = embedded ? "div" : "aside";

  async function setPortrait(sheet: CharacterSheet, url: string) {
    await fetch(`/api/campaigns/${sheet.campaignId}/sheet`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portrait: { url } }),
    });
  }
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
        const publicNoteCount = notes.filter(
          (note) => note.characterId === sheet.id && note.visibility === "public",
        ).length;
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
            <div className="flex items-start gap-1">
              <button
                type="button"
                onClick={() => setViewingSheetId(sheet.id)}
                title="View full character sheet"
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
              {sheet.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sheet.portrait.url}
                  alt={sheet.name}
                  className="size-10 shrink-0 rounded-lg border border-stone-700 object-cover"
                />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-stone-800 bg-stone-900">
                  <UserRound className="size-4 text-stone-600" />
                </span>
              )}
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">
                  <span className="truncate">{sheet.name}</span>
                  {sheet.userId === leadUserId ? (
                    <Crown className="size-3.5 shrink-0 text-amber-300" aria-label="Party lead" />
                  ) : null}
                </span>
                <span className="block text-xs text-stone-400">
                  {sheet.race.replaceAll("_", " ")} {sheet.class} {sheet.level}
                </span>
              </span>
              </button>
              {publicNoteCount ? (
                <button
                  type="button"
                  onClick={() => setNotesSheetId(sheet.id)}
                  title={`${publicNoteCount} party ${publicNoteCount === 1 ? "note" : "notes"} on ${sheet.name}`}
                  className="flex shrink-0 items-center gap-0.5 rounded-full border border-stone-800 px-1.5 py-0.5 text-[10px] text-stone-500 hover:text-amber-300"
                >
                  <StickyNote className="size-3" /> {publicNoteCount}
                </button>
              ) : null}
              <CharacterMenu
                sheet={sheet}
                isLead={isLead}
                leadUserId={leadUserId}
                canTransferLead={canTransferLead}
                onViewSheet={() => setViewingSheetId(sheet.id)}
                onNotes={() => setNotesSheetId(sheet.id)}
                onAdjust={() => setEditingSheetId(sheet.id)}
              />
            </div>

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
                <button
                  type="button"
                  onClick={() => setCroppingSheetId(sheet.id)}
                  className="flex w-full items-center justify-center gap-1 rounded border border-stone-700 py-1 text-xs text-stone-400 hover:bg-stone-900"
                >
                  <ImagePlus className="size-3" />
                  {sheet.portrait ? "Change portrait" : "Add portrait"}
                </button>
                {sheet.libraryCharacterId ? (
                  <SaveToLibraryButton campaignId={sheet.campaignId} />
                ) : null}
              </div>
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

      {viewingSheet ? (
        <CharacterSheetDialog
          sheet={viewingSheet}
          mine={viewingSheet.userId === meUserId}
          isLead={isLead}
          onAdjust={() => {
            setViewingSheetId("");
            setEditingSheetId(viewingSheet.id);
          }}
          onClose={() => setViewingSheetId("")}
        />
      ) : null}

      {croppingSheet ? (
        <AvatarCropDialog
          title={`${croppingSheet.name}'s portrait`}
          onUploaded={(image) => setPortrait(croppingSheet, image.url)}
          onClose={() => setCroppingSheetId("")}
        />
      ) : null}

      {notesSheet && refreshNotes ? (
        <CharacterNotesDialog
          campaignId={notesSheet.campaignId}
          sheet={notesSheet}
          notes={notes}
          members={members}
          meUserId={meUserId}
          isLead={isLead}
          refreshNotes={refreshNotes}
          onClose={() => setNotesSheetId("")}
        />
      ) : null}
    </Wrapper>
  );
}
