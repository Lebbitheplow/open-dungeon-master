"use client";

import { STAGES, isStageEnabled } from "@/lib/dm/stages";
import { DELEGATIONS, DELEGATION_HINTS, DELEGATION_LABELS } from "@/lib/dm/delegation";
import { Select } from "@/components/ui/Select";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfoButton } from "@/components/ui/InfoDialog";
import { SettingToggle, panelField } from "./PanelKit";
import { cn } from "@/lib/cn";
import { GENRE_PRESETS, type GenrePreset } from "@/lib/genres";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { WorldPackGallery } from "@/components/WorldPackGallery";
import { VoicePicker } from "@/components/VoicePicker";
import { NarrationNote } from "@/app/campaigns/[campaignId]/NarrationNote";
import { CharacterVoices } from "@/app/campaigns/[campaignId]/CharacterVoices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { SafetyToneFields } from "@/components/SafetyToneFields";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { REROLL_LOW_DEFAULT, rerollBelowFor, rerollChoiceOf, type RerollChoice } from "@/lib/srd/ability-rerolls";
import {
  CAMPAIGN_LENGTH_LABELS,
  CAMPAIGN_LENGTHS,
  COMPANION_LABELS,
  HP_METHODS,
  STARTING_WEALTH,
  TABLE_LANGUAGE_HELP,
  TABLE_LANGUAGE_LABELS,
  TABLE_LANGUAGES,
  type CampaignLengthSetting,
  type DicePolicy,
  type Genre,
  type TableLanguage,
} from "@/lib/schemas/game-settings-options";
import { alliesShown } from "@/app/campaigns/[campaignId]/table-settings-groups";
import { NarrationStyleRows } from "@/app/campaigns/[campaignId]/NarrationStyleRows";

// The bodies of the table settings' named groups (table-settings-groups.ts
// names them and says what each holds on its closed face). Every control is
// the one the single long panel drew, with the same tooltip and the same
// immediate PATCH; only the grouping changed.

type Patch = (update: Partial<GameSettings>) => void;
type Base = { settings: GameSettings; patch: Patch };

// Short forms of the character-rule settings for a settings row; the long
// forms live in game-settings-options.ts.
export const HP_METHOD_SHORT: Record<GameSettings["hpMethod"], string> = {
  average: "HP: average each level",
  rolled: "HP: rolled each level",
  max: "HP: maximum each level",
};
export const WEALTH_SHORT: Record<GameSettings["startingWealth"], string> = {
  equipment: "Start: class kit and coin",
  rolled: "Start: rolled gold, buy gear",
};

// A select is as wide as its longest option, and a flex item will not
// shrink below that on its own, so a world pack with a long name used to
// push the whole panel sideways on a phone. Capped at the row's width and
// ellipsised instead.
const selectClass = "min-w-0 max-w-full";

export function WorldGroup({
  settings,
  patch,
  packs,
  selectedPack,
  preset,
}: Base & { packs: WorldPackSummary[]; selectedPack: WorldPackSummary | null; preset: GenrePreset }) {
  const aiNarrates = settings.dmMode !== "human";
  return (
    <>
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Language</span>
        <Select<TableLanguage>
          size="sm"
          label="Table language"
          value={settings.tableLanguage}
          onChange={(tableLanguage) => patch({ tableLanguage })}
          options={TABLE_LANGUAGES.map((value) => ({ value, label: TABLE_LANGUAGE_LABELS[value] }))}
          className={selectClass}
        />
        <span className="text-stone-500">{TABLE_LANGUAGE_HELP}</span>
      </div>
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
    </>
  );
}

