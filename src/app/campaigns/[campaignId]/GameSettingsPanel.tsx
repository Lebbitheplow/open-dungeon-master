"use client";

import { Bot, Dices, Globe, Hand, Heart, Map, Music, PackageCheck, Sparkles, UserPlus, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { STAGES, isStageEnabled } from "@/lib/dm/stages";
import {
  DELEGATIONS,
  DELEGATION_HINTS,
  DELEGATION_LABELS,
} from "@/lib/dm/delegation";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfoButton } from "@/components/ui/InfoDialog";
import { GENRE_PRESETS, genrePreset } from "@/lib/genres";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { TTS_VOICES } from "@/lib/tts-voices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import {
  CAMPAIGN_LENGTH_LABELS,
  CAMPAIGN_LENGTHS,
  COMPANION_LABELS,
  type CampaignLengthSetting,
  type DicePolicy,
  type GameSettings,
  type Genre,
} from "@/lib/schemas/game-settings";

// The Living World explainer, shared with the campaign creator's info
// button so the two never drift.
export const LIVING_WORLD_INFO = [
  "On: the world moves without you. Off-screen storylines advance on background dice each turn, so rival factions, threats, and distant events keep developing while you play.",
  "NPCs pursue their own goals between chapters and during rests and travel. Schemes progress, pressure builds, and rivals can collide with each other.",
  "The DM quietly records what happened off-screen and weaves it into future scenes, ambushes, and rumors. These simulation notes are DM-only until the party discovers them in play.",
  "Off: all of that pauses. The world changes only when your party acts or the story arc calls for it. Your main story arc, chapters, quests, and XP work exactly the same either way.",
  "You can switch this at any time. Turning it back on resumes from the world as it currently stands.",
].join("\n\n");

// The same explainers as this panel's tooltips, shared with the campaign
// creator's info buttons so the two surfaces never drift apart.
export const BONDS_INFO = [
  "How each NPC and AI companion feels about each character, tracked by the server on one meter from hostile through neutral to devoted.",
  "Deeds move it, and the same deed lands differently on different people: mercy wins over a kind healer and irritates a hard-bitten mercenary.",
  "Standing shows in the Bonds tab and colors how the DM plays them. Off: the DM tracks no personal standing and NPCs react to the party as a whole.",
].join("\n\n");

export const ROMANCE_INFO = [
  "The romance ladder on top of the bond meter: interested, courting, together, betrothed, married.",
  "Nobody can be romanced who does not already like the character, players always make the first move, and intimate scenes always fade to black.",
  "Requires Bonds to be on.",
].join("\n\n");

export const NARRATION_GUARD_INFO = [
  "After each turn the server compares the DM's narration against what the dice and tools actually resolved: a hit written on a miss, a death the hit points deny, a damage number no die rolled.",
  "A contradiction is sent back to the DM once for a rewrite. Nothing on any sheet changes either way.",
  "Off costs nothing but the check, and the narration is persisted exactly as written.",
].join("\n\n");

