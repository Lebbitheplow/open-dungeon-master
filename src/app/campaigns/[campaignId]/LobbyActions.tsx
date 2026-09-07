"use client";

import Link from "next/link";
import { Check, Loader2, Pencil, Play, Trash2, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CampaignMember } from "@/lib/campaign-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Edit, switch or remove your character. Shown under the ready button once
// a character exists, in every flow that has one.
function CharacterActions({
  campaignId,
  sheet,
  busy,
  onRemove,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
      <span className="text-stone-500">{sheet.name}:</span>
      <Link href={`/campaigns/${campaignId}/character?mode=edit`} className={ui.btnSmall}>
        <Pencil className="size-3" /> Edit
      </Link>
      <Link href={`/campaigns/${campaignId}/character?mode=replace`} className={ui.btnSmall}>
        <UserRound className="size-3" /> Switch
      </Link>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className={cn(ui.btnSmall, "text-red-300")}
      >
        <Trash2 className="size-3" /> Remove
      </button>
    </div>
  );
}

// Opening the adventure. Pulled out of the player branch because the DM needs
// it just as much: a DM who owned the table used to see a Ready button and
// nothing else, so a human-run game could never be started from the seat that
// was running it. `blocker` is the server's own rule (lobbyBlocker in
// src/lib/dm/viewer.ts), so this button is never offered when the PATCH would
// refuse it, and the reason shown is the reason the server would give.
function StartBlock({
  isOwner,
  busy,
  blocker,
  onStart,
}: {
  isOwner: boolean;
  busy: boolean;
  blocker: string;
  onStart: () => void;
}) {
  if (!isOwner) {
    return (
      <p className="text-center text-sm text-stone-500">
        The owner starts the adventure once everyone is ready.
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={onStart}
        disabled={busy || Boolean(blocker)}
        className={cn(ui.btnPrimary, "w-full py-2.5")}
      >
        <Play className="size-4" /> Begin the adventure
      </button>
      {blocker ? <p className="text-center text-sm text-stone-500">{blocker}</p> : null}
    </>
  );
}

// The block at the foot of the lobby that changes with the seat. The DM
// readies up without a character; a solo player readies and begins in one
// stroke; everyone else creates a character and readies up. Below all of
// them, for every seat but the solo player, the owner's Begin button: the DM
// is usually the owner of a game they run, so that button has to reach the DM
// seat too. Delete is the owner's alone and sits last, quiet, because it is
// irreversible.
export function LobbyActions({
  campaign,
  myMember,
  mySheet,
  isDm,
  isSolo,
  isOwner,
  busy,
  error,
  startBlocker,
  onToggleReady,
  onStart,
  onBeginSolo,
  onRemoveCharacter,
  onDelete,
}: {
  campaign: { id: string };
  myMember: CampaignMember | undefined;
  mySheet: CharacterSheet | undefined;
  isDm: boolean;
  isSolo: boolean;
  isOwner: boolean;
  busy: boolean;
  error: string;
  startBlocker: string;
  onToggleReady: () => void;
  onStart: () => void;
  onBeginSolo: () => void;
  onRemoveCharacter: () => void;
  onDelete: () => void;
}) {
  return (
    <section className="space-y-3">
      {isDm ? (
        <div className={cn(ui.card, "ornate flex flex-col items-center gap-2 px-6 py-6 text-center")}>
          <p className="font-display text-lg tracking-wide text-amber-50">
            You are running this game.
          </p>
          <p className="max-w-sm text-balance text-sm text-stone-400">
            No character, no party slot. Ready up when the table is set and the adventure is
            yours to open.
          </p>
          <button type="button" onClick={onToggleReady} className={cn(ui.btnPrimary, "mt-1 px-6")}>
            {myMember?.ready ? "Not ready" : "Ready"}
          </button>
        </div>
      ) : isSolo ? (
        !mySheet ? (
          <div className={cn(ui.card, "ornate flex flex-col items-center gap-3 px-6 py-8 text-center")}>
            <p className="max-w-sm text-balance font-display text-xl tracking-wide text-amber-50">
              Your adventure needs a hero.
            </p>
            <Link href={`/campaigns/${campaign.id}/character`} className={cn(ui.btnPrimary, "px-6")}>
              Create your character
            </Link>
          </div>
        ) : (
          <>
            <CharacterActions
              campaignId={campaign.id}
              sheet={mySheet}
              busy={busy}
              onRemove={onRemoveCharacter}
            />
            <button
              type="button"
              onClick={onBeginSolo}
              disabled={busy}
              className={cn(ui.btnPrimary, "w-full py-2.5")}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Begin the adventure
            </button>
          </>
        )
      ) : !mySheet ? (
        <Link href={`/campaigns/${campaign.id}/character`} className={cn(ui.btnPrimary, "w-full")}>
          Create your character
        </Link>
      ) : (
        <>
          <button
            type="button"
            onClick={onToggleReady}
            disabled={busy}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 font-medium transition-colors disabled:opacity-60",
              myMember?.ready
                ? "border border-stone-700 text-stone-300 hover:bg-stone-900"
                : "border border-emerald-500/40 bg-emerald-700 text-emerald-50 hover:bg-emerald-600",
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {myMember?.ready ? "Un-ready" : "Ready up"}
          </button>
          <CharacterActions
            campaignId={campaign.id}
            sheet={mySheet}
            busy={busy}
            onRemove={onRemoveCharacter}
          />
          <p className="text-center text-xs text-stone-600">
            Changing your character clears your ready status.
          </p>
        </>
      )}

      {/* Every seat but the solo player, whose single button readies up and
          begins in one stroke. A table with a person in the DM seat is never
          solo, however few players it has (Lobby.tsx), so the DM always lands
          here. */}
      {isSolo ? null : (
        <StartBlock isOwner={isOwner} busy={busy} blocker={startBlocker} onStart={onStart} />
      )}
      {error ? <p className="text-center text-sm text-red-400">{error}</p> : null}

      {isOwner ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="mx-auto flex items-center gap-1.5 pt-2 text-xs text-stone-600 transition-colors hover:text-red-400 disabled:opacity-60"
        >
          <Trash2 className="size-3.5" /> Delete this campaign
        </button>
      ) : null}
    </section>
  );
}