export function CharacterGroup({ settings, patch, serverRerollLabel }: Base & { serverRerollLabel: string }) {
  return (
    <>
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
        <span className="pk-rowlabel">Heroes</span>
        <Tooltip content="How hit points grow after 1st level (1st is always the hit die's highest face plus Constitution). Rolled dice are thrown by the server.">
          <span className="inline-flex min-w-0 max-w-full">
            <Select
              size="sm"
              label="Hit points per level"
              value={settings.hpMethod ?? "average"}
              onChange={(value) => patch({ hpMethod: value as GameSettings["hpMethod"] })}
              options={HP_METHODS.map((method) => ({ value: method, label: HP_METHOD_SHORT[method] }))}
              className={selectClass}
            />
          </span>
        </Tooltip>
        <Tooltip content="What a new character starts with: the class and background kit plus the background's coin, or gold the server rolls by class to buy gear with.">
          <span className="inline-flex min-w-0 max-w-full">
            <Select
              size="sm"
              label="Starting wealth"
              value={settings.startingWealth ?? "equipment"}
              onChange={(value) => patch({ startingWealth: value as GameSettings["startingWealth"] })}
              options={STARTING_WEALTH.map((method) => ({ value: method, label: WEALTH_SHORT[method] }))}
              className={selectClass}
            />
          </span>
        </Tooltip>
        <Tooltip content="For 4d6 ability scores rolled at this table: whether a player may throw the six again, and when. The server rolls the dice either way. Following the server's rule, a player's six here are the ones they rolled in their library; with a rule of its own the table keeps a separate six for each player. A character made here still joins its player's library like any other, and characters brought from the library keep the scores they were made with.">
          <span className="inline-flex min-w-0 max-w-full">
            <Select
              size="sm"
              label="Rolled stats"
              value={settings.abilityRerollBelow == null ? "server" : rerollChoiceOf(settings.abilityRerollBelow)}
              onChange={(value) =>
                patch({
                  abilityRerollBelow:
                    value === "server"
                      ? null
                      : rerollBelowFor(value as RerollChoice, settings.abilityRerollBelow ?? REROLL_LOW_DEFAULT),
                })
              }
              options={[
                { value: "server", label: `Stats: ${serverRerollLabel}` },
                { value: "keep", label: "Stats: the first roll stands" },
                { value: "low", label: `Stats: reroll under ${rerollBelowFor("low", settings.abilityRerollBelow ?? REROLL_LOW_DEFAULT)}` },
                { value: "free", label: "Stats: reroll freely" },
              ]}
              className={selectClass}
            />
          </span>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Classes</span>
        <Tooltip content="Let characters take levels in a second or third class at level-up (5e multiclassing, prerequisites enforced)">
          <SettingToggle on={settings.multiclassingEnabled} onToggle={() => patch({ multiclassingEnabled: !settings.multiclassingEnabled })}>
            Multiclassing {settings.multiclassingEnabled ? "on" : "off"}
          </SettingToggle>
        </Tooltip>
      </div>
    </>
  );
}

export function NarrationGroup({
  settings,
  patch,
  campaignId,
  narrating,
  narrationOff,
}: Base & { campaignId: string; narrating: boolean; narrationOff: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Narration</span>
        <SettingToggle label="Narration" on={narrating} disabled={narrationOff} onToggle={() => patch({ ttsEnabled: !settings.ttsEnabled })}>
          {narrating ? "On" : narrationOff ? "Off on this server" : "Off"}
        </SettingToggle>
        {narrating ? (
          <>
            <VoicePicker size="sm" label="Narration voice" value={settings.ttsVoice} onChange={(ttsVoice) => patch({ ttsVoice })} />
            <VoicePreviewButton voice={settings.ttsVoice} />
          </>
        ) : null}
      </div>
      {narrating ? <CharacterVoices campaignId={campaignId} settings={settings} steersStory patch={patch} /> : null}
      {narrating || narrationOff ? <NarrationNote /> : null}
      <p className="text-stone-500">
        Whether the story is read aloud is the whole table&apos;s setting. How loud it plays, or muting it, is each
        person&apos;s own, from the speaker button at the table.
      </p>
    </>
  );
}

export function AtmosphereGroup({
  settings,
  patch,
  steersAudio,
  ambienceInstalled,
  ambienceCounts,
}: Base & {
  steersAudio: boolean;
  ambienceInstalled: boolean;
  ambienceCounts: Record<"bed" | "music" | "sting", { installed: number; total: number }> | null;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Maps</span>
        <SettingToggle on={settings.mapsEnabled} onToggle={() => patch({ mapsEnabled: !settings.mapsEnabled })}>
          Maps {settings.mapsEnabled ? "on" : "off"}
        </SettingToggle>
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
        {steersAudio && settings.ambienceEnabled && !ambienceInstalled ? (
          // The catalog knows the cues but no audio is on disk, so the
          // toggle above is currently a promise of silence. Say so where
          // it is being switched on rather than letting the table wonder.
          <span className="text-stone-500">
            This server has no sound library on disk, so this plays silence. The library ships with the game; the
            server admin can restore it from the admin panel (Sound library).
          </span>
        ) : steersAudio && settings.ambienceEnabled && ambienceCounts ? (
          <span className="text-stone-500">
            Audio for {ambienceCounts.bed.installed} of {ambienceCounts.bed.total} rooms, {ambienceCounts.music.installed}{" "}
            of {ambienceCounts.music.total} moods and {ambienceCounts.sting.installed} of {ambienceCounts.sting.total}{" "}
            sounds. The speaker in the table header opens the sound panel.
          </span>
        ) : null}
      </div>
    </>
  );
}

