"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import type { CampaignMember } from "@/lib/campaign-types";
import type { InputKind } from "@/lib/campaign-types";
import { MODE_GLYPHS } from "@/app/campaigns/[campaignId]/sessionGlyphs";
import { cn } from "@/lib/cn";
import { campaignPlaceholder, characterPlaceholder, monsterPlaceholder, npcPlaceholder } from "@/lib/placeholders";
import type { CampaignCover } from "@/lib/campaign-types";
import type { CampaignMessage } from "@/lib/db/messages";
import { clipRecap } from "@/lib/recap";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { TokenFace } from "@/app/campaigns/[campaignId]/BoardChrome";

// The cinematic table ("ODM World Concepts", round 3b): the scene's own
// painting fills the screen, the chrome shrinks to its edges, and the fight
// reads off the frame itself: the initiative ribbon along the top, the party
// down the left, the last roll as a pill over the stage. Everything here is
// presentation over state the table already streams; nothing is asked of
// the server. Styles live in src/app/styles/world.css (cine-*).

// ---- the painting behind the table ----

// The newest scene art the DM painted, the campaign's cover otherwise, the
// genre plate when there is neither. Two layers so a new painting fades in
// over the old; the outgoing layer is dropped once the fade has run.
export function SceneBackdrop({
  messages,
  cover,
  genre,
  seed,
  dark,
}: {
  messages: ReadonlyArray<Pick<CampaignMessage, "generatedImage">>;
  cover: CampaignCover | null;
  genre: string | null | undefined;
  seed: string;
  // Night in the story darkens the scrim a shade.
  dark?: boolean;
}) {
  const painted = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const url = messages[index]?.generatedImage?.url;
      if (url) return url;
    }
    return null;
  }, [messages]);
  const url = painted || cover?.url || campaignPlaceholder(genre, seed);
  const [layers, setLayers] = useState<string[]>([url]);
  // State from props during render (React's "adjusting state when a prop
  // changes"): a new painting joins the stack the moment the table changes.
  if (layers[layers.length - 1] !== url) {
    setLayers([...layers.slice(-1), url]);
  }
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers((current) => current.slice(-1)), 1400);
    return () => window.clearTimeout(timer);
  }, [layers]);
  return (
    <div className="cine-backdrop" data-dark={dark ? "true" : undefined} aria-hidden="true">
      {layers.map((src, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" className={cn("cine-art", index === layers.length - 1 && "cine-art-in")} />
      ))}
      <div className="cine-scrim cine-scrim-stack" />
      <div className="cine-scrim cine-scrim-vignette" />
    </div>
  );
}

// ---- faces ----

// The pictures to try for one combatant, best first: their own portrait,
// the painted plate for their class and race, the bestiary plate for a foe.
// The same order the board's tokens follow.
export function facesFor(
  entry: { id: string; kind: "pc" | "enemy" | "npc"; name: string },
  sheets: ReadonlyArray<CharacterSheet>,
  enemies: PublicEncounter["enemies"] | undefined,
  genre: string | null | undefined,
): Array<string | null | undefined> {
  if (entry.kind === "pc" || entry.kind === "npc") {
    const sheet = sheets.find((candidate) => candidate.id === entry.id);
    if (sheet) {
      return [sheet.portrait?.url, characterPlaceholder({ race: sheet.race, class: sheet.class, genre })];
    }
    return [npcPlaceholder(null, entry.name)];
  }
  const enemy = enemies?.find((candidate) => candidate.id === entry.id);
  return [enemy ? monsterPlaceholder(enemy.type, { cr: enemy.cr, genre, seed: enemy.name }) : null];
}

// ---- the initiative ribbon along the top ----

