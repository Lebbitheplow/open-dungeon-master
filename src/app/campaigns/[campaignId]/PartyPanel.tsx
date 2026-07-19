"use client";

import { Check, Crown, Dices, Heart, ImagePlus, Save, Shield, StickyNote, UserRound } from "lucide-react";
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

// Mid-game physical-dice opt-in/out; the same per-member preference the
// Lobby toggle writes. Turning it ON means the DM pauses on your rolls and
// asks for the numbers from your real dice.
function RealDiceToggle({
  campaignId,
  member,
}: {
  campaignId: string;
  member: CampaignMember;
}) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/members/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useRealDice: !member.useRealDice }),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={
        member.useRealDice
          ? "The game pauses on your rolls and asks for your real dice results. Click to switch back to automatic digital rolls."
          : "Roll your own physical dice: the game will tell you what to roll and wait for your result. Click to opt in."
      }
      className={cn(
        "flex w-full items-center justify-center gap-1 rounded border py-1 text-xs disabled:opacity-50",
        member.useRealDice
          ? "border-amber-700 bg-amber-950/40 text-amber-200 hover:bg-amber-950/60"
          : "border-stone-700 text-stone-400 hover:bg-stone-900",
      )}
    >
      <Dices className="size-3" />
      {member.useRealDice ? "Physical dice: ON" : "Physical dice: off"}
    </button>
  );
}

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
  onMessageUser,
  realDiceAllowed = false,
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
  onMessageUser?: (userId: string) => void;
  realDiceAllowed?: boolean;
}) {
  const [editingSheetId, setEditingSheetId] = useState("");
  const [viewingSheetId, setViewingSheetId] = useState("");
  const [croppingSheetId, setCroppingSheetId] = useState("");
  const [notesSheetId, setNotesSheetId] = useState("");
  const editingSheet = sheets.find((sheet) => sheet.id === editingSheetId);
  const viewingSheet = sheets.find((sheet) => sheet.id === viewingSheetId);
  const croppingSheet = sheets.find((sheet) => sheet.id === croppingSheetId);
  const notesSheet = sheets.find((sheet) => sheet.id === notesSheetId);
  const myMember = members.find((member) => member.userId === meUserId);
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
              "panel rounded-xl p-3 transition-shadow duration-200",
              mine && "ornate border-amber-600/40",
              spotlightUserIds.includes(sheet.userId) &&
                "border-amber-500/70 ring-1 ring-amber-500/60 shadow-glow-gold-strong",
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
                  className="size-12 shrink-0 rounded-lg border border-amber-500/30 object-cover shadow-glow-gold"
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-stone-700/60 bg-stone-900">
                  <UserRound className="size-5 text-stone-600" />
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
                onMessage={
                  onMessageUser && !mine ? () => onMessageUser(sheet.userId) : undefined
                }
              />
            </div>

            <div className="mt-2 flex items-center gap-2 text-sm">
              <Heart className="size-4 text-red-400" />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800/80 shadow-[0_1px_2px_rgba(4,2,12,0.6)_inset]">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500 ease-snap",
                    hpFraction > 0.5
                      ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
                      : hpFraction > 0.25
                        ? "bg-gradient-to-r from-amber-600 to-amber-400"
                        : "bg-gradient-to-r from-red-700 to-ember-500",
                  )}
                  style={{ width: `${Math.max(0, Math.min(1, hpFraction)) * 100}%` }}
                />
              </div>
              <span className="font-mono text-xs">
                {sheet.currentHp}
                {sheet.tempHp ? `+${sheet.tempHp}` : ""}/{sheet.maxHp}
              </span>
            </div>

            {sheet.deathSaves ? (
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    sheet.deathSaves.dead
                      ? "border-stone-600 bg-stone-900 text-stone-400"
                      : sheet.deathSaves.stable
                        ? "border-amber-700 bg-amber-950/40 text-amber-300"
                        : "border-red-700 bg-red-950/50 text-red-300",
                  )}
                >
                  {sheet.deathSaves.dead ? "Dead" : sheet.deathSaves.stable ? "Stable" : "Dying"}
                </span>
                {!sheet.deathSaves.dead && !sheet.deathSaves.stable ? (
                  <span className="flex items-center gap-1.5" title="Death saves: successes and failures">
                    <span className="flex gap-0.5">
                      {[0, 1, 2].map((pip) => (
                        <span
                          key={`s${pip}`}
                          className={cn(
                            "size-2 rounded-full border",
                            pip < sheet.deathSaves!.successes
                              ? "border-emerald-400 bg-emerald-500"
                              : "border-stone-600 bg-transparent",
                          )}
                        />
                      ))}
                    </span>
                    <span className="flex gap-0.5">
                      {[0, 1, 2].map((pip) => (
                        <span
                          key={`f${pip}`}
                          className={cn(
                            "size-2 rounded-full border",
                            pip < sheet.deathSaves!.failures
                              ? "border-red-400 bg-red-500"
                              : "border-stone-600 bg-transparent",
                          )}
                        />
                      ))}
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              {(
                [
                  ["AC", String(sheet.ac)],
                  ["PP", String(derived.passivePerception)],
                  ["Init", formatModifier(derived.initiative)],
                ] as const
              ).map(([statLabel, statValue]) => (
                <span
                  key={statLabel}
                  className="rounded-md border border-stone-700/50 bg-stone-950/60 py-1 shadow-[0_1px_2px_rgba(4,2,12,0.5)_inset]"
                >
                  <span className="eyebrow block text-[8px] text-stone-500">
                    {statLabel === "AC" ? (
                      <Shield className="mr-0.5 inline size-2.5 -translate-y-px" />
                    ) : null}
                    {statLabel}
                  </span>
                  <span className="font-mono text-xs text-stone-200">{statValue}</span>
                </span>
              ))}
            </div>

            {Object.keys(sheet.resources ?? {}).length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {Object.entries(sheet.resources).map(([id, state]) => (
                  <span
                    key={id}
                    className="rounded-full border border-stone-700/50 bg-stone-950/60 px-2 py-0.5 text-[10px] capitalize text-stone-300"
                    title="Limited-use resource: remaining/max"
                  >
                    {id.replaceAll("_", " ")} {state.max - state.used}/{state.max}
                  </span>
                ))}
              </div>
            ) : null}

            {sheet.conditions.length || sheet.concentratingOn || (sheet.exhaustion ?? 0) > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(sheet.exhaustion ?? 0) > 0 ? (
                  <span
                    className="rounded-full bg-orange-950 px-2 py-0.5 text-xs text-orange-300"
                    title="Exhaustion level (a long rest reduces it by one)"
                  >
                    exhaustion {sheet.exhaustion}
                  </span>
                ) : null}
                {sheet.conditions.map((condition) => (
                  <span
                    key={condition}
                    className="rounded-full bg-red-950 px-2 py-0.5 text-xs text-red-300"
                  >
                    {condition}
                    {sheet.conditionMeta?.[condition]?.rounds
                      ? ` (${sheet.conditionMeta[condition].rounds} rd)`
                      : ""}
                  </span>
                ))}
                {sheet.concentratingOn ? (
                  <span
                    className="rounded-full bg-sky-950 px-2 py-0.5 text-xs text-sky-300"
                    title="Concentrating on this spell"
                  >
                    ◎ {sheet.concentratingOn}
                  </span>
                ) : null}
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
                {realDiceAllowed && myMember ? (
                  <RealDiceToggle campaignId={sheet.campaignId} member={myMember} />
                ) : null}
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