export function SafetyGroup({ settings, patch }: Base) {
  return (
    <SafetyToneFields
      safety={settings.safety}
      gm={settings.gm}
      ttsVoice={settings.ttsVoice}
      onSafety={(safety) => patch({ safety })}
      onGm={(gm) => patch({ gm })}
      onVoice={(ttsVoice) => patch({ ttsVoice })}
    />
  );
}

// The Living World explainer, shared with the campaign creator's info
// button so the two never drift.
export const LIVING_WORLD_INFO = [
  "On: the world moves without you. Off-screen storylines advance on background dice each turn, so rival factions, threats, and distant events keep developing while you play.",
  "NPCs pursue their own goals between chapters and during rests and travel. Schemes progress, pressure builds, and rivals can collide with each other.",
  "The DM quietly records what happened off-screen and weaves it into future scenes, ambushes, and rumors. These simulation notes are DM-only until the party discovers them in play.",
  "Off: all of that pauses. The world changes only when your party acts or the story arc calls for it. Your main story arc, chapters, quests, and XP work exactly the same either way.",
  "You can switch this at any time. Turning it back on resumes from the world as it currently stands.",
].join("\n\n");

export function AiGroup({ settings, patch }: Base) {
  const aiNarrates = settings.dmMode !== "human";
  return (
    <>
      {settings.dmMode === "assisted" ? (
        // Only in the middle setting. A table the AI runs has nothing to
        // delegate and a table running itself has chosen not to, so showing
        // three switched-off switches in either would be noise.
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">AI helps</span>
          {DELEGATIONS.map((which) => (
            <Tooltip key={which} content={DELEGATION_HINTS[which]}>
              <SettingToggle
                on={settings.dmAssist[which]}
                onToggle={() => patch({ dmAssist: { ...settings.dmAssist, [which]: !settings.dmAssist[which] } })}
              >
                {DELEGATION_LABELS[which]}
              </SettingToggle>
            </Tooltip>
          ))}
        </div>
      ) : null}
      {aiNarrates ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Setup</span>
          <SettingToggle on={settings.aiStorySetup} onToggle={() => patch({ aiStorySetup: !settings.aiStorySetup })}>
            AI story setup {settings.aiStorySetup ? "on" : "off"}
          </SettingToggle>
          <span className="text-stone-500">
            {settings.aiStorySetup ? "The DM invents the plot before the first scene." : "The story starts from your premise and prep alone."}
          </span>
        </div>
      ) : null}
      {aiNarrates ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Prose</span>
          <Tooltip content="After each turn the server compares the DM's narration against what the dice and tools actually resolved: a hit written on a miss, a death the hit points deny, a damage number no die rolled. A contradiction is sent back to the DM once for a rewrite. Nothing on any sheet changes either way.">
            <SettingToggle on={settings.narrationGuard} onToggle={() => patch({ narrationGuard: !settings.narrationGuard })}>
              Outcome check {settings.narrationGuard ? "on" : "off"}
            </SettingToggle>
          </Tooltip>
          <span className="text-stone-500">
            {settings.narrationGuard
              ? "Narration that contradicts the dice goes back for one rewrite."
              : "The DM's narration is persisted exactly as written."}
          </span>
        </div>
      ) : null}
      {aiNarrates ? <NarrationStyleRows settings={settings} patch={patch} /> : null}
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
      {/* At a table a person runs, Auto already allows the lasting allies
          the DM plays by hand, so the row stays out of the way; it shows
          when an Off or guests-only setting carried over from an AI table
          shuts them out, which is where the Party panel's handoff points
          (issue 209). */}
      {alliesShown(settings) ? (
        <div data-settings-row="allies" className="reveal flex flex-wrap items-center gap-2">
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
    </>
  );
}