// "ROUND 1" and the turn order as a row of faces: the one whose turn it is
// stands taller in a lit gold ring, foes wear ember, everyone else waits at
// the same height. A tap opens the party.
export function InitiativeRibbon({
  encounter,
  sheets,
  genre,
  onOpen,
}: {
  encounter: PublicEncounter;
  sheets: ReadonlyArray<CharacterSheet>;
  genre: string | null | undefined;
  onOpen?: () => void;
}) {
  const orderRef = useRef<HTMLOListElement>(null);
  const ready = encounter.orderReady && encounter.order.length > 0;
  const shown = ready ? encounter.order.filter((entry) => !entry.hidden) : [];
  const turnAt = shown.findIndex((entry) => encounter.order.indexOf(entry) === encounter.turnIndex);
  // The seat whose turn it is glides into view; the pool of light under it
  // (world.css, --turn) travels the same way, so a turn change reads as a
  // spotlight moving rather than one face blinking off and another on.
  useEffect(() => {
    const list = orderRef.current;
    const seat = turnAt >= 0 ? (list?.children[turnAt] as HTMLElement | undefined) : undefined;
    if (!list || !seat) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: seat.offsetLeft - (list.clientWidth - seat.offsetWidth) / 2, behavior: still ? "auto" : "smooth" });
  }, [turnAt]);
  if (!ready) {
    return null;
  }
  return (
    <div className="cine-ribbon" role="group" aria-label={`Round ${encounter.round}, turn order`}>
      <span className="cine-ribbon-round">Round {encounter.round}</span>
      <ol
        ref={orderRef}
        className="cine-ribbon-order"
        data-lit={turnAt >= 0 ? "true" : undefined}
        style={{ "--turn": Math.max(0, turnAt) } as CSSProperties}
      >
        {shown.map((entry) => {
          const index = encounter.order.indexOf(entry);
          const current = index === encounter.turnIndex;
          return (
            <li
              key={`${entry.id}-${index}`}
              className="cine-ribbon-seat"
              data-current={current ? "true" : undefined}
              data-done={index < encounter.turnIndex ? "true" : undefined}
              data-foe={entry.kind === "enemy" ? "true" : undefined}
            >
              <button type="button" className="cine-ribbon-face" onClick={onOpen} aria-label={`${entry.name}${current ? ", their turn" : ""}`} aria-current={current ? "step" : undefined} data-no-motion>
                <TokenFace candidates={facesFor(entry, sheets, encounter.enemies, genre)} name={entry.name} enemy={entry.kind === "enemy"} className="cine-ribbon-img" />
              </button>
              <span className="cine-ribbon-name">{shortName(entry.name)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function shortName(name: string): string {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= 1 || trimmed.length <= 8) return trimmed;
  // "Salt-Glass Husk 2" keeps its number; "Thane Ordwin" keeps his first name.
  const last = words[words.length - 1];
  return /^\d+$/.test(last) ? `${words[words.length - 2]} ${last}` : words[0];
}

// ---- the party down the left ----

// One card per hero: face, name, a gold HP bar and the class line; the hero
// whose turn it is lit, your own marked. A tap opens the party panel.
export function PartyRail({
  sheets,
  meUserId,
  encounter,
  genre,
  onOpen,
}: {
  sheets: ReadonlyArray<CharacterSheet>;
  meUserId: string;
  encounter: PublicEncounter | null | undefined;
  genre: string | null | undefined;
  onOpen: () => void;
}) {
  // The last hit points seen per hero, so a change plays as a beat: an
  // ember pulse and a lingering ghost bar for damage, a green pulse for
  // healing. State from props during render; a reload simply starts quiet.
  const [memory, setMemory] = useState<Record<string, { hp: number; dir?: "up" | "down" }>>({});
  const party = sheets.filter((sheet) => !sheet.isCompanion);
  const next: Record<string, { hp: number; dir?: "up" | "down" }> = { ...memory };
  let changed = false;
  for (const sheet of party) {
    const max = Math.max(1, sheet.maxHp ?? 1);
    const hp = Math.max(0, Math.min(max, sheet.currentHp ?? max));
    const prior = memory[sheet.id];
    if (!prior || prior.hp !== hp) {
      next[sheet.id] = { hp, dir: prior ? (hp < prior.hp ? "down" : "up") : undefined };
      changed = true;
    }
  }
  if (changed) {
    setMemory(next);
  }
  if (party.length === 0) {
    return null;
  }
  const currentId =
    encounter?.status === "active" && encounter.orderReady ? encounter.order[encounter.turnIndex]?.id : undefined;
  return (
    <aside className="cine-party" aria-label="The party">
      {party.map((sheet, index) => {
        const max = Math.max(1, sheet.maxHp ?? 1);
        const hp = Math.max(0, Math.min(max, sheet.currentHp ?? max));
        const ratio = hp / max;
        const pct = `${Math.round(ratio * 100)}%`;
        const dir = next[sheet.id]?.dir;
        return (
          <button
            key={sheet.id}
            type="button"
            onClick={onOpen}
            className="cine-party-card"
            data-current={sheet.id === currentId ? "true" : undefined}
            data-mine={sheet.userId === meUserId ? "true" : undefined}
            data-down={hp === 0 ? "true" : undefined}
            style={{ animationDelay: `${120 + index * 70}ms` }}
            aria-label={`${sheet.name}, ${hp} of ${max} hit points. Open the party.`}
            data-no-motion
          >
            <span key={`pulse-${hp}`} className="cine-party-pulse" data-dir={dir} aria-hidden="true" />
            <TokenFace
              candidates={[sheet.portrait?.url, characterPlaceholder({ race: sheet.race, class: sheet.class, genre })]}
              name={sheet.name}
              className="cine-party-face"
            />
            <span className="cine-party-body">
              <span className="cine-party-line">
                <span className="cine-party-name">{sheet.name}</span>
                <span key={`hp-${hp}`} className="cine-party-hp" data-dir={dir}>{hp}/{max}</span>
              </span>
              <span className="cine-party-bar" aria-hidden="true">
                <span className="cine-party-ghost" style={{ width: pct }} />
                <span className="cine-party-fill" data-low={ratio <= 0.34 ? "true" : undefined} style={{ width: pct }} />
              </span>
              <span className="cine-party-class">
                {sheet.class} {sheet.level}
              </span>
            </span>
          </button>
        );
      })}
    </aside>
  );
}

// ---- the last roll, as a pill over the stage ----

// "Sera · Fire Bolt · 1d20+5 = 6 · NATURAL 1": the roll that just landed,
// held for a few seconds where every eye already is. Ember for a natural 1,
// gold for a 20, plain otherwise. Blind and DM-only rolls never show.
const TOAST_MS = 5200;
const ROLL_LABELS: Record<string, string> = {
  skill_check: "Skill check",
  saving_throw: "Saving throw",
  ability_check: "Ability check",
  attack: "Attack",
  damage: "Damage",
  initiative: "Initiative",
  custom: "Roll",
};

export function RollToast({
  latestRoll,
  sheets,
}: {
  latestRoll: { roll: StoredRoll; seq: number } | null;
  sheets: ReadonlyArray<CharacterSheet>;
}) {
  const [shown, setShown] = useState<{ roll: StoredRoll; seq: number } | null>(null);
  // Each roll is judged once, during the render it arrives in (state from
  // props). The roll the snapshot arrived with is history, not news, so the
  // first seq seen is the one to skip; every later public roll takes the
  // stage.
  const [seenSeq, setSeenSeq] = useState<number | null>(() => latestRoll?.seq ?? null);
  if (latestRoll && latestRoll.seq !== seenSeq) {
    setSeenSeq(latestRoll.seq);
    if (latestRoll.roll.visibility === "public") {
      setShown(latestRoll);
    }
  }
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown((current) => (current?.seq === shown.seq ? null : current)), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);
  if (!shown) {
    return null;
  }
  const { roll } = shown;
  const who = roll.characterId ? sheets.find((sheet) => sheet.id === roll.characterId)?.name : null;
  const what = roll.detail?.trim() || ROLL_LABELS[roll.kind] || "Roll";
  const crit = roll.breakdown?.crit;
  return (
    <div key={shown.seq} className="cine-roll" data-crit={crit ?? undefined} role="status" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/icons/glyph/tab-dice.webp" alt="" className="cine-roll-die" />
      <span className="cine-roll-text">
        {who ? `${who} · ` : roll.requestedBy === "dm" ? "The DM · " : ""}
        {what} ·{" "}
        <span className="cine-roll-math">
          {roll.expression} = {roll.total}
        </span>
      </span>
      {crit ? <span className="cine-roll-crit">{crit === "nat20" ? "Natural 20" : "Natural 1"}</span> : null}
      {roll.dc !== null && roll.success !== null && !crit ? (
        <span className="cine-roll-crit" data-quiet="true">{roll.success ? "Success" : "Miss"}</span>
      ) : null}
    </div>
  );
}

// ---- the quest, in a line ----

// The first line of the quest log, as the small panel under the minimap in
// the concept: "QUEST · THE DROWNED LANTERN" and its first sentence. A tap
// opens the story's quests.
export function QuestGlance({ quests, onOpen }: { quests: ReadonlyArray<string>; onOpen: () => void }) {
  const first = quests.find((quest) => quest.trim().length > 0)?.trim();
  if (!first) {
    return null;
  }
  const colon = first.indexOf(":");
  const title = colon > 0 && colon < 60 ? first.slice(0, colon).trim() : "";
  const body = colon > 0 && colon < 60 ? first.slice(colon + 1).trim() : first;
  return (
    <button type="button" onClick={onOpen} className="cine-quest" aria-label={`Quest: ${title || body}. Open the quests.`} data-no-motion>
      <span className="cine-quest-eyebrow">Quest{title ? ` · ${title}` : ""}</span>
      <span className="cine-quest-body">{body}</span>
    </button>
  );
}

// ---- the tabletop's turn order (the enlarged board, concept 3c) ----

export function TabletopOrder({
  encounter,
  faceOf,
  children,
}: {
  encounter: PublicEncounter | null | undefined;
  faceOf: (entry: { id: string; kind: string; name: string }) => Array<string | null | undefined>;
  children?: ReactNode;
}) {
  if (!encounter?.orderReady || encounter.order.length === 0) {
    return null;
  }
  return (
    <aside className="cine-order" aria-label={`Round ${encounter.round}, turn order`}>
      <span className="cine-order-round">Round {encounter.round}</span>
      <ol className="cine-order-list">
        {encounter.order.map((entry, index) => (
          <li key={`${entry.id}-${index}`} className="cine-order-row" data-current={index === encounter.turnIndex ? "true" : undefined} data-foe={entry.kind === "enemy" ? "true" : undefined}>
            <TokenFace candidates={faceOf(entry)} name={entry.name} enemy={entry.kind === "enemy"} className="cine-order-face" />
            <span className="cine-order-name">
              {entry.name}
              {entry.hidden ? " (hidden)" : ""}
            </span>
            {typeof entry.initiative === "number" ? <span className="cine-order-init">{entry.initiative}</span> : null}
          </li>
        ))}
      </ol>
      {children}
    </aside>
  );
}

// ---- the chronicle scroll beside the tabletop (concept 3c) ----

// The tale so far as a night scroll with gold rollers: the last passages,
// the rolls noted in ember, the party's lines in italic, and the same
// composer as the desk (it shares the desk's mode and text, so nothing
// typed here is lost when the board closes). Roll markers in a passage
// become notes when the roll is in hand and vanish otherwise.
const ROLL_MARKER = /\[roll:([0-9a-f-]{36})\]/g;
const CHRONICLE_ENTRIES = 14;

export function TabletopChronicle({
  messages,
  rolls,
  sheets,
  members,
  isDm,
  steersStory,
  kind,
  onKindChange,
  input,
  setInput,
  sending,
  inputBlocked,
  placeholder,
  onSubmit,
}: {
  messages: ReadonlyArray<CampaignMessage>;
  rolls: ReadonlyArray<StoredRoll>;
  sheets: ReadonlyArray<CharacterSheet>;
  members: ReadonlyArray<CampaignMember>;
  isDm: boolean;
  steersStory: boolean;
  kind: InputKind;
  onKindChange: (kind: InputKind) => void;
  input: string;
  setInput: (value: string) => void;
  sending: boolean;
  inputBlocked: boolean;
  placeholder: string;
  onSubmit: (event: FormEvent) => void;
}) {
  const rollsById = useMemo(() => new Map(rolls.map((roll) => [roll.id, roll])), [rolls]);
  const recent = useMemo(
    () => messages.filter((message) => message.authorType !== "system" || !message.dmTurnId).slice(-CHRONICLE_ENTRIES),
    [messages],
  );
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [recent.length]);
  const nameOf = (message: CampaignMessage) =>
    sheets.find((sheet) => sheet.id === message.characterId)?.name ??
    sheets.find((sheet) => sheet.userId === message.userId)?.name ??
    members.find((member) => member.userId === message.userId)?.username ??
    "Someone";
  const modes: InputKind[] = isDm ? ["narrate", "ooc"] : ["do", "say", "ooc", ...(steersStory ? (["lead"] as InputKind[]) : [])];
  const modeLabel: Record<string, string> = { do: "Do", say: "Say", ooc: "OOC", lead: "Direct", narrate: "Narrate" };
  // The drop cap goes to the first passage on the scroll, like a page.
  const firstPassageId = recent.find((message) => message.authorType === "dm")?.id;
  return (
    <aside className="cine-chronicle" aria-label="The chronicle">
      <span className="cine-chronicle-roller" aria-hidden="true" />
      <div className="cine-chronicle-page">
        <span className="cine-chronicle-eyebrow">The chronicle</span>
        <div ref={logRef} className="cine-chronicle-log">
          {recent.length === 0 ? <p className="cine-chronicle-quiet">The tale has not begun.</p> : null}
          {recent.map((message) => {
            if (message.authorType === "dm") {
              const parts = message.content.split(ROLL_MARKER);
              const dropcap = message.id === firstPassageId;
              return (
                <div key={message.id} className="cine-chronicle-passage">
                  {parts.map((part, index) => {
                    if (index % 2 === 1) {
                      const roll = rollsById.get(part);
                      return roll ? <ChronicleRoll key={`${message.id}-${index}`} roll={roll} sheets={sheets} /> : null;
                    }
                    const text = clipRecap(part, 900);
                    if (!text) return null;
                    return (
                      <p key={`${message.id}-${index}`} className="cine-chronicle-text">
                        {dropcap && index === 0 ? <span className="cine-chronicle-cap">{text.charAt(0)}</span> : null}
                        {dropcap && index === 0 ? text.slice(1) : text}
                      </p>
                    );
                  })}
                </div>
              );
            }
            if (message.authorType === "player") {
              return (
                <p key={message.id} className="cine-chronicle-line">
                  {nameOf(message)}: &ldquo;{message.content.trim()}&rdquo;
                </p>
              );
            }
            return (
              <p key={message.id} className="cine-chronicle-system">
                {clipRecap(message.content, 200)}
              </p>
            );
          })}
        </div>
        <form onSubmit={onSubmit} className="cine-chronicle-desk">
          <div className="cine-chronicle-modes" data-pill-group="" role="group" aria-label="How you speak">
            {modes.map((option) => (
              <button
                key={option}
                type="button"
                data-on={kind === option ? "" : undefined}
                data-mode={option}
                onClick={() => onKindChange(option)}
                className="cine-chronicle-mode"
              >
                <GameIcon icon={{ kind: "glyph", key: MODE_GLYPHS[option] }} size="size-5" />
                {modeLabel[option] ?? option}
              </button>
            ))}
          </div>
          <div className="cine-chronicle-well">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onSubmit(event);
                }
              }}
              rows={2}
              disabled={inputBlocked}
              placeholder={placeholder}
              aria-label="Your move"
              className="cine-chronicle-input"
            />
            <button type="submit" disabled={sending || !input.trim() || inputBlocked} className="cine-chronicle-send" aria-label="Send">
              Send <span aria-hidden="true">&#10230;</span>
            </button>
          </div>
        </form>
      </div>
      <span className="cine-chronicle-roller" aria-hidden="true" />
    </aside>
  );
}

function ChronicleRoll({ roll, sheets }: { roll: StoredRoll; sheets: ReadonlyArray<CharacterSheet> }) {
  const who = roll.characterId ? sheets.find((sheet) => sheet.id === roll.characterId)?.name : null;
  const crit = roll.breakdown?.crit;
  const label = ROLL_LABELS[roll.kind] || "Roll";
  // The detail the engine writes already names the roller ("Sera: Fire Bolt
  // vs Husk 1"), so the name is only added when there is no detail.
  const detail = roll.detail?.trim();
  const what = detail || (who ? `${who} · ${label}` : label);
  const verdict =
    crit === "nat20" ? "Natural 20" : crit === "nat1" ? "Natural 1" : roll.success === null ? label : roll.success ? (roll.kind === "attack" ? "Hit" : "Success") : roll.kind === "attack" ? "Miss" : "Failed";
  return (
    <span className="cine-chronicle-roll" data-crit={crit ?? undefined}>
      <span className="cine-chronicle-roll-head">{verdict}</span>
      <span className="cine-chronicle-roll-math">
        {what} · {roll.expression} = {roll.total}
      </span>
    </span>
  );
}
