"use client";

import { Check, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { PanelError } from "./PanelKit";
import { genrePreset } from "@/lib/genres";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { useTtsVoices, voiceLabel } from "@/components/VoicePicker";
import { CharacterVoices } from "@/app/campaigns/[campaignId]/CharacterVoices";
import { DetailGroup } from "@/app/create-campaign/fields";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { describeTableReroll } from "@/lib/srd/ability-rerolls";
import { useServerRerollBelow } from "@/app/characters/builder/useTableRules";
import { transcribesVoice, useCapabilities } from "@/lib/use-capabilities";
import { COMPANION_LABELS, CAMPAIGN_LENGTH_LABELS } from "@/lib/schemas/game-settings-options";
import {
  AiGroup,
  AtmosphereGroup,
  BoardGroup,
  BondsGroup,
  CharacterGroup,
  ConsoleGroup,
  HP_METHOD_SHORT,
  MemoryGroup,
  NarrationGroup,
  PlayersGroup,
  SafetyGroup,
  VoiceChatGroup,
  WEALTH_SHORT,
  WorldGroup,
} from "@/app/campaigns/[campaignId]/GameSettingsGroups";
import {
  groupMatches,
  tableGroupSummary,
  tableGroups,
  type TableGroupId,
} from "@/app/campaigns/[campaignId]/table-settings-groups";

export { LIVING_WORLD_INFO } from "@/app/campaigns/[campaignId]/GameSettingsGroups";

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

type SaveState = "idle" | "saving" | "saved" | "error";

// Which groups were left open, per campaign, for this browser tab: the
// Settings tab unmounts when another tab is picked, and coming back to a
// group you were in should not mean finding it again.
function openKey(campaignId: string) {
  return `odm.tableSettingsOpen.${campaignId}`;
}

function useOpenGroups(campaignId: string) {
  const [open, setOpen] = useState<TableGroupId[]>([]);
  useEffect(() => {
    let stored: TableGroupId[] = [];
    try {
      const raw = window.sessionStorage.getItem(openKey(campaignId));
      stored = raw ? (JSON.parse(raw) as TableGroupId[]) : [];
    } catch {
      // Storage refused: every group starts closed.
    }
    const timer = window.setTimeout(() => setOpen(Array.isArray(stored) ? stored : []), 0);
    return () => window.clearTimeout(timer);
  }, [campaignId]);
  const toggle = (id: TableGroupId, next: boolean) =>
    setOpen((current) => {
      const updated = next ? [...current.filter((entry) => entry !== id), id] : current.filter((entry) => entry !== id);
      try {
        window.sessionStorage.setItem(openKey(campaignId), JSON.stringify(updated));
      } catch {
        // Kept for this visit only.
      }
      return updated;
    });
  return { isOpen: (id: TableGroupId) => open.includes(id), toggle };
}

// The table's settings, in the lobby and in the Settings tab: whoever steers
// the story edits them live (PATCHes propagate to everyone over SSE), in the
// campaign creator's named groups; other players see a read-only summary.
export function GameSettingsPanel({
  campaignId,
  settings,
  steersStory,
  heading = true,
  solo = false,
}: {
  campaignId: string;
  settings: GameSettings;
  steersStory: boolean;
  // A table of one: the controls that wait on other players are left out.
  solo?: boolean;
  // The lobby names the section itself, so the panel's own title would say
  // "Table settings" twice.
  heading?: boolean;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const voices = useTtsVoices();
  // Narration switched off server-wide (Admin > Speech, or setup's text
  // only): the row reads Off and its switch is held, whatever the table's
  // own switch says, since nothing would be read aloud. A fresh install's
  // first table said "Narration on" with a voice picked, over a note that
  // the server had no narration (issue 275). The stored value is kept, so
  // a server that gains a speech engine later brings the table's choice
  // back. A speech server that is named but not answering is one switch
  // away, and the note under the row says so; only off holds the switch.
  const capabilities = useCapabilities();
  const narrationOff = capabilities?.tts?.provider === "off";
  const narrating = settings.ttsEnabled && !narrationOff;
  // Every control here renders the server's settings, so a refused PATCH
  // changes nothing on screen; without this line it changes nothing silently.
  const [error, setError] = useState("");
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  const [find, setFind] = useState("");
  const groups = useOpenGroups(campaignId);
  // Whether any ambience audio is actually on disk. The library ships empty
  // (public/ambience is gitignored and filled by npm run fetch-ambience), so
  // a lead can switch ambience on and hear nothing with no clue why; this
  // powers the hint on the Ambience row. Defaults to true so the hint never
  // flashes on installs that are fine while the answer is in flight.
  const [ambienceInstalled, setAmbienceInstalled] = useState(true);
  const [ambienceCounts, setAmbienceCounts] = useState<Record<"bed" | "music" | "sting", { installed: number; total: number }> | null>(null);
  // What "the server's rule" for rolled stats is, so neither the lead's
  // choice nor a player's summary leaves it unnamed.
  const serverRerollBelow = useServerRerollBelow();
  // A server that cannot transcribe holds the Transcription switch off; the
  // table's stored choice is kept, so transcription added later brings it
  // back.
  const transcribes = transcribesVoice(capabilities);
  const serverRerollLabel = describeTableReroll(null, serverRerollBelow).toLowerCase();

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
          setAmbienceCounts(data.counts ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [steersStory, settings.ambienceEnabled]);

  // "Saved" stays a moment, then the line goes back to saying how saving works.
  useEffect(() => {
    if (saveState !== "saved") return;
    const timer = window.setTimeout(() => setSaveState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [saveState]);

  async function patch(update: Partial<GameSettings>) {
    setSaveState("saving");
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
        setSaveState("error");
        return;
      }
      setSaveState("saved");
    } catch {
      setError("Could not reach the server.");
      setSaveState("error");
    }
  }

  const preset = genrePreset(settings.genre);
  const selectedPack = packs.find((entry) => entry.id === settings.worldPack) ?? null;

  if (!steersStory) {
    return (
      <section className="panel mb-6 rounded-xl p-4" data-table-settings="read">
        {heading ? <SectionHead title="Table settings" glyph="tab-settings" level="h2" /> : null}
        <p className="mb-2 text-xs text-stone-500">
          {settings.dmMode === "ai" ? "The party lead" : "The DM"} sets these for everyone at this table.
        </p>
        <div className="stagger flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-300">
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "system-region" }} size="size-5" />
            {selectedPack?.name ?? preset.name}
            {settings.dmMode === "human" ? " · human DM" : settings.dmMode === "steered" ? " · AI narrates, a person steers" : ""}
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
            {narrating
              ? `Narration on (${voiceLabel(voices, settings.ttsVoice)})`
              : narrationOff
                ? "Narration off on this server"
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
            <GameIcon icon={{ kind: "glyph", key: "rest-hp" }} size="size-5" />
            {HP_METHOD_SHORT[settings.hpMethod ?? "average"]}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "coin-gp" }} size="size-5" />
            {WEALTH_SHORT[settings.startingWealth ?? "equipment"]}
          </span>
          <span className="flex items-center gap-1.5">
            <GameIcon icon={{ kind: "glyph", key: "die-d6" }} size="size-5" />
            Stats: {describeTableReroll(settings.abilityRerollBelow, serverRerollBelow).toLowerCase()}
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
            {settings.inventoryApprovals && settings.vitalsApprovals
              ? "Item and vitals changes need approval"
              : settings.inventoryApprovals
                ? "Item offers need approval"
                : settings.vitalsApprovals
                  ? "Vitals changes need approval"
                  : "Item changes auto-apply"}
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
        {narrating ? <CharacterVoices campaignId={campaignId} settings={settings} steersStory={false} /> : null}
      </section>
    );
  }

  const context = {
    packName: selectedPack?.name ?? null,
    genreName: preset.name,
    voiceName: voiceLabel(voices, settings.ttsVoice),
    narrationOff,
    statsRule: describeTableReroll(settings.abilityRerollBelow, serverRerollBelow).toLowerCase(),
  };
  const searching = find.trim().length > 0;
  const visible = tableGroups(settings)
    .map((group) => ({ ...group, summary: tableGroupSummary(group.id, settings, context) }))
    .filter((group) => groupMatches(group, group.summary, find));
  const base = { settings, patch: (update: Partial<GameSettings>) => void patch(update) };

  function body(id: TableGroupId) {
    switch (id) {
      case "world":
        return <WorldGroup {...base} packs={packs} selectedPack={selectedPack} preset={preset} />;
      case "character":
        return <CharacterGroup {...base} serverRerollLabel={serverRerollLabel} />;
      case "narration":
        return <NarrationGroup {...base} campaignId={campaignId} narrating={narrating} narrationOff={narrationOff} />;
      case "atmosphere":
        return <AtmosphereGroup {...base} steersAudio ambienceInstalled={ambienceInstalled} ambienceCounts={ambienceCounts} />;
      case "safety":
        return <SafetyGroup {...base} />;
      case "ai":
        return <AiGroup {...base} />;
      case "memory":
        return <MemoryGroup {...base} />;
      case "bonds":
        return <BondsGroup {...base} />;
      case "players":
        return <PlayersGroup {...base} solo={solo} />;
      case "console":
        return <ConsoleGroup {...base} />;
      case "board":
        return <BoardGroup {...base} />;
      case "voiceChat":
        return <VoiceChatGroup {...base} transcribes={transcribes} />;
    }
  }

  return (
    <section className="panel mb-6 rounded-xl p-4" data-table-settings="edit">
      {heading ? <SectionHead title="Table settings" glyph="tab-settings" level="h2" /> : null}
      <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500" aria-live="polite">
        <span>Applies to everyone at this table. Each change saves as you make it.</span>
        {saveState === "saving" ? (
          <span key="saving" className="live-in inline-flex items-center gap-1 text-stone-400">
            <Loader2 className="size-3 animate-spin" /> Saving
          </span>
        ) : saveState === "saved" ? (
          <span key="saved" className="live-in inline-flex items-center gap-1 text-emerald-400">
            <Check className="tick-in size-3" /> Saved
          </span>
        ) : null}
      </p>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-amber-300/70" />
        <input
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="Find a setting"
          aria-label="Find a table setting"
          className={cn(ui.input, "h-9 pl-9 text-xs")}
        />
      </div>
      {error ? <PanelError className="mb-2">{error}</PanelError> : null}
      <div className="space-y-2 text-xs">
        {visible.map((group) => (
          <DetailGroup
            key={group.id}
            id={group.id}
            title={group.title}
            glyph={group.glyph}
            summary={group.summary}
            // A search opens every group it finds, so the setting is in view.
            open={searching || groups.isOpen(group.id)}
            onToggle={(next) => groups.toggle(group.id, next)}
          >
            {body(group.id)}
          </DetailGroup>
        ))}
        {!visible.length ? <p className="text-stone-500">No setting by that name.</p> : null}
      </div>
    </section>
  );
}
