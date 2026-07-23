"use client";

import { Bot, Dices, Globe, Hand, Map, PackageCheck, Sparkles, UserPlus, Volume2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfoButton } from "@/components/ui/InfoDialog";
import { GENRE_PRESETS, genrePreset } from "@/lib/genres";
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

// Lobby game-settings section: the party lead edits live (PATCHes propagate to
// everyone over SSE); other players see a read-only summary.
export function GameSettingsPanel({
  campaignId,
  settings,
  isLead,
}: {
  campaignId: string;
  settings: GameSettings;
  isLead: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function patch(update: Partial<GameSettings>) {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
    } finally {
      setBusy(false);
    }
  }

  const preset = genrePreset(settings.genre);
  const selectClass =
    "rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600";

  if (!isLead) {
    return (
      <section className="mb-6 rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-2 text-sm font-medium text-stone-300">Game settings</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-400">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-amber-200" />
            {preset.name}
            {settings.aiStorySetup ? " · AI story setup" : ""}
            {" · "}
            {CAMPAIGN_LENGTH_LABELS[settings.campaignLength].split(" (")[0]} campaign
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
      <div className={cn("space-y-3 text-xs", busy && "opacity-70")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Setting</span>
          <select
            value={settings.genre}
            onChange={(event) => patch({ genre: event.target.value as Genre })}
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Dice</span>
          <select
            value={settings.dicePolicy}
            onChange={(event) => patch({ dicePolicy: event.target.value as DicePolicy })}
            className={selectClass}
          >
            <option value="digital_only">Digital only</option>
            <option value="real_allowed">Real dice allowed</option>
          </select>
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
          <span className="w-16 text-stone-500">Extras</span>
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
      </div>
    </section>
  );
}