// The narrator's pipeline. Optional tuning: every table starts with all of
// it on, and the line under the switches says so.
export function MemoryGroup({ settings, patch }: Base) {
  return (
    <>
      <p className="text-stone-500">
        How the AI narrator remembers a long campaign. Every table starts with all of these on; switch one off only to
        save model time on a slow server.
      </p>
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {STAGES.map((stage) => {
          const on = isStageEnabled(settings.stages, stage.id);
          return (
            <Tooltip key={stage.id} content={`${stage.description} ${stage.cost}`}>
              <SettingToggle on={on} onToggle={() => patch({ stages: { ...settings.stages, [stage.id]: !on } })}>
                {stage.label} {on ? "on" : "off"}
                {/* Only a model-call stage buys back GPU time; saying so
                    stops an operator disabling recall expecting a speedup. */}
                <span className="ml-1 text-[11px] text-stone-500">{stage.callsModel ? "model" : "engine"}</span>
              </SettingToggle>
            </Tooltip>
          );
        })}
      </div>
    </>
  );
}

export function BondsGroup({ settings, patch }: Base) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="pk-rowlabel">Bonds</span>
      <Tooltip content="How each NPC and AI companion feels about each character, tracked by the server on one meter from hostile through neutral to devoted. Deeds move it, and the same deed lands differently on different people: mercy wins over a kind healer and irritates a hard-bitten mercenary. Standing shows in the Bonds tab and colors how the DM plays them.">
        <SettingToggle on={settings.relationships !== "off"} onToggle={() => patch({ relationships: settings.relationships === "off" ? "on" : "off" })}>
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
  );
}

// Wait for the table (src/lib/dm/table-wait.ts) as one picker: the DM answers
// the first post, or waits for everyone with a choice of how long a quiet
// table holds it (15 to 900 seconds allowed). A stored length that is not
// one of the choices is offered as itself.
const WAIT_CHOICES = [30, 60, 120, 180, 300, 600, 900];
function waitLabel(seconds: number) {
  return `Waits for everyone, up to ${seconds % 60 ? `${seconds}s` : `${seconds / 60} min`}`;
}
const PACING_INFO =
  "Answers the first post: the AI DM narrates as soon as anyone acts, so the quickest player sets the pace.\n\nWaits for everyone: after each narration the AI DM waits until every player who has the table open (or plays through a connected agent) has acted or pressed Pass, then answers them all in one turn. The clock starts with the first answer and restarts with every post or pass, so only a quiet table runs it out. The lead can say Go on now at any time. A spotlight, a fight's turn order and table talk never wait.";
function pacingOptions(seconds: number) {
  const lengths = WAIT_CHOICES.includes(seconds) ? WAIT_CHOICES : [...WAIT_CHOICES, seconds].sort((a, b) => a - b);
  // "0": no wait, the first post wakes the DM.
  return [{ value: "0", label: "Answers the first post" }, ...lengths.map((length) => ({ value: String(length), label: waitLabel(length) }))];
}

// `solo`: a table of one, where nobody else could be waited for.
export function PlayersGroup({ settings, patch, solo = false }: Base & { solo?: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Joining</span>
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
      {/* Only where it can matter: an AI turn to hold, and someone else to
          wait for. */}
      {!solo && settings.dmMode !== "human" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="pk-rowlabel">Pacing</span>
          <Select
            size="sm"
            label="When the AI DM answers"
            value={settings.waitForTable ? String(settings.waitForTableSeconds) : "0"}
            onChange={(value) => patch(Number(value) ? { waitForTable: true, waitForTableSeconds: Number(value) } : { waitForTable: false })}
            options={pacingOptions(settings.waitForTableSeconds)}
            className={selectClass}
          />
          <InfoButton label="What does waiting for everyone do?" text={PACING_INFO} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Items</span>
        <Tooltip content="When on, DM-granted loot, item removals, and gold changes become offers the owning player accepts or declines before they land on the sheet. Damage, healing and conditions have their own switch.">
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
      <div className="pk-row">
        <span className="pk-rowlabel">Vitals</span>
        <Tooltip content="When on, damage, healing and conditions the AI DM or a connected agent aims at a player character wait for that player (or the lead) to confirm before they land, so a wrong target, a doubled hit or a misread rule never sticks unseen. The engine's own dice, an enemy's attack or a fall, apply as always. A slower table; off by default.">
          <SettingToggle on={settings.vitalsApprovals} onToggle={() => patch({ vitalsApprovals: !settings.vitalsApprovals })}>
            Vitals changes {settings.vitalsApprovals ? "need confirming" : "auto-apply"}
          </SettingToggle>
        </Tooltip>
        <span className="text-stone-500">
          {settings.vitalsApprovals
            ? "Players confirm DM damage, healing and conditions before they apply."
            : "DM damage, healing and conditions apply immediately (lead can undo)."}
        </span>
      </div>
    </>
  );
}

// Only the DM seat is ever nudged, so this group does not exist for a table
// the AI narrates: there, the story is typed by definition.
export function ConsoleGroup({ settings, patch }: Base) {
  return (
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
  );
}

export function BoardGroup({ settings, patch }: Base) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="pk-rowlabel">Board</span>
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
    </div>
  );
}

