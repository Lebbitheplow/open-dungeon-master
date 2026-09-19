"use client";

import { Bot, Check, Crown, Trash2, UserPlus, Users, Volume2, VolumeX } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { GameIcon } from "@/components/ui/GameIcon";
import { Tooltip } from "@/components/ui/Tooltip";
import { UserAvatar, ui } from "@/lib/ui";
import type { CampaignMember } from "@/lib/campaign-types";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Small gold badge on a party row: DM, co-DM, party lead, owner, real dice.
function SeatBadge({ children, tip }: { children: ReactNode; tip?: string }) {
  const badge = (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
      {children}
    </span>
  );
  return tip ? <Tooltip content={tip}>{badge}</Tooltip> : badge;
}

// A seat action on a party row: make lead, make DM, make or remove co-DM.
function SeatAction({
  tip,
  onClick,
  children,
}: {
  tip: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tip}>
      <button
        type="button"
        onClick={onClick}
        className="motion-press inline-flex items-center gap-1 rounded-full border border-stone-700/70 px-2.5 py-1 text-[11px] text-stone-400 hover:border-amber-500/40 hover:bg-stone-900 hover:text-amber-100"
      >
        {children}
      </button>
    </Tooltip>
  );
}

// The lobby's party list: every member with their seat badges, ready state
// and, for whoever may hand seats around, the controls to do it. Below it,
// for whoever steers the story, the companions prepared for the party.
export function LobbyParty({
  campaign,
  members,
  sheets,
  canMakeLead,
  humanDmTable,
  canAssignSeats,
  seatError,
  onMakeLead,
  onAssignSeat,
  canMute,
  onMute,
  showParty,
  showCompanions,
  partyCompanions,
  canBuildCompanion,
  onBuildCompanion,
  onDismissCompanion,
  className,
  style,
  companionsClassName,
  companionsStyle,
}: {
  campaign: {
    maxPlayers: number;
    leadUserId: string;
    dmUserId: string | null;
    assistantDmUserId: string | null;
  };
  members: CampaignMember[];
  sheets: CharacterSheet[];
  // The lead or the owner may hand the lead seat on.
  canMakeLead: boolean;
  // A human sits in the DM seat ("human" and "assisted" alike), so the list
  // shows who holds it.
  humanDmTable: boolean;
  // The seat route's answer (primary DM or owner), asked of the server so a
  // button it would refuse is never rendered.
  canAssignSeats: boolean;
  seatError: string;
  onMakeLead: (userId: string) => void;
  onAssignSeat: (seat: "dm" | "assistant", userId: string | null) => void;
  // The lead or the owner may silence a player at this table.
  canMute: boolean;
  onMute: (userId: string, muted: boolean) => void;
  // A solo campaign has no party list, but its player may still keep
  // companions, so the two sections are switched separately.
  showParty: boolean;
  showCompanions: boolean;
  partyCompanions: CharacterSheet[];
  canBuildCompanion: boolean;
  onBuildCompanion: () => void;
  onDismissCompanion: (characterId: string) => void;
  // The lobby's layout hooks (order on the phone, entrance stagger). The
  // companions section takes the party's unless it is given its own.
  className?: string;
  style?: CSSProperties;
  companionsClassName?: string;
  companionsStyle?: CSSProperties;
}) {
  return (
    <>
      {showParty ? (
      <section className={cn("reveal mb-6", className)} style={style}>
        <div className="lobby-head mb-3">
          <GameIcon icon={{ kind: "glyph", key: "tab-party" }} size="size-7" />
          <h2 className="lobby-head-title">
            Party · {members.length}/{campaign.maxPlayers}
          </h2>
          <span className="lobby-head-rule motion-rule" aria-hidden="true" />
        </div>
        <ul className="stagger space-y-2">
          {members.map((member, index) => {
            const sheet = sheets.find((entry) => entry.userId === member.userId);
            return (
              <li
                key={member.userId}
                data-ready={member.ready ? "" : undefined}
                style={{ "--i": Math.min(index, 8) } as CSSProperties}
                className={cn(ui.card, "lobby-seat px-4 py-3")}
              >
                {/* Who they are and what they hold on the left, where they
                    stand on the right; the seat powers sit on their own line
                    under a hairline so a badge is never mistaken for a button. */}
                <div className="flex items-center gap-3">
                  <span className="lobby-medallion" data-ready={member.ready ? "" : undefined}>
                    <span className="lobby-medallion-face block">
                      <UserAvatar url={member.avatar?.url} userId={member.userId} size="size-full" />
                    </span>
                    {sheet ? (
                      <span className="lobby-medallion-emblem" title={sheet.class}>
                        <GameIcon
                          icon={{ kind: "family", key: `class-${sheet.class.toLowerCase()}` }}
                          size="size-6"
                        />
                      </span>
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 font-medium text-stone-100">
                      <span className="truncate">{member.username}</span>
                      {humanDmTable && member.userId === campaign.dmUserId ? (
                        <SeatBadge>DM</SeatBadge>
                      ) : null}
                      {humanDmTable && member.userId === campaign.assistantDmUserId ? (
                        <SeatBadge>co-DM</SeatBadge>
                      ) : null}
                      {member.userId === campaign.leadUserId ? (
                        <SeatBadge>
                          <Crown className="size-3" /> party lead
                        </SeatBadge>
                      ) : member.role === "owner" ? (
                        <SeatBadge>owner</SeatBadge>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-stone-400">
                      {sheet
                        ? `${sheet.name} · ${sheet.race.replaceAll("_", " ")} ${sheet.class} ${sheet.level}`
                        : "No character yet"}
                    </p>
                  </div>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {member.muted ? (
                      <SeatBadge tip="Muted by the party lead">
                        <VolumeX className="size-3" /> muted
                      </SeatBadge>
                    ) : null}
                    {member.useRealDice ? (
                      <SeatBadge tip="Rolls physical dice: the DM waits for this player to enter real rolls">
                        real dice
                      </SeatBadge>
                    ) : null}
                    <span
                      // Keyed by the state so the pill remounts and pops when
                      // a player readies up or backs out.
                      key={member.ready ? "ready" : "waiting"}
                      className={cn(
                        "lobby-pop inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                        member.ready
                          ? "border border-amber-400/50 bg-amber-400/15 text-amber-100"
                          : "border border-stone-700/70 bg-stone-900/60 text-stone-400",
                      )}
                    >
                      {member.ready ? <Check className="size-3" /> : null}
                      {member.ready ? "ready" : "not ready"}
                    </span>
                  </span>
                </div>
                {(() => {
                  const mayLead = canMakeLead && member.userId !== campaign.leadUserId;
                  const maySeat = humanDmTable && canAssignSeats && member.userId !== campaign.dmUserId;
                  const mayMute = canMute && member.userId !== campaign.leadUserId && member.role !== "owner";
                  if (!mayLead && !maySeat && !mayMute) {
                    return null;
                  }
                  return (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-stone-700/40 pt-2.5">
                      {mayLead ? (
                        <SeatAction
                          tip="Hand the party lead to this player"
                          onClick={() => onMakeLead(member.userId)}
                        >
                          <Crown className="size-3" /> make lead
                        </SeatAction>
                      ) : null}
                      {maySeat ? (
                        <>
                          <SeatAction
                            tip="Hand this player the DM seat and the game"
                            onClick={() => onAssignSeat("dm", member.userId)}
                          >
                            make DM
                          </SeatAction>
                          {member.userId === campaign.assistantDmUserId ? (
                            <SeatAction
                              tip="Take back the co-DM seat"
                              onClick={() => onAssignSeat("assistant", null)}
                            >
                              remove co-DM
                            </SeatAction>
                          ) : (
                            <SeatAction
                              tip="Seat this player as co-DM: every DM power except handing out seats"
                              onClick={() => onAssignSeat("assistant", member.userId)}
                            >
                              make co-DM
                            </SeatAction>
                          )}
                        </>
                      ) : null}
                      {mayMute ? (
                        <SeatAction
                          tip={
                            member.muted
                              ? "Let this player speak at the table again"
                              : "Mute: this player reads along but cannot act, ask or side-chat"
                          }
                          onClick={() => onMute(member.userId, !member.muted)}
                        >
                          {member.muted ? (
                            <>
                              <Volume2 className="size-3" /> unmute
                            </>
                          ) : (
                            <>
                              <VolumeX className="size-3" /> mute
                            </>
                          )}
                        </SeatAction>
                      ) : null}
                    </div>
                  );
                })()}
              </li>
            );
          })}
        </ul>
        {/* Open seats read as an invitation rather than as nothing. */}
        {members.length < campaign.maxPlayers ? (
          <p className="reveal mt-2 rounded-xl border border-dashed border-stone-700/70 px-4 py-2.5 text-center text-xs text-stone-500">
            {campaign.maxPlayers - members.length} open{" "}
            {campaign.maxPlayers - members.length === 1 ? "seat" : "seats"}. Share the room code to fill{" "}
            {campaign.maxPlayers - members.length === 1 ? "it" : "them"}.
          </p>
        ) : null}
        {seatError ? <p className="motion-shake mt-2 text-sm text-red-400">{seatError}</p> : null}
      </section>
      ) : null}

      {showCompanions ? (
        <section className={cn("reveal mb-6", companionsClassName ?? className)} style={companionsStyle ?? style}>
          <div className="lobby-head mb-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-sky-500/40 bg-stone-950 text-sky-300">
              {humanDmTable ? <Users className="size-3.5" /> : <Bot className="size-3.5" />}
            </span>
            <h2 className="lobby-head-title">Companions</h2>
            <span className="lobby-head-rule motion-rule" aria-hidden="true" />
          </div>
          {partyCompanions.length ? (
            <ul className="stagger mb-2 space-y-2">
              {partyCompanions.map((companion, index) => (
                <li
                  key={companion.id}
                  style={{ "--i": Math.min(index, 8) } as CSSProperties}
                  className={cn(ui.card, "lobby-seat flex items-center justify-between gap-3 px-4 py-2.5")}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {companion.portrait ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={companion.portrait.url}
                        alt=""
                        className="size-10 shrink-0 rounded-lg border border-sky-500/30 object-cover"
                      />
                    ) : (
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-stone-700/60 bg-stone-900">
                        {humanDmTable ? (
                          <Users className="size-4 text-sky-300" />
                        ) : (
                          <Bot className="size-4 text-sky-300" />
                        )}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-100">{companion.name}</p>
                      <p className="truncate text-sm text-stone-400">
                        {companion.race.replaceAll("_", " ")} {companion.class} {companion.level}
                      </p>
                    </div>
                  </div>
                  <Tooltip content="Remove this companion">
                    <button
                      type="button"
                      onClick={() => onDismissCompanion(companion.id)}
                      aria-label={`Remove ${companion.name}`}
                      className="motion-nudge rounded-full border border-stone-700/70 p-2 text-stone-500 hover:border-red-500/40 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          ) : null}
          {canBuildCompanion ? (
            <button
              type="button"
              onClick={onBuildCompanion}
              className="motion-press flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-700 px-3 py-3 text-sm text-stone-300 hover:border-sky-700/60 hover:bg-stone-900 hover:text-sky-200"
            >
              <UserPlus className="size-4" /> Add a companion
            </button>
          ) : (
            <p className="text-center text-xs text-stone-500">
              The party has its full number of companions.
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