// Lobby game-settings section: the party lead edits live (PATCHes propagate to
// everyone over SSE); other players see a read-only summary.
export function GameSettingsPanel({
  campaignId,
  settings,
  steersStory,
}: {
  campaignId: string;
  settings: GameSettings;
  steersStory: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // Every control here renders the server's settings, so a refused PATCH
  // changes nothing on screen; without this line it changes nothing silently.
  const [error, setError] = useState("");
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  // Whether any ambience audio is actually on disk. The library ships empty
  // (public/ambience is gitignored and filled by npm run fetch-ambience), so
  // a lead can switch ambience on and hear nothing with no clue why; this
  // powers the hint on the Ambience row. Defaults to true so the hint never
  // flashes on installs that are fine while the answer is in flight.
  const [ambienceInstalled, setAmbienceInstalled] = useState(true);

  // Installed world packs, so the lead can switch worlds after creation. An
  // empty list simply hides the row.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/worlds")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .then((data) => {
        if (!cancelled) {
          setPacks(Array.isArray(data.packs) ? data.packs : []);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Asked lazily like the world packs above, and only when the answer could
  // matter: the hint renders for the lead with ambience switched on, so
  // nobody else pays for the request.
  useEffect(() => {
    if (!steersStory || !settings.ambienceEnabled) {
      return;
    }
    let cancelled = false;
    void fetch("/api/ambience")
      .then((response) => (response.ok ? response.json() : { tracks: {} }))
      .then((data) => {
        if (!cancelled) {
          setAmbienceInstalled(Object.keys(data.tracks ?? {}).length > 0);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [steersStory, settings.ambienceEnabled]);

  async function patch(update: Partial<GameSettings>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That change was not saved.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const preset = genrePreset(settings.genre);
  const selectedPack = packs.find((entry) => entry.id === settings.worldPack) ?? null;
  // A table running its own game keeps the rules engine, the dice, the maps
  // and the bonds. What it does not keep is a second author, so the settings
  // that exist only to steer one are hidden rather than shown switched off
  // with no explanation.
  const aiNarrates = settings.dmMode !== "human";
  const selectClass =
    "rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600";

  if (!steersStory) {
    return (
      <section className="mb-6 rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-2 text-sm font-medium text-stone-300">Game settings</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-400">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-amber-200" />
            {selectedPack?.name ?? preset.name}
            {settings.dmMode === "human" ? " · human DM" : ""}
            {settings.dmMode !== "human" && settings.aiStorySetup ? " · AI story setup" : ""}
            {settings.dmMode !== "human"
              ? ` · ${CAMPAIGN_LENGTH_LABELS[settings.campaignLength].split(" (")[0]} campaign`
              : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <Dices className="size-3.5 text-amber-200" />
            {settings.dicePolicy === "real_allowed" ? "Real dice allowed" : "Digital dice only"}
          </span>
          <span className="flex items-center gap-1.5">
            <Volume2 className="size-3.5 text-amber-200" />
            {settings.ttsEnabled
              ? `Narration on (${TTS_VOICES.find((voice) => voice.id === settings.ttsVoice)?.label ?? settings.ttsVoice})`
              : "Narration off"}
          </span>
          <span className="flex items-center gap-1.5">
            <Music className="size-3.5 text-amber-200" />
            {settings.ambienceEnabled
              ? `Ambience on${settings.ambienceAuto ? " (follows the scene)" : ""}`
              : "Ambience off"}
          </span>
          <span className="flex items-center gap-1.5">
            <Map className="size-3.5 text-amber-200" />
            {settings.mapsEnabled ? "Maps on" : "Maps off"}
          </span>
          <span className="flex items-center gap-1.5">
            <Dices className="size-3.5 text-amber-200" />
            {settings.multiclassingEnabled ? "Multiclassing allowed" : "Multiclassing off"}
          </span>
          <span className="flex items-center gap-1.5">
            <UserPlus className="size-3.5 text-amber-200" />
            {settings.midGameJoinOpen ? "Mid-game joining open" : "Mid-game joining closed"}
          </span>
          <span className="flex items-center gap-1.5">
            <Hand className="size-3.5 text-amber-200" />
            {settings.holdSubmissions ? "Lead opens responses each turn" : "Responses always open"}
          </span>
          <span className="flex items-center gap-1.5">
            <Globe className="size-3.5 text-amber-200" />
            {settings.worldSimulation ? "Living world on" : "Living world off"}
          </span>
          <span className="flex items-center gap-1.5">
            <PackageCheck className="size-3.5 text-amber-200" />
            {settings.inventoryApprovals ? "Item offers need approval" : "Item changes auto-apply"}
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="size-3.5 text-amber-200" />
            {settings.relationships === "off"
              ? "Bonds off"
              : settings.romance !== "off"
                ? "Bonds and romance tracked"
                : "Bonds tracked, romance off"}
          </span>
          <span className="flex items-center gap-1.5">
            <Bot className="size-3.5 text-amber-200" />
            AI companions: {COMPANION_LABELS[settings.companions]}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-stone-800 bg-stone-950/60 p-4">
      <h2 className="mb-3 text-sm font-medium text-stone-300">Game settings</h2>
      {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
      <div className={cn("space-y-3 text-xs", busy && "opacity-70")}>
        {settings.dmMode === "assisted" ? (
          // Only in the middle setting. A table the AI runs has nothing to
          // delegate and a table running itself has chosen not to, so showing
          // three switched-off switches in either would be noise.
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-stone-500">AI helps</span>
            {DELEGATIONS.map((which) => (
              <Tooltip key={which} content={DELEGATION_HINTS[which]}>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      dmAssist: { ...settings.dmAssist, [which]: !settings.dmAssist[which] },
                    })
                  }
                  className={cn(
                    "rounded-md border px-2 py-1",
                    settings.dmAssist[which]
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-400",
                  )}
                >
                  {DELEGATION_LABELS[which]}
                </button>
              </Tooltip>
            ))}
          </div>
        ) : null}
        {packs.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-stone-500">World</span>
            <select
              value={settings.worldPack}
              onChange={(event) => {
                const next = packs.find((entry) => entry.id === event.target.value);
                // Genre moves with the pack, so a campaign never ends up in a
                // world whose base genre contradicts it.
                patch(next ? { worldPack: next.id, genre: next.baseGenre } : { worldPack: "" });
              }}
              className={selectClass}
            >
              <option value="">No pack (plain setting)</option>
              {packs.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <span className="text-stone-500">
              {selectedPack
                ? selectedPack.inspiredBy
                : "Pick a pre-built universe to rename races, classes, spells and monsters to fit it."}
            </span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Setting</span>
          <select
            value={settings.genre}
            onChange={(event) =>
              // Changing the genre by hand drops the pack, for the same reason
              // the creation dialog does: a pack IS its baseGenre plus
              // overrides, so the two must never disagree.
              patch({ genre: event.target.value as Genre, ...(settings.worldPack ? { worldPack: "" } : {}) })
            }
            className={selectClass}
          >
            {GENRE_PRESETS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <span className="text-stone-500">{preset.blurb}</span>
        </div>
        {settings.genre === "custom" ? (
          <div className="flex items-start gap-2">
            <span className="w-16 shrink-0 pt-1 text-stone-500">World</span>
            <textarea
              defaultValue={settings.customGenreText}
              rows={2}
              maxLength={500}
              onBlur={(event) => patch({ customGenreText: event.target.value })}
              placeholder="Describe the world and tone..."
              className="flex-1 rounded-md border border-stone-700 bg-stone-900 px-2 py-1 outline-none focus:border-amber-600"
            />
          </div>
        ) : null}
        {aiNarrates ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Length</span>
          <Tooltip content="How far the DM plans the story ahead (acts, bosses, side quests). Changing it mid-campaign applies when the next saga is planned; any length continues with a sequel saga if you play past the finale.">
            <select
              value={settings.campaignLength}
              onChange={(event) =>
                patch({ campaignLength: event.target.value as CampaignLengthSetting })
              }
              className={selectClass}
            >
              {CAMPAIGN_LENGTHS.map((value) => (
                <option key={value} value={value}>
                  {CAMPAIGN_LENGTH_LABELS[value]}
                </option>
              ))}
            </select>
          </Tooltip>
        </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Dice</span>
          <Tooltip content="Real dice lets each player opt in to rolling at their table: the game parks until they type the result, read it from a paired Pixels Bluetooth die, or let the server roll per die (Dice sources, in the Party tab).">
            <select
              value={settings.dicePolicy}
              onChange={(event) => patch({ dicePolicy: event.target.value as DicePolicy })}
              className={selectClass}
              aria-label="Dice policy"
            >
              <option value="digital_only">Digital only</option>
              <option value="real_allowed">Real dice allowed</option>
            </select>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Narration</span>
          <button
            type="button"
            onClick={() => patch({ ttsEnabled: !settings.ttsEnabled })}
            className={cn(
              "rounded-md border px-2 py-1",
              settings.ttsEnabled
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            {settings.ttsEnabled ? "On" : "Off"}
          </button>
          {settings.ttsEnabled ? (
            <>
              <select
                value={settings.ttsVoice}
                onChange={(event) => patch({ ttsVoice: event.target.value })}
                className={selectClass}
              >
                {TTS_VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
              <VoicePreviewButton voice={settings.ttsVoice} />
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Ambience</span>
          <button
            type="button"
            onClick={() => patch({ ambienceEnabled: !settings.ambienceEnabled })}
            className={cn(
              "rounded-md border px-2 py-1",
              settings.ambienceEnabled
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            {settings.ambienceEnabled ? "On" : "Off"}
          </button>
          {settings.ambienceEnabled ? (
            <Tooltip content="Pick a bed from each new place and switch to combat music when a fight starts. Off leaves every change to the DM.">
              <button
                type="button"
                onClick={() => patch({ ambienceAuto: !settings.ambienceAuto })}
                className={cn(
                  "rounded-md border px-2 py-1",
                  settings.ambienceAuto
                    ? "border-amber-700 bg-amber-950/50 text-amber-200"
                    : "border-stone-700 text-stone-400",
                )}
              >
                {settings.ambienceAuto ? "Follows the scene" : "DM sets it"}
              </button>
            </Tooltip>
          ) : null}
          {settings.ambienceEnabled && !ambienceInstalled ? (
            // The catalog knows the cues but no audio is on disk, so the
            // toggle above is currently a promise of silence. Say so where
            // it is being switched on rather than letting the table wonder.
            <span className="text-stone-500">
              No ambience audio is installed yet, so this plays silence. Run npm run fetch-ambience
              on the server; setting a FREESOUND_API_KEY first widens the sources.
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Extras</span>
          {aiNarrates ? (
            <button
              type="button"
              onClick={() => patch({ aiStorySetup: !settings.aiStorySetup })}
            className={cn(
              "rounded-md border px-2 py-1",
              settings.aiStorySetup
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
              AI story setup {settings.aiStorySetup ? "on" : "off"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => patch({ mapsEnabled: !settings.mapsEnabled })}
            className={cn(
              "rounded-md border px-2 py-1",
              settings.mapsEnabled
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            Maps {settings.mapsEnabled ? "on" : "off"}
          </button>
          <Tooltip content="Let characters take levels in a second or third class at level-up (5e multiclassing, prerequisites enforced)">
            <button
              type="button"
              onClick={() => patch({ multiclassingEnabled: !settings.multiclassingEnabled })}
              className={cn(
                "rounded-md border px-2 py-1",
                settings.multiclassingEnabled
                  ? "border-amber-700 bg-amber-950/50 text-amber-200"
                  : "border-stone-700 text-stone-400",
              )}
            >
              Multiclassing {settings.multiclassingEnabled ? "on" : "off"}
            </button>
          </Tooltip>
          <Tooltip content="Allow new players to join with the invite code after the adventure starts">
            <button
              type="button"
              onClick={() => patch({ midGameJoinOpen: !settings.midGameJoinOpen })}
              className={cn(
                "rounded-md border px-2 py-1",
                settings.midGameJoinOpen
                  ? "border-amber-700 bg-amber-950/50 text-amber-200"
                  : "border-stone-700 text-stone-400",
              )}
            >
              Mid-game joining {settings.midGameJoinOpen ? "open" : "closed"}
            </button>
          </Tooltip>
          <Tooltip content="After each DM narration, players cannot act until you allow responses. OOC stays open.">
            <button
              type="button"
              onClick={() => patch({ holdSubmissions: !settings.holdSubmissions })}
              className={cn(
                "rounded-md border px-2 py-1",
                settings.holdSubmissions
                  ? "border-amber-700 bg-amber-950/50 text-amber-200"
                  : "border-stone-700 text-stone-400",
              )}
            >
              Held responses {settings.holdSubmissions ? "on" : "off"}
            </button>
          </Tooltip>
        </div>
        {settings.dmMode !== "ai" ? (
          // Only the DM seat is ever nudged, so this row does not exist for a
          // table the AI narrates: there, the story is typed by definition.
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-stone-500">Remind</span>
            <Tooltip content="How much play may pass with nothing written down before the console nudges you to record what happened. Your own typed narration counts, so a DM who writes their scenes is never nudged.">
              <select
                value={settings.beatReminder.messages}
                onChange={(event) =>
                  patch({
                    beatReminder: {
                      ...settings.beatReminder,
                      messages: Number(event.target.value),
                    },
                  })
                }
                className={selectClass}
              >
                {[0, 5, 10, 20, 40].map((count) => (
                  <option key={count} value={count}>
                    {count === 0 ? "never by actions" : `after ${count} actions`}
                  </option>
                ))}
              </select>
            </Tooltip>
            <select
              value={settings.beatReminder.rolls}
              onChange={(event) =>
                patch({
                  beatReminder: {
                    ...settings.beatReminder,
                    rolls: Number(event.target.value),
                  },
                })
              }
              className={selectClass}
              title="The combat tempo: twelve rolls is roughly two rounds of a four-person fight."
            >
              {[0, 6, 12, 24, 48].map((count) => (
                <option key={count} value={count}>
                  {count === 0 ? "never by rolls" : `after ${count} rolls`}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {aiNarrates ? (
        <div className="flex flex-wrap items-start gap-2">
          <span className="w-16 shrink-0 pt-1 text-stone-500">Stages</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {STAGES.map((stage) => {
              const on = isStageEnabled(settings.stages, stage.id);
              return (
                <Tooltip
                  key={stage.id}
                  content={`${stage.description} ${stage.cost}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      patch({ stages: { ...settings.stages, [stage.id]: !on } })
                    }
                    className={cn(
                      "rounded-md border px-2 py-1",
                      on
                        ? "border-amber-700 bg-amber-950/50 text-amber-200"
                        : "border-stone-700 text-stone-400",
                    )}
                  >
                    {stage.label} {on ? "on" : "off"}
                    {/* Only a model-call stage buys back GPU time; saying so
                        stops an operator disabling recall expecting a speedup. */}
                    <span className="ml-1 text-[10px] text-stone-500">
                      {stage.callsModel ? "model" : "engine"}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
        ) : null}
        {aiNarrates ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">World</span>
          <Tooltip content="The world moves on its own: off-screen storylines advance on background dice, surprises and encounters build up over quiet stretches, and NPC schemes progress between chapters and during rests and travel. The story arc itself is unaffected either way.">
            <button
              type="button"
              onClick={() => patch({ worldSimulation: !settings.worldSimulation })}
              className={cn(
                "rounded-md border px-2 py-1",
                settings.worldSimulation
                  ? "border-amber-700 bg-amber-950/50 text-amber-200"
                  : "border-stone-700 text-stone-400",
              )}
            >
              Living world {settings.worldSimulation ? "on" : "off"}
            </button>
          </Tooltip>
          <InfoButton label="What does Living World do?" text={LIVING_WORLD_INFO} />
          <span className="text-stone-500">
            {settings.worldSimulation
              ? "Rumors, surprises, and off-screen schemes advance between turns."
              : "Nothing happens unless the party or the story arc makes it happen."}
          </span>
        </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Items</span>
          <Tooltip content="When on, DM-granted loot, item removals, and gold changes become offers the owning player accepts or declines before they land on the sheet. Damage, healing, XP, and conditions still apply normally.">
            <button
              type="button"
              onClick={() => patch({ inventoryApprovals: !settings.inventoryApprovals })}
              className={cn(
                "rounded-md border px-2 py-1",
                settings.inventoryApprovals
                  ? "border-amber-700 bg-amber-950/50 text-amber-200"
                  : "border-stone-700 text-stone-400",
              )}
            >
              Item offers {settings.inventoryApprovals ? "on" : "off"}
            </button>
          </Tooltip>
          <span className="text-stone-500">
            {settings.inventoryApprovals
              ? "Players confirm DM item and gold changes before they apply."
              : "DM item and gold changes apply immediately (lead can undo)."}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Prose</span>
          <Tooltip content="After each turn the server compares the DM's narration against what the dice and tools actually resolved: a hit written on a miss, a death the hit points deny, a damage number no die rolled. A contradiction is sent back to the DM once for a rewrite. Nothing on any sheet changes either way.">
            {aiNarrates ? (
              <button
                type="button"
                onClick={() => patch({ narrationGuard: !settings.narrationGuard })}
              className={cn(
                "rounded-md border px-2 py-1",
                settings.narrationGuard
                  ? "border-amber-700 bg-amber-950/50 text-amber-200"
                  : "border-stone-700 text-stone-400",
              )}
            >
                Outcome check {settings.narrationGuard ? "on" : "off"}
              </button>
            ) : null}
          </Tooltip>
          <span className="text-stone-500">
            {settings.narrationGuard
              ? "Narration that contradicts the dice goes back for one rewrite."
              : "The DM's narration is persisted exactly as written."}
          </span>
        </div>
        {/* Live voice chat. The rules below are a list rather than a single
            proximity checkbox on purpose: "players only hear people within 30
            feet" is one table's house rule, and the next table will want a
            different one. They are all inputs to one function
            (src/lib/voice/audibility.ts). */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Voice</span>
          <Tooltip content="Live voice chat for this table, in the lobby and during play. The server also has its own switch, and needs a media port open; if voice is off server-wide this has no effect.">
            <button
              type="button"
              onClick={() =>
                patch({ voice: { ...settings.voice, enabled: !settings.voice.enabled } })
              }
              className={cn(
                "rounded-md border px-2 py-1",
                settings.voice.enabled
                  ? "border-amber-700 bg-amber-950/50 text-amber-200"
                  : "border-stone-700 text-stone-400",
              )}
            >
              Voice chat {settings.voice.enabled ? "on" : "off"}
            </button>
          </Tooltip>
          {settings.voice.enabled ? (
            <>
              <Tooltip content="How hard the floor is enforced on microphones. Soft shows whose turn it is without muting anyone. Strict pauses a player's microphone on the server, so the mute is real rather than a greyed-out button. Off ignores the floor entirely. The DM is never muted by any of these.">
                <select
                  value={settings.voice.turnEnforcement}
                  onChange={(event) =>
                    patch({
                      voice: {
                        ...settings.voice,
                        turnEnforcement: event.target.value as "off" | "soft" | "strict",
                      },
                    })
                  }
                  className={selectClass}
                >
                  <option value="off">Turns: ignored</option>
                  <option value="soft">Turns: shown</option>
                  <option value="strict">Turns: enforced</option>
                </select>
              </Tooltip>
              <Tooltip content="Distance decides who hears whom, using the battle map. Outside combat, or with no map, everyone hears everyone as usual. The DM always hears everyone and is always heard.">
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      voice: {
                        ...settings.voice,
                        rules: { ...settings.voice.rules, proximity: !settings.voice.rules.proximity },
                      },
                    })
                  }
                  className={cn(
                    "rounded-md border px-2 py-1",
                    settings.voice.rules.proximity
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-400",
                  )}
                >
                  Proximity {settings.voice.rules.proximity ? "on" : "off"}
                </button>
              </Tooltip>
              {settings.voice.rules.proximity ? (
                <>
                  <select
                    value={settings.voice.rules.hearingRangeFeet}
                    onChange={(event) =>
                      patch({
                        voice: {
                          ...settings.voice,
                          rules: {
                            ...settings.voice.rules,
                            hearingRangeFeet: Number(event.target.value),
                          },
                        },
                      })
                    }
                    className={selectClass}
                    aria-label="How far a normal speaking voice carries"
                    title="How far a normal speaking voice carries"
                  >
                    {[15, 30, 60, 120].map((feet) => (
                      <option key={feet} value={feet}>
                        {feet} ft
                      </option>
                    ))}
                  </select>
                  <Tooltip content="Lets each player pick whisper (5 ft), normal, or shout (120 ft). The range is the speaker's, because shouting is something you do rather than something done to you.">
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          voice: {
                            ...settings.voice,
                            rules: { ...settings.voice.rules, sayRange: !settings.voice.rules.sayRange },
                          },
                        })
                      }
                      className={cn(
                        "rounded-md border px-2 py-1",
                        settings.voice.rules.sayRange
                          ? "border-amber-700 bg-amber-950/50 text-amber-200"
                          : "border-stone-700 text-stone-400",
                      )}
                    >
                      Whisper/shout {settings.voice.rules.sayRange ? "on" : "off"}
                    </button>
                  </Tooltip>
                  <Tooltip content="A wall between two characters muffles the voice rather than silencing it. Hearing through a door is a real thing, and audio that vanished at a doorway would read as a bug. Fog of war never gates audio: not seeing someone has nothing to do with hearing them.">
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          voice: {
                            ...settings.voice,
                            rules: {
                              ...settings.voice.rules,
                              wallsAttenuate: !settings.voice.rules.wallsAttenuate,
                            },
                          },
                        })
                      }
                      className={cn(
                        "rounded-md border px-2 py-1",
                        settings.voice.rules.wallsAttenuate
                          ? "border-amber-700 bg-amber-950/50 text-amber-200"
                          : "border-stone-700 text-stone-400",
                      )}
                    >
                      Walls muffle {settings.voice.rules.wallsAttenuate ? "on" : "off"}
                    </button>
                  </Tooltip>
                </>
              ) : null}
              <Tooltip content="A character at 0 hit points stops hearing the table. They still hear the DM, and they are still heard.">
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      voice: {
                        ...settings.voice,
                        rules: {
                          ...settings.voice.rules,
                          downedGoDeaf: !settings.voice.rules.downedGoDeaf,
                        },
                      },
                    })
                  }
                  className={cn(
                    "rounded-md border px-2 py-1",
                    settings.voice.rules.downedGoDeaf
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-400",
                  )}
                >
                  Downed go deaf {settings.voice.rules.downedGoDeaf ? "on" : "off"}
                </button>
              </Tooltip>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Bonds</span>
          <Tooltip content="How each NPC and AI companion feels about each character, tracked by the server on one meter from hostile through neutral to devoted. Deeds move it, and the same deed lands differently on different people: mercy wins over a kind healer and irritates a hard-bitten mercenary. Standing shows in the Bonds tab and colors how the DM plays them.">
            <button
              type="button"
              onClick={() =>
                patch({ relationships: settings.relationships === "off" ? "on" : "off" })
              }
              className={cn(
                "rounded-md border px-2 py-1",
                settings.relationships !== "off"
                  ? "border-amber-700 bg-amber-950/50 text-amber-200"
                  : "border-stone-700 text-stone-400",
              )}
            >
              Bonds {settings.relationships !== "off" ? "on" : "off"}
            </button>
          </Tooltip>
          {settings.relationships !== "off" ? (
            <Tooltip content="The romance ladder on top of the bond meter: interested, courting, together, betrothed, married. Nobody can be romanced who does not already like the character, players always make the first move, and intimate scenes always fade to black.">
              <button
                type="button"
                onClick={() => patch({ romance: settings.romance === "off" ? "on" : "off" })}
                className={cn(
                  "rounded-md border px-2 py-1",
                  settings.romance !== "off"
                    ? "border-amber-700 bg-amber-950/50 text-amber-200"
                    : "border-stone-700 text-stone-400",
                )}
              >
                Romance {settings.romance !== "off" ? "on" : "off"}
              </button>
            </Tooltip>
          ) : null}
          <span className="text-stone-500">
            {settings.relationships === "off"
              ? "The DM tracks no personal standing; NPCs react to the party as a whole."
              : settings.romance !== "off"
                ? "Standing is tracked per character, and romance can grow from it."
                : "Standing is tracked per character; romance is off."}
          </span>
        </div>
        {aiNarrates ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Allies</span>
          <Tooltip content="AI companions the DM plays: 'party members' travel with the party until dismissed; 'guests' are temporary allies for one scene or battle (a town soldier helping defend) and leave automatically when the fight ends. Auto picks full for solo play, guests only for multiplayer.">
            <select
              value={settings.companions}
              onChange={(event) =>
                patch({ companions: event.target.value as GameSettings["companions"] })
              }
              className={selectClass}
            >
              {(Object.keys(COMPANION_LABELS) as Array<GameSettings["companions"]>).map((mode) => (
                <option key={mode} value={mode}>
                  {COMPANION_LABELS[mode]}
                </option>
              ))}
            </select>
          </Tooltip>
          {settings.companions !== "off" ? (
            <>
              {settings.companions !== "guests" ? (
                <select
                  value={settings.maxCompanions}
                  onChange={(event) => patch({ maxCompanions: Number(event.target.value) })}
                  className={selectClass}
                  title="Most lasting party companions allowed at once"
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>
                      max {count} party
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                value={settings.maxGuests}
                onChange={(event) => patch({ maxGuests: Number(event.target.value) })}
                className={selectClass}
                title="Most temporary guest allies allowed at once"
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    max {count} guest{count === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
        ) : null}
      </div>
    </section>
  );
}