// Live voice chat. The rules below are a list rather than a single
// proximity checkbox on purpose: "players only hear people within 30 feet"
// is one table's house rule, and the next table will want a different one.
// They are all inputs to one function (src/lib/voice/audibility.ts).
export function VoiceChatGroup({ settings, patch, transcribes }: Base & { transcribes: boolean }) {
  const rules = settings.voice.rules;
  const setRule = (change: Partial<GameSettings["voice"]["rules"]>) => patch({ voice: { ...settings.voice, rules: { ...rules, ...change } } });
  return (
    <>
      <p className="text-stone-500">
        People talking to each other, in the lobby and during play. Separate from narration, which reads the story aloud.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Voice</span>
        <Tooltip content="Live voice chat for this table, in the lobby and during play. The server also has its own switch, and needs a media port open; if voice is off server-wide this has no effect.">
          <SettingToggle on={settings.voice.enabled} onToggle={() => patch({ voice: { ...settings.voice, enabled: !settings.voice.enabled } })}>
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
            <Tooltip
              content={
                transcribes
                  ? "Transcription: each speaker's microphone is written down with their name, for the beat drafter and the chapter summary. Never read by the DM prompt. The lobby says out loud that the table is being transcribed while this is on."
                  : "This server has no transcription service, so nothing said on the call can be written down. An admin sets up a Whisper service (STT_URL, or Admin > Speech) to switch it on."
              }
            >
              <SettingToggle
                on={settings.voice.transcribe && transcribes}
                disabled={!transcribes}
                onToggle={() => patch({ voice: { ...settings.voice, transcribe: !settings.voice.transcribe } })}
              >
                Transcription {!transcribes ? "off on this server" : settings.voice.transcribe ? "on" : "off"}
              </SettingToggle>
            </Tooltip>
            <Tooltip content="Distance decides who hears whom, using the battle map. Outside combat, or with no map, everyone hears everyone as usual. The DM always hears everyone and is always heard.">
              <SettingToggle on={rules.proximity} onToggle={() => setRule({ proximity: !rules.proximity })}>
                Proximity {rules.proximity ? "on" : "off"}
              </SettingToggle>
            </Tooltip>
            {rules.proximity ? (
              <>
                <span className="inline-flex min-w-0 max-w-full" title="How far a normal speaking voice carries">
                  <Select
                    size="sm"
                    label="How far a normal speaking voice carries"
                    value={String(rules.hearingRangeFeet)}
                    onChange={(value) => setRule({ hearingRangeFeet: Number(value) })}
                    options={[15, 30, 60, 120].map((feet) => ({ value: String(feet), label: `${feet} ft` }))}
                    className={selectClass}
                  />
                </span>
                <Tooltip content="Lets each player pick whisper (5 ft), normal, or shout (120 ft). The range is the speaker's, because shouting is something you do rather than something done to you.">
                  <SettingToggle on={rules.sayRange} onToggle={() => setRule({ sayRange: !rules.sayRange })}>
                    Whisper/shout {rules.sayRange ? "on" : "off"}
                  </SettingToggle>
                </Tooltip>
                <Tooltip content="A wall between two characters muffles the voice rather than silencing it. Hearing through a door is a real thing, and audio that vanished at a doorway would read as a bug. Fog of war never gates audio: not seeing someone has nothing to do with hearing them.">
                  <SettingToggle on={rules.wallsAttenuate} onToggle={() => setRule({ wallsAttenuate: !rules.wallsAttenuate })}>
                    Walls muffle {rules.wallsAttenuate ? "on" : "off"}
                  </SettingToggle>
                </Tooltip>
              </>
            ) : null}
            <Tooltip content="A character at 0 hit points stops hearing the table. They still hear the DM, and they are still heard.">
              <SettingToggle on={rules.downedGoDeaf} onToggle={() => setRule({ downedGoDeaf: !rules.downedGoDeaf })}>
                Downed go deaf {rules.downedGoDeaf ? "on" : "off"}
              </SettingToggle>
            </Tooltip>
          </>
        ) : null}
      </div>
    </>
  );
}
