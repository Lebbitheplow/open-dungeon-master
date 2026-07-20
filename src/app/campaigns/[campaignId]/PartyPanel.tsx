"use client";

import {
  Bot,
  Check,
  Crown,
  Dices,
  Heart,
  ImagePlus,
  PawPrint,
  Save,
  Shield,
  StickyNote,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CharacterMenu } from "@/app/campaigns/[campaignId]/CharacterMenu";
import { CharacterNotesDialog } from "@/app/campaigns/[campaignId]/CharacterNotesDialog";
import { CharacterSheetDialog } from "@/app/campaigns/[campaignId]/CharacterSheetDialog";
import { CompanionBuilderDialog } from "@/app/campaigns/[campaignId]/CompanionBuilderDialog";
import { LeadEditDialog } from "@/app/campaigns/[campaignId]/LeadEditDialog";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import type { CampaignMember } from "@/lib/campaign-types";
import type { Note } from "@/lib/db/notes";
import type { Genre } from "@/lib/schemas/game-settings";
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

// Nudges the DM to write an AI companion into the story (the DM decides who
// arrives and how); shown while the table is below its companion cap.
function RequestCompanionButton({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  async function request() {
    setState("sending");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/companions/request`, {
        method: "POST",
      });
      setState(response.ok ? "sent" : "idle");
      if (response.ok) {
        setTimeout(() => setState("idle"), 4_000);
      }
    } catch {
      setState("idle");
    }
  }
  return (
    <button
      type="button"
      onClick={request}
      disabled={state !== "idle"}
      title="Ask the DM to write an ally with a real character sheet into the story"
      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-700 py-2 text-xs text-stone-400 hover:bg-stone-900 hover:text-sky-200 disabled:opacity-60"
    >
      <Bot className="size-3.5" />
      {state === "sent" ? "The DM has been asked" : "Request a companion"}
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
  inCombat = false,
  campaignId = "",
  companionsAvailable = false,
  companionBuildAvailable = false,
  companionGenre,
  companionLevel = 1,
}: {
  sheets: CharacterSheet[];
  meUserId: string;
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
  // Active encounter: the owner's counter steppers lock the recover side.
  inCombat?: boolean;
  // AI companions: when a party or guest slot is free, show the request button.
  campaignId?: string;
  companionsAvailable?: boolean;
  // Manual build (lasting party companion) is offered only when the table
  // allows party companions and a party slot is free.
  companionBuildAvailable?: boolean;
  companionGenre?: Genre;
  companionLevel?: number;
}) {
  const [editingSheetId, setEditingSheetId] = useState("");
  const [viewingSheetId, setViewingSheetId] = useState("");
  const [croppingSheetId, setCroppingSheetId] = useState("");
  const [notesSheetId, setNotesSheetId] = useState("");
  const [buildingCompanion, setBuildingCompanion] = useState(false);
  const editingSheet = sheets.find((sheet) => sheet.id === editingSheetId);
  const viewingSheet = sheets.find((sheet) => sheet.id === viewingSheetId);
  const croppingSheet = sheets.find((sheet) => sheet.id === croppingSheetId);
  const notesSheet = sheets.find((sheet) => sheet.id === notesSheetId);
  const myMember = members.find((member) => member.userId === meUserId);
  const Wrapper = embedded ? "div" : "aside";

  // Safety net for the Radix dropdown-opens-dialog race: whenever every
  // dialog owned by this panel is closed, body pointer-events must be back;
  // a stranded pointer-events:none makes the whole page unclickable.
  const anyDialogOpen = Boolean(
    editingSheetId || viewingSheetId || croppingSheetId || notesSheetId || buildingCompanion,
  );
  useEffect(() => {
    if (!anyDialogOpen && document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  }, [anyDialogOpen]);

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
        // Wild Shape: the beast's pool is what damage actually hits, so the
        // bar tracks it and the druid's own hit points wait in the label.
        const shape = sheet.wildShape;
        const hpFraction = shape
          ? shape.beastMaxHp > 0
            ? shape.beastHp / shape.beastMaxHp
            : 0
          : sheet.maxHp > 0
            ? sheet.currentHp / sheet.maxHp
            : 0;
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
                  {sheet.isCompanion ? (
                    <Bot
                      className="size-3.5 shrink-0 text-sky-300"
                      aria-label="AI companion"
                    />
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
                  onMessageUser && !mine && !sheet.isCompanion
                    ? () => onMessageUser(sheet.userId)
                    : undefined
                }
              />
            </div>

            {shape ? (
              <div
                className="mt-2 flex items-center gap-1.5 rounded-md border border-lime-800/60 bg-lime-950/40 px-2 py-1 text-xs text-lime-300"
                title={`Wild Shaped: damage hits the beast's hit points first. ${sheet.name}'s own ${sheet.currentHp}/${sheet.maxHp} waits for them when the form breaks.`}
              >
                <PawPrint className="size-3.5 shrink-0" />
                <span className="truncate capitalize">{shape.form}</span>
              </div>
            ) : null}

            <div className="mt-2 flex items-center gap-2 text-sm">
              <Heart className={cn("size-4", shape ? "text-lime-400" : "text-red-400")} />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-800/80 shadow-[0_1px_2px_rgba(4,2,12,0.6)_inset]">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500 ease-snap",
                    shape
                      ? "bg-gradient-to-r from-lime-700 to-lime-400"
                      : hpFraction > 0.5
                        ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
                        : hpFraction > 0.25
                          ? "bg-gradient-to-r from-amber-600 to-amber-400"
                          : "bg-gradient-to-r from-red-700 to-ember-500",
                  )}
                  style={{ width: `${Math.max(0, Math.min(1, hpFraction)) * 100}%` }}
                />
              </div>
              {shape ? (
                <span
                  className="font-mono text-xs text-lime-300"
                  title={`Beast form hit points. ${sheet.name}'s own: ${sheet.currentHp}/${sheet.maxHp}`}
                >
                  {shape.beastHp}
                  {sheet.tempHp ? `+${sheet.tempHp}` : ""}/{shape.beastMaxHp}
                </span>
              ) : (
                <span className="font-mono text-xs">
                  {sheet.currentHp}
                  {sheet.tempHp ? `+${sheet.tempHp}` : ""}/{sheet.maxHp}
                </span>
              )}
            </div>

            {shape ? (
              <div className="mt-1 text-right font-mono text-[10px] text-stone-500">
                own {sheet.currentHp}/{sheet.maxHp}
              </div>
            ) : null}

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
                  ["AC", String(shape ? shape.beastAc : sheet.ac)],
                  ["PP", String(derived.passivePerception)],
                  ["Init", formatModifier(derived.initiative)],
                ] as const
              ).map(([statLabel, statValue]) => (
                <span
                  key={statLabel}
                  className={cn(
                    "rounded-md border border-stone-700/50 bg-stone-950/60 py-1 shadow-[0_1px_2px_rgba(4,2,12,0.5)_inset]",
                    shape && statLabel === "AC" && "border-lime-800/60 text-lime-300",
                  )}
                  title={
                    shape && statLabel === "AC"
                      ? `The beast form's armor class; ${sheet.name}'s own is ${sheet.ac}.`
                      : undefined
                  }
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
                {/* Hit points are driven by the server rules engines now, so
                    there is no manual HP stepper here; the lead's Adjust
                    dialog remains for corrections. */}
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

      {campaignId && companionsAvailable && isLead ? (
        <div className="space-y-1.5">
          <RequestCompanionButton campaignId={campaignId} />
          {companionBuildAvailable ? (
            <button
              type="button"
              onClick={() => setBuildingCompanion(true)}
              title="Build a companion yourself with the character creator"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-700 py-2 text-xs text-stone-400 hover:bg-stone-900 hover:text-sky-200"
            >
              <UserPlus className="size-3.5" />
              Build a companion
            </button>
          ) : null}
        </div>
      ) : null}

      {buildingCompanion && campaignId ? (
        <CompanionBuilderDialog
          campaignId={campaignId}
          genre={companionGenre}
          level={companionLevel}
          onClose={() => setBuildingCompanion(false)}
        />
      ) : null}

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
          inCombat={inCombat}
          onAdjust={() => {
            // Close the sheet dialog fully before mounting the edit dialog;
            // swapping two modals in one commit can strand the body scroll
            // lock (same family of bug as the dropdown race above).
            const sheetId = viewingSheet.id;
            setViewingSheetId("");
            setTimeout(() => setEditingSheetId(sheetId), 0);
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
