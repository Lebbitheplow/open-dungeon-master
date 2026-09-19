"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { STAGES, isStageEnabled } from "@/lib/dm/stages";
import {
  DELEGATIONS,
  DELEGATION_HINTS,
  DELEGATION_LABELS,
} from "@/lib/dm/delegation";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
import { PanelError, SettingToggle, panelField } from "./PanelKit";
import { InfoButton } from "@/components/ui/InfoDialog";
import { GENRE_PRESETS, genrePreset } from "@/lib/genres";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { WorldPackGallery } from "@/components/WorldPackGallery";
import { TTS_VOICES } from "@/lib/tts-voices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { SafetyToneFields } from "@/components/SafetyToneFields";
import type { GameSettings } from "@/lib/schemas/game-settings";
import {
  CAMPAIGN_LENGTH_LABELS,
  CAMPAIGN_LENGTHS,
  COMPANION_LABELS,
  type CampaignLengthSetting,
  type DicePolicy,
  type Genre,
} from "@/lib/schemas/game-settings-options";

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
  // A select is as wide as its longest option, and a flex item will not
  // shrink below that on its own, so a world pack with a long name used to
  // push the whole panel sideways on a phone. Capped at the row's width and
  // ellipsised instead.
  const selectClass =
    "min-w-0 max-w-full";

  if (!steersStory) {
    return (
      <section className="panel mb-6 rounded-xl p-4">
        <SectionHead title="Game settings" glyph="tab-settings" level="h2" />
        <div className="stagger flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-300">
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-region" }} size="size-5" />
            {selectedPack?.name ?? preset.name}
            {settings.dmMode === "human" ? " · human DM" : ""}
            {settings.dmMode !== "human" && settings.aiStorySetup ? " · AI story setup" : ""}
            {settings.dmMode !== "human"
              ? ` · ${CAMPAIGN_LENGTH_LABELS[settings.campaignLength].split(" (")[0]} campaign`
              : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-dice" }} size="size-5" />
            {settings.dicePolicy === "real_allowed" ? "Real dice allowed" : "Digital dice only"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "cue-bell" }} size="size-5" />
            {settings.ttsEnabled
              ? `Narration on (${TTS_VOICES.find((voice) => voice.id === settings.ttsVoice)?.label ?? settings.ttsVoice})`
              : "Narration off"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-ambience" }} size="size-5" />
            {settings.ambienceEnabled
              ? `Ambience on${settings.ambienceAuto ? " (follows the scene)" : ""}`
              : "Ambience off"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-map" }} size="size-5" />
            {settings.mapsEnabled ? "Maps on" : "Maps off"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-level-up" }} size="size-5" />
            {settings.multiclassingEnabled ? "Multiclassing allowed" : "Multiclassing off"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-friends" }} size="size-5" />
            {settings.midGameJoinOpen ? "Mid-game joining open" : "Mid-game joining closed"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "rest-initiative" }} size="size-5" />
            {settings.holdSubmissions ? "Lead opens responses each turn" : "Responses always open"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-storyboard" }} size="size-5" />
            {settings.worldSimulation ? "Living world on" : "Living world off"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-loot" }} size="size-5" />
            {settings.inventoryApprovals ? "Item offers need approval" : "Item changes auto-apply"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "tab-bonds" }} size="size-5" />
            {settings.relationships === "off"
              ? "Bonds off"
              : settings.romance !== "off"
                ? "Bonds and romance tracked"
                : "Bonds tracked, romance off"}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-party" }} size="size-5" />
            AI companions: {COMPANION_LABELS[settings.companions]}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel mb-6 rounded-xl p-4">
      <SectionHead title="Game settings" glyph="tab-settings" level="h2" />
      {error ? <PanelError className="mb-2">{error}</PanelError> : null}
      <div className={cn("space-y-3 text-xs", busy && "opacity-70")}>
        {settings.dmMode === "assisted" ? (
          // Only in the middle setting. A table the AI runs has nothing to
          // delegate and a table running itself has chosen not to, so showing
          // three switched-off switches in either would be noise.
          <div className="flex flex-wrap items-center gap-2">
            <span className="pk-rowlabel">AI helps</span>
            {DELEGATIONS.map((which) => (
              <Tooltip key={which} content={DELEGATION_HINTS[which]}>
                <SettingToggle on={settings.dmAssist[which]} onToggle={() =>
                    patch({
                      dmAssist: { ...settings.dmAssist, [which]: !settings.dmAssist[which] },
                    })}>
                  {DELEGATION_LABELS[which]}
                </SettingToggle>
              </Tooltip>
            ))}
          </div>
        ) : null}
        {packs.length ? (
          <div className="reveal flex flex-wrap items-center gap-2">
            <span className="pk-rowlabel">World</span>
            <Select
              size="sm"
              label="World pack"
              value={settings.worldPack}
              placeholder="No pack (plain setting)"
              onChange={(value) => {
                const next = packs.find((entry) => entry.id === value);
                // Genre moves with the pack, so a campaign never ends up in a
                // world whose base genre contradicts it.
                patch(next ? { worldPack: next.id, genre: next.baseGenre } : { worldPack: "" });
              }}
              options={[{ value: "", label: "No pack (plain setting)" }, ...packs.map((entry) => ({ value: entry.id, label: entry.name, hint: entry.inspiredBy }))]}
              className={selectClass}
            />
            <span className="text-stone-500">
              {selectedPack
                ? selectedPack.inspiredBy
                : "Pick a pre-built universe to rename races, classes, spells and monsters to fit it."}
            </span>
          </div>
        ) : null}
        {selectedPack?.cover ? (
          <div className="reveal flex flex-wrap items-center gap-2">
            <span className="pk-rowlabel" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedPack.cover}
              alt=""
              className="h-20 w-36 rounded-md border border-amber-500/30 object-cover shadow-[0_2px_8px_rgba(4,2,12,0.5)]"
            />
          </div>
        ) : null}
        {selectedPack ? <WorldPackGallery packId={selectedPack.id} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Setting</span>
          <Select<Genre>
            size="sm"
            label="Setting"
            value={settings.genre}
            onChange={(genre) =>
              // Changing the genre by hand drops the pack, for the same reason
              // the creation dialog does: a pack IS its baseGenre plus
              // overrides, so the two must never disagree.
              patch({ genre, ...(settings.worldPack ? { worldPack: "" } : {}) })
            }
            options={GENRE_PRESETS.map((entry) => ({ value: entry.id as Genre, label: entry.name }))}
            className={selectClass}
          />
          <span className="text-stone-500">{preset.blurb}</span>
        </div>
        {settings.genre === "custom" ? (
          <div className="reveal flex items-start gap-2">
            <span className="pk-rowlabel pt-1">World</span>
            <textarea
              defaultValue={settings.customGenreText}
              rows={2}
              maxLength={500}
              onBlur={(event) => patch({ customGenreText: event.target.value })}
              placeholder="Describe the world and tone..."
              aria-label="Describe the world and tone"
              className={cn(panelField, "w-auto flex-1")}
            />
          </div>
        ) : null}
        {aiNarrates ? (
        <div className="reveal flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Length</span>
          <Tooltip content="How far the DM plans the story ahead (acts, bosses, side quests). Changing it mid-campaign applies when the next saga is planned; any length continues with a sequel saga if you play past the finale.">
            <span className="inline-flex min-w-0 max-w-full">
              <Select<CampaignLengthSetting>
                size="sm"
                label="Campaign length"
                value={settings.campaignLength}
                onChange={(campaignLength) => patch({ campaignLength })}
                options={CAMPAIGN_LENGTHS.map((value) => ({ value, label: CAMPAIGN_LENGTH_LABELS[value] }))}
                className={selectClass}
              />
            </span>
          </Tooltip>
        </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Dice</span>
          <Tooltip content="Real dice lets each player opt in to rolling at their table: the game parks until they type the result, read it from a paired Pixels Bluetooth die, or let the server roll per die (Dice sources, in the Party tab).">
            <span className="inline-flex min-w-0 max-w-full">
              <Select<DicePolicy>
                size="sm"
                label="Dice policy"
                value={settings.dicePolicy}
                onChange={(dicePolicy) => patch({ dicePolicy })}
                options={[
                  { value: "digital_only", label: "Digital only", icon: { kind: "glyph", key: "tab-dice" } },
                  { value: "real_allowed", label: "Real dice allowed", icon: { kind: "glyph", key: "die-d20" } },
                ]}
                className={selectClass}
              />
            </span>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Narration</span>
          <SettingToggle label="Narration" on={settings.ttsEnabled} onToggle={() => patch({ ttsEnabled: !settings.ttsEnabled })}>
            {settings.ttsEnabled ? "On" : "Off"}
          </SettingToggle>
          {settings.ttsEnabled ? (
            <>
              <Select
                size="sm"
                label="Narration voice"
                value={settings.ttsVoice}
                onChange={(ttsVoice) => patch({ ttsVoice })}
                options={TTS_VOICES.map((voice) => ({ value: voice.id as string, label: voice.label }))}
                className={selectClass}
              />
              <VoicePreviewButton voice={settings.ttsVoice} />
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Faces</span>
          <Tooltip content="Theatre inserts: when a passage has someone speaking, their portrait comes up over the scene art while their lines play.">
            <SettingToggle on={settings.presentation === "theatre"} onToggle={() => patch({ presentation: settings.presentation === "theatre" ? "plain" : "theatre" })}>
              {settings.presentation === "theatre" ? "Theatre inserts on" : "Theatre inserts off"}
            </SettingToggle>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Ambience</span>
          <SettingToggle label="Ambience" on={settings.ambienceEnabled} onToggle={() => patch({ ambienceEnabled: !settings.ambienceEnabled })}>
            {settings.ambienceEnabled ? "On" : "Off"}
          </SettingToggle>
          {settings.ambienceEnabled ? (
            <Tooltip content="Pick a bed from each new place and switch to combat music when a fight starts. Off leaves every change to the DM.">
              <SettingToggle on={settings.ambienceAuto} onToggle={() => patch({ ambienceAuto: !settings.ambienceAuto })}>
                {settings.ambienceAuto ? "Follows the scene" : "DM sets it"}
              </SettingToggle>
            </Tooltip>
          ) : null}
          <Tooltip content="Players may draw on the live board: a plan of attack, a circle round a door. The DM always may.">
            <SettingToggle on={settings.boardDrawing} onToggle={() => patch({ boardDrawing: !settings.boardDrawing })}>
              {settings.boardDrawing ? "Players may draw" : "Only the DM draws"}
            </SettingToggle>
          </Tooltip>
          <Tooltip content="Show what enemies look likely to do next">
            <SettingToggle on={settings.enemyIntent} onToggle={() => patch({ enemyIntent: !settings.enemyIntent })}>
              Enemy intent {settings.enemyIntent ? "on" : "off"}
            </SettingToggle>
          </Tooltip>
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
          <span className="pk-rowlabel">Extras</span>
          {aiNarrates ? (
            <SettingToggle on={settings.aiStorySetup} onToggle={() => patch({ aiStorySetup: !settings.aiStorySetup })}>
              AI story setup {settings.aiStorySetup ? "on" : "off"}
            </SettingToggle>
          ) : null}
          <SettingToggle on={settings.mapsEnabled} onToggle={() => patch({ mapsEnabled: !settings.mapsEnabled })}>
            Maps {settings.mapsEnabled ? "on" : "off"}
          </SettingToggle>
          <Tooltip content="Let characters take levels in a second or third class at level-up (5e multiclassing, prerequisites enforced)">
            <SettingToggle on={settings.multiclassingEnabled} onToggle={() => patch({ multiclassingEnabled: !settings.multiclassingEnabled })}>
              Multiclassing {settings.multiclassingEnabled ? "on" : "off"}
            </SettingToggle>
          </Tooltip>
          <Tooltip content="Allow new players to join with the invite code after the adventure starts">
            <SettingToggle on={settings.midGameJoinOpen} onToggle={() => patch({ midGameJoinOpen: !settings.midGameJoinOpen })}>
              Mid-game joining {settings.midGameJoinOpen ? "open" : "closed"}
            </SettingToggle>
          </Tooltip>
          <Tooltip content="After each DM narration, players cannot act until you allow responses. OOC stays open.">
            <SettingToggle on={settings.holdSubmissions} onToggle={() => patch({ holdSubmissions: !settings.holdSubmissions })}>
              Held responses {settings.holdSubmissions ? "on" : "off"}
            </SettingToggle>
          </Tooltip>
        </div>
        {settings.dmMode !== "ai" ? (
          // Only the DM seat is ever nudged, so this row does not exist for a
          // table the AI narrates: there, the story is typed by definition.
          <div className="flex flex-wrap items-center gap-2">
            <span className="pk-rowlabel">Remind</span>
            <Tooltip content="How much play may pass with nothing written down before the console nudges you to record what happened. Your own typed narration counts, so a DM who writes their scenes is never nudged.">
              <span className="inline-flex min-w-0 max-w-full">
                <Select
                  size="sm"
                  label="Remind after this many actions"
                  value={String(settings.beatReminder.messages)}
                  onChange={(value) => patch({ beatReminder: { ...settings.beatReminder, messages: Number(value) } })}
                  options={[0, 5, 10, 20, 40].map((count) => ({ value: String(count), label: count === 0 ? "never by actions" : `after ${count} actions` }))}
                  className={selectClass}
                />
              </span>
            </Tooltip>
            <span className="inline-flex min-w-0 max-w-full" title="The combat tempo: twelve rolls is roughly two rounds of a four-person fight.">
              <Select
                size="sm"
                label="Remind after this many rolls"
                value={String(settings.beatReminder.rolls)}
                onChange={(value) => patch({ beatReminder: { ...settings.beatReminder, rolls: Number(value) } })}
                options={[0, 6, 12, 24, 48].map((count) => ({ value: String(count), label: count === 0 ? "never by rolls" : `after ${count} rolls` }))}
                className={selectClass}
              />
            </span>
          </div>
        ) : null}
        {aiNarrates ? (
        <div className="reveal flex flex-wrap items-start gap-2">
          <span className="pk-rowlabel pt-1">Stages</span>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {STAGES.map((stage) => {
              const on = isStageEnabled(settings.stages, stage.id);
              return (
                <Tooltip
                  key={stage.id}
                  content={`${stage.description} ${stage.cost}`}
                >
                  <SettingToggle on={on} onToggle={() =>
                      patch({ stages: { ...settings.stages, [stage.id]: !on } })}>
                    {stage.label} {on ? "on" : "off"}
                    {/* Only a model-call stage buys back GPU time; saying so
                        stops an operator disabling recall expecting a speedup. */}
                    <span className="ml-1 text-[11px] text-stone-500">
                      {stage.callsModel ? "model" : "engine"}
                    </span>
                  </SettingToggle>
                </Tooltip>
              );
            })}
          </div>
        </div>
        ) : null}
        {aiNarrates ? (
        <div className="reveal flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">World</span>
          <Tooltip content="The world moves on its own: off-screen storylines advance on background dice, surprises and encounters build up over quiet stretches, and NPC schemes progress between chapters and during rests and travel. The story arc itself is unaffected either way.">
            <SettingToggle on={settings.worldSimulation} onToggle={() => patch({ worldSimulation: !settings.worldSimulation })}>
              Living world {settings.worldSimulation ? "on" : "off"}
            </SettingToggle>
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
          <span className="pk-rowlabel">Items</span>
          <Tooltip content="When on, DM-granted loot, item removals, and gold changes become offers the owning player accepts or declines before they land on the sheet. Damage, healing, XP, and conditions still apply normally.">
            <SettingToggle on={settings.inventoryApprovals} onToggle={() => patch({ inventoryApprovals: !settings.inventoryApprovals })}>
              Item offers {settings.inventoryApprovals ? "on" : "off"}
            </SettingToggle>
          </Tooltip>
          <span className="text-stone-500">
            {settings.inventoryApprovals
              ? "Players confirm DM item and gold changes before they apply."
              : "DM item and gold changes apply immediately (lead can undo)."}
          </span>
        </div>
        <div className="rounded-lg border border-amber-500/15 bg-stone-950/40 p-2.5">
          <SafetyToneFields
            safety={settings.safety}
            gm={settings.gm}
            ttsVoice={settings.ttsVoice}
            onSafety={(safety) => patch({ safety })}
            onGm={(gm) => patch({ gm })}
            onVoice={(ttsVoice) => patch({ ttsVoice })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Prose</span>
          <Tooltip content="After each turn the server compares the DM's narration against what the dice and tools actually resolved: a hit written on a miss, a death the hit points deny, a damage number no die rolled. A contradiction is sent back to the DM once for a rewrite. Nothing on any sheet changes either way.">
            {aiNarrates ? (
              <SettingToggle on={settings.narrationGuard} onToggle={() => patch({ narrationGuard: !settings.narrationGuard })}>
                Outcome check {settings.narrationGuard ? "on" : "off"}
              </SettingToggle>
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
          <span className="pk-rowlabel">Voice</span>
          <Tooltip content="Live voice chat for this table, in the lobby and during play. The server also has its own switch, and needs a media port open; if voice is off server-wide this has no effect.">
            <SettingToggle on={settings.voice.enabled} onToggle={() =>
                patch({ voice: { ...settings.voice, enabled: !settings.voice.enabled } })}>
              Voice chat {settings.voice.enabled ? "on" : "off"}
            </SettingToggle>
          </Tooltip>
          {settings.voice.enabled ? (
            <>
              <Tooltip content="How hard the floor is enforced on microphones. Soft shows whose turn it is without muting anyone. Strict pauses a player's microphone on the server, so the mute is real rather than a greyed-out button. Off ignores the floor entirely. The DM is never muted by any of these.">
                <span className="inline-flex min-w-0 max-w-full">
                  <Select<"off" | "soft" | "strict">
                    size="sm"
                    label="Turn enforcement on microphones"
                    value={settings.voice.turnEnforcement}
                    onChange={(turnEnforcement) => patch({ voice: { ...settings.voice, turnEnforcement } })}
                    options={[
                      { value: "off", label: "Turns: ignored" },
                      { value: "soft", label: "Turns: shown" },
                      { value: "strict", label: "Turns: enforced" },
                    ]}
                    className={selectClass}
                  />
                </span>
              </Tooltip>
              <Tooltip content="Transcription: each speaker's microphone is written down with their name, for the beat drafter and the chapter summary. Never read by the DM prompt. The lobby says out loud that the table is being transcribed while this is on.">
                <SettingToggle on={settings.voice.transcribe} onToggle={() => patch({ voice: { ...settings.voice, transcribe: !settings.voice.transcribe } })}>
                  Transcription {settings.voice.transcribe ? "on" : "off"}
                </SettingToggle>
              </Tooltip>
              <Tooltip content="Distance decides who hears whom, using the battle map. Outside combat, or with no map, everyone hears everyone as usual. The DM always hears everyone and is always heard.">
                <SettingToggle on={settings.voice.rules.proximity} onToggle={() =>
                    patch({
                      voice: {
                        ...settings.voice,
                        rules: { ...settings.voice.rules, proximity: !settings.voice.rules.proximity },
                      },
                    })}>
                  Proximity {settings.voice.rules.proximity ? "on" : "off"}
                </SettingToggle>
              </Tooltip>
              {settings.voice.rules.proximity ? (
                <>
                  <span className="inline-flex min-w-0 max-w-full" title="How far a normal speaking voice carries">
                    <Select
                      size="sm"
                      label="How far a normal speaking voice carries"
                      value={String(settings.voice.rules.hearingRangeFeet)}
                      onChange={(value) =>
                        patch({ voice: { ...settings.voice, rules: { ...settings.voice.rules, hearingRangeFeet: Number(value) } } })
                      }
                      options={[15, 30, 60, 120].map((feet) => ({ value: String(feet), label: `${feet} ft` }))}
                      className={selectClass}
                    />
                  </span>
                  <Tooltip content="Lets each player pick whisper (5 ft), normal, or shout (120 ft). The range is the speaker's, because shouting is something you do rather than something done to you.">
                    <SettingToggle on={settings.voice.rules.sayRange} onToggle={() =>
                        patch({
                          voice: {
                            ...settings.voice,
                            rules: { ...settings.voice.rules, sayRange: !settings.voice.rules.sayRange },
                          },
                        })}>
                      Whisper/shout {settings.voice.rules.sayRange ? "on" : "off"}
                    </SettingToggle>
                  </Tooltip>
                  <Tooltip content="A wall between two characters muffles the voice rather than silencing it. Hearing through a door is a real thing, and audio that vanished at a doorway would read as a bug. Fog of war never gates audio: not seeing someone has nothing to do with hearing them.">
                    <SettingToggle on={settings.voice.rules.wallsAttenuate} onToggle={() =>
                        patch({
                          voice: {
                            ...settings.voice,
                            rules: {
                              ...settings.voice.rules,
                              wallsAttenuate: !settings.voice.rules.wallsAttenuate,
                            },
                          },
                        })}>
                      Walls muffle {settings.voice.rules.wallsAttenuate ? "on" : "off"}
                    </SettingToggle>
                  </Tooltip>
                </>
              ) : null}
              <Tooltip content="A character at 0 hit points stops hearing the table. They still hear the DM, and they are still heard.">
                <SettingToggle on={settings.voice.rules.downedGoDeaf} onToggle={() =>
                    patch({
                      voice: {
                        ...settings.voice,
                        rules: {
                          ...settings.voice.rules,
                          downedGoDeaf: !settings.voice.rules.downedGoDeaf,
                        },
                      },
                    })}>
                  Downed go deaf {settings.voice.rules.downedGoDeaf ? "on" : "off"}
                </SettingToggle>
              </Tooltip>
            </>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Bonds</span>
          <Tooltip content="How each NPC and AI companion feels about each character, tracked by the server on one meter from hostile through neutral to devoted. Deeds move it, and the same deed lands differently on different people: mercy wins over a kind healer and irritates a hard-bitten mercenary. Standing shows in the Bonds tab and colors how the DM plays them.">
            <SettingToggle on={settings.relationships !== "off"} onToggle={() =>
                patch({ relationships: settings.relationships === "off" ? "on" : "off" })}>
              Bonds {settings.relationships !== "off" ? "on" : "off"}
            </SettingToggle>
          </Tooltip>
          {settings.relationships !== "off" ? (
            <Tooltip content="The romance ladder on top of the bond meter: interested, courting, together, betrothed, married. Nobody can be romanced who does not already like the character, players always make the first move, and intimate scenes always fade to black.">
              <SettingToggle on={settings.romance !== "off"} onToggle={() => patch({ romance: settings.romance === "off" ? "on" : "off" })}>
                Romance {settings.romance !== "off" ? "on" : "off"}
              </SettingToggle>
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
        <div className="reveal flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Allies</span>
          <Tooltip content="AI companions the DM plays: 'party members' travel with the party until dismissed; 'guests' are temporary allies for one scene or battle (a town soldier helping defend) and leave automatically when the fight ends. Auto picks full for solo play, guests only for multiplayer.">
            <span className="inline-flex min-w-0 max-w-full">
              <Select<GameSettings["companions"]>
                size="sm"
                label="AI companions"
                value={settings.companions}
                onChange={(companions) => patch({ companions })}
                options={(Object.keys(COMPANION_LABELS) as Array<GameSettings["companions"]>).map((mode) => ({ value: mode, label: COMPANION_LABELS[mode] }))}
                className={selectClass}
              />
            </span>
          </Tooltip>
          {settings.companions !== "off" ? (
            <>
              {settings.companions !== "guests" ? (
                <span className="inline-flex min-w-0 max-w-full" title="Most lasting party companions allowed at once">
                  <Select
                    size="sm"
                    label="Most lasting party companions allowed at once"
                    value={String(settings.maxCompanions)}
                    onChange={(value) => patch({ maxCompanions: Number(value) })}
                    options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: `max ${count} party` }))}
                    className={selectClass}
                  />
                </span>
              ) : null}
              <span className="inline-flex min-w-0 max-w-full" title="Most temporary guest allies allowed at once">
                <Select
                  size="sm"
                  label="Most temporary guest allies allowed at once"
                  value={String(settings.maxGuests)}
                  onChange={(value) => patch({ maxGuests: Number(value) })}
                  options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: `max ${count} guest${count === 1 ? "" : "s"}` }))}
                  className={selectClass}
                />
              </span>
            </>
          ) : null}
        </div>
        ) : null}
      </div>
    </section>
  );
}
