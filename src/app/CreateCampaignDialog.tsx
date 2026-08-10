"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GENRE_PRESETS } from "@/lib/genres";
import { TTS_VOICES } from "@/lib/tts-voices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { CAMPAIGN_DIFFICULTIES, type CampaignDifficulty } from "@/lib/campaign-types";
import { InfoButton } from "@/components/ui/InfoDialog";
import {
  BONDS_INFO,
  LIVING_WORLD_INFO,
  NARRATION_GUARD_INFO,
  ROMANCE_INFO,
} from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { VariantRulesFields } from "@/app/campaigns/[campaignId]/RulesPanel";
import { submitWorldSetup, WorldSetupFields, type LoreDraft } from "@/app/WorldSetupFields";
import { groupByFranchise, type WorldPackSummary } from "@/lib/worlds/types";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import {
  CAMPAIGN_LENGTH_LABELS,
  CAMPAIGN_LENGTHS,
  COMPANION_LABELS,
  type CampaignLengthSetting,
  type DicePolicy,
  type GameSettings,
  type Genre,
} from "@/lib/schemas/game-settings";

// solo: creates a one-player campaign (maxPlayers 1); the player count is
// hidden and the lobby streamlines itself for a party of one.
export function CreateCampaignDialog({
  open,
  onOpenChange,
  onCreated,
  solo = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (campaignId: string) => void;
  solo?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [startingLevel, setStartingLevel] = useState(1);
  const [difficulty, setDifficulty] = useState<CampaignDifficulty>("normal");
  const [campaignLength, setCampaignLength] = useState<CampaignLengthSetting>("standard");
  const [genre, setGenre] = useState<Genre>("high_fantasy");
  const [customGenreText, setCustomGenreText] = useState("");
  const [worldPack, setWorldPack] = useState("");
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  // A theme or premise the person typed is never clobbered by a later pack
  // choice; one the pack filled in is fair game to replace.
  const themeTouched = useRef(false);
  const descriptionTouched = useRef(false);
  const [aiStorySetup, setAiStorySetup] = useState(true);
  const [dicePolicy, setDicePolicy] = useState<DicePolicy>("digital_only");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVoice, setTtsVoice] = useState<string>("af_heart");
  const [mapsEnabled, setMapsEnabled] = useState(true);
  const [multiclassingEnabled, setMulticlassingEnabled] = useState(true);
  const [worldSimulation, setWorldSimulation] = useState(true);
  const [inventoryApprovals, setInventoryApprovals] = useState(false);
  const [midGameJoinOpen, setMidGameJoinOpen] = useState(false);
  const [holdSubmissions, setHoldSubmissions] = useState(false);
  const [narrationGuard, setNarrationGuard] = useState(true);
  const [relationships, setRelationships] = useState<GameSettings["relationships"]>("on");
  const [romance, setRomance] = useState<GameSettings["romance"]>("on");
  const [variantRules, setVariantRules] = useState<GameSettings["variantRules"]>({
    flanking: false,
    criticalFumbles: false,
    encumbrance: false,
    lingeringInjuries: false,
    restVariant: "standard",
  });
  const [houseRules, setHouseRules] = useState("");
  const [loreDrafts, setLoreDrafts] = useState<LoreDraft[]>([]);
  const [companions, setCompanions] = useState<GameSettings["companions"]>("auto");
  const [maxCompanions, setMaxCompanions] = useState(2);
  const [maxGuests, setMaxGuests] = useState(2);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Fetched rather than imported: the pack files are read off disk on the
  // server, and the summaries are all a picker needs.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void fetch("/api/worlds")
      .then((response) => (response.ok ? response.json() : { packs: [] }))
      .then((data) => {
        if (!cancelled) {
          setPacks(Array.isArray(data.packs) ? data.packs : []);
        }
      })
      .catch(() => {
        // No packs installed is a valid state; the section simply hides.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const franchises = useMemo(() => groupByFranchise(packs), [packs]);
  const selectedPack = packs.find((pack) => pack.id === worldPack) ?? null;

  function choosePack(pack: WorldPackSummary) {
    setWorldPack(pack.id);
    // A pack always also sets the genre, which is what keeps every existing
    // genre consumer working. The Setting row visibly follows along, which is
    // the honest explanation of what a pack actually is.
    setGenre(pack.baseGenre);
    if (!themeTouched.current) {
      setTheme(pack.theme);
    }
    if (!descriptionTouched.current) {
      setDescription(pack.premise);
    }
  }

  function clearPack() {
    setWorldPack("");
    if (!themeTouched.current && selectedPack && theme === selectedPack.theme) {
      setTheme("");
    }
    if (!descriptionTouched.current && selectedPack && description === selectedPack.premise) {
      setDescription("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          theme: theme.trim(),
          maxPlayers: solo ? 1 : maxPlayers,
          startingLevel,
          difficulty,
          gameSettings: {
            genre,
            customGenreText: customGenreText.trim(),
            aiStorySetup,
            campaignLength,
            dicePolicy,
            ttsEnabled,
            ttsVoice,
            mapsEnabled,
            multiclassingEnabled,
            midGameJoinOpen,
            holdSubmissions,
            narrationGuard,
            relationships,
            // Romance rides on the bond meter, so it cannot be on without it.
            romance: relationships === "off" ? "off" : romance,
            worldSimulation,
            inventoryApprovals,
            variantRules,
            companions,
            maxCompanions,
            maxGuests,
            worldPack,
            // `stages` is the one gameSettings field deliberately not offered
            // here. It trades turn quality for speed on a slow local model,
            // which is an operator decision, not a table decision, so it
            // stays in the lobby's settings panel where the labels can
            // explain which stages actually save a model call.
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create the campaign.");
        return;
      }
      // House rules and starting lore land right after the campaign row
      // exists; anything that fails to post can be re-entered in the lobby.
      await submitWorldSetup(data.campaign.id, houseRules, loreDrafts);
      onCreated(data.campaign.id);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = ui.input;
  const toggleClass = (active: boolean) =>
    cn(
      "flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
      active
        ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
        : "border-stone-800 text-stone-400 hover:border-stone-600",
    );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[90vh] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto panel rounded-xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-display text-lg tracking-wide text-amber-50">
              {solo ? "New solo adventure" : "New campaign"}
            </Dialog.Title>
            <Dialog.Close className="rounded p-1 text-stone-400 hover:bg-stone-900">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="space-y-4 text-sm">
            <label className="block">
              <span className="mb-1 block text-stone-400">Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={80}
                placeholder="Curse of the Ash Kingdom"
                className={inputClass}
              />
            </label>

            {franchises.length ? (
              <div>
                <span className="mb-1 block text-stone-400">Pre-built world (optional)</span>
                <select
                  value={worldPack}
                  onChange={(event) => {
                    const next = packs.find((pack) => pack.id === event.target.value);
                    if (next) {
                      choosePack(next);
                    } else {
                      clearPack();
                    }
                  }}
                  className={inputClass}
                >
                  <option value="">No pack (plain setting)</option>
                  {franchises.map((group) =>
                    // A franchise with one era is a single row. One with several
                    // gets an optgroup, so the eras stay grouped under the name
                    // without the list needing its own expand step.
                    group.editions.length === 1 ? (
                      <option key={group.franchise} value={group.editions[0].id}>
                        {group.editions[0].name}
                      </option>
                    ) : (
                      <optgroup key={group.franchise} label={group.franchise}>
                        {group.editions.map((edition) => (
                          <option key={edition.id} value={edition.id}>
                            {edition.edition || edition.name}
                          </option>
                        ))}
                      </optgroup>
                    ),
                  )}
                </select>
                {selectedPack ? (
                  <>
                    <p className="mt-1 text-xs text-stone-500">{selectedPack.blurb}</p>
                    <UnofficialPackNotice
                      rightsHolder={selectedPack.rightsHolder}
                      inspiredBy={selectedPack.inspiredBy}
                      className="mt-1.5"
                    />
                  </>
                ) : (
                  <p className="mt-1 text-xs text-stone-500">
                    A pre-built world renames the races, classes, spells and monsters to fit it, and
                    tells the DM how it sounds. Every rule stays 5e.
                  </p>
                )}
              </div>
            ) : null}

            <div>
              <span className="mb-1.5 block text-stone-400">Setting</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GENRE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      // Picking a bare genre by hand leaves the pack. A pack
                      // is defined as its baseGenre plus overrides, so letting
                      // the two disagree would blend the pack's flavor over
                      // the wrong preset and overlay its monsters onto the
                      // wrong bestiary catalog.
                      if (worldPack) {
                        clearPack();
                      }
                      setGenre(preset.id);
                    }}
                    title={preset.blurb}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs transition-colors",
                      genre === preset.id
                        ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
                        : "border-stone-800 text-stone-400 hover:border-stone-600",
                    )}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {GENRE_PRESETS.find((preset) => preset.id === genre)?.blurb}
              </p>
              {genre === "custom" ? (
                <textarea
                  value={customGenreText}
                  onChange={(event) => setCustomGenreText(event.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Describe the world and tone in your own words..."
                  className={cn(inputClass, "mt-2")}
                />
              ) : null}
            </div>

            <label className="block">
              <span className="mb-1 block text-stone-400">
                Premise (optional{aiStorySetup ? "; the AI fills this in if left blank" : ""})
              </span>
              <textarea
                value={description}
                onChange={(event) => {
                  descriptionTouched.current = true;
                  setDescription(event.target.value);
                }}
                rows={2}
                maxLength={500}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-stone-400">World or theme notes</span>
              <input
                value={theme}
                onChange={(event) => {
                  themeTouched.current = true;
                  setTheme(event.target.value);
                }}
                maxLength={120}
                placeholder="Low-magic gritty, homebrew fey court, neon-drenched megacity..."
                className={inputClass}
              />
            </label>

            <div className={cn("grid gap-3", solo ? "grid-cols-2" : "grid-cols-3")}>
              {!solo ? (
                <label className="block">
                  <span className="mb-1 block text-stone-400">Players</span>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={maxPlayers}
                    onChange={(event) => setMaxPlayers(Number(event.target.value))}
                    className={inputClass}
                  />
                </label>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-stone-400">Start level</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={startingLevel}
                  onChange={(event) => setStartingLevel(Number(event.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">Difficulty</span>
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as CampaignDifficulty)}
                  className={inputClass}
                >
                  {CAMPAIGN_DIFFICULTIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-stone-400">Campaign length</span>
              <select
                value={campaignLength}
                onChange={(event) => setCampaignLength(event.target.value as CampaignLengthSetting)}
                className={inputClass}
              >
                {CAMPAIGN_LENGTHS.map((value) => (
                  <option key={value} value={value}>
                    {CAMPAIGN_LENGTH_LABELS[value]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-stone-500">
                How far the DM plans the story ahead. Any length keeps going if you play past the
                finale: a sequel saga picks up where the last one ended.
              </p>
            </label>

            <div>
              <span className="mb-1.5 block text-stone-400">Dice</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDicePolicy("digital_only")}
                  className={toggleClass(dicePolicy === "digital_only")}
                >
                  <span className="block font-medium">Digital only</span>
                  <span className="block text-xs opacity-80">The server rolls everything</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDicePolicy("real_allowed")}
                  className={toggleClass(dicePolicy === "real_allowed")}
                >
                  <span className="block font-medium">Real dice allowed</span>
                  <span className="block text-xs opacity-80">
                    {solo
                      ? "Roll at your desk and enter the numbers"
                      : "Players may opt in to rolling at the table"}
                  </span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setAiStorySetup(!aiStorySetup)}
                className={toggleClass(aiStorySetup)}
              >
                <span className="block font-medium">AI story setup</span>
                <span className="block text-xs opacity-80">The DM invents the plot</span>
              </button>
              <button
                type="button"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={toggleClass(ttsEnabled)}
              >
                <span className="block font-medium">Voice narration</span>
                <span className="block text-xs opacity-80">Spoken DM narration</span>
              </button>
              <button
                type="button"
                onClick={() => setMapsEnabled(!mapsEnabled)}
                className={toggleClass(mapsEnabled)}
              >
                <span className="block font-medium">Maps</span>
                <span className="block text-xs opacity-80">AI-drawn area maps</span>
              </button>
              <button
                type="button"
                onClick={() => setMulticlassingEnabled(!multiclassingEnabled)}
                className={toggleClass(multiclassingEnabled)}
              >
                <span className="block font-medium">Multiclassing</span>
                <span className="block text-xs opacity-80">Second classes at level-up</span>
              </button>
              <div className="relative flex">
                <button
                  type="button"
                  onClick={() => setWorldSimulation(!worldSimulation)}
                  className={toggleClass(worldSimulation)}
                >
                  <span className="block font-medium">Living world</span>
                  <span className="block text-xs opacity-80">
                    Off-screen schemes and rumors advance on their own
                  </span>
                </button>
                <InfoButton
                  label="What does Living World do?"
                  text={LIVING_WORLD_INFO}
                  className="absolute right-1.5 top-1.5"
                />
              </div>
              <button
                type="button"
                onClick={() => setInventoryApprovals(!inventoryApprovals)}
                className={toggleClass(inventoryApprovals)}
              >
                <span className="block font-medium">Item offers</span>
                <span className="block text-xs opacity-80">
                  Players confirm DM loot and gold changes
                </span>
              </button>
              <div className="relative flex">
                <button
                  type="button"
                  onClick={() => setRelationships(relationships === "off" ? "on" : "off")}
                  className={toggleClass(relationships !== "off")}
                >
                  <span className="block font-medium">Bonds</span>
                  <span className="block text-xs opacity-80">
                    NPCs remember how each character treated them
                  </span>
                </button>
                <InfoButton
                  label="What are Bonds?"
                  text={BONDS_INFO}
                  className="absolute right-1.5 top-1.5"
                />
              </div>
              {relationships !== "off" ? (
                <div className="relative flex">
                  <button
                    type="button"
                    onClick={() => setRomance(romance === "off" ? "on" : "off")}
                    className={toggleClass(romance !== "off")}
                  >
                    <span className="block font-medium">Romance</span>
                    <span className="block text-xs opacity-80">
                      Bonds can grow into a relationship
                    </span>
                  </button>
                  <InfoButton
                    label="How does Romance work?"
                    text={ROMANCE_INFO}
                    className="absolute right-1.5 top-1.5"
                  />
                </div>
              ) : null}
              <div className="relative flex">
                <button
                  type="button"
                  onClick={() => setNarrationGuard(!narrationGuard)}
                  className={toggleClass(narrationGuard)}
                >
                  <span className="block font-medium">Outcome check</span>
                  <span className="block text-xs opacity-80">
                    Narration that contradicts the dice is rewritten
                  </span>
                </button>
                <InfoButton
                  label="What is the outcome check?"
                  text={NARRATION_GUARD_INFO}
                  className="absolute right-1.5 top-1.5"
                />
              </div>
              {!solo ? (
                <button
                  type="button"
                  onClick={() => setMidGameJoinOpen(!midGameJoinOpen)}
                  className={toggleClass(midGameJoinOpen)}
                >
                  <span className="block font-medium">Mid-game joining</span>
                  <span className="block text-xs opacity-80">
                    New players can use the invite code after the start
                  </span>
                </button>
              ) : null}
              {!solo ? (
                <button
                  type="button"
                  onClick={() => setHoldSubmissions(!holdSubmissions)}
                  className={toggleClass(holdSubmissions)}
                >
                  <span className="block font-medium">Held responses</span>
                  <span className="block text-xs opacity-80">
                    Nobody acts until the party lead opens the floor
                  </span>
                </button>
              ) : null}
            </div>

            <VariantRulesFields value={variantRules} onChange={setVariantRules} />

            <WorldSetupFields
              houseRules={houseRules}
              setHouseRules={setHouseRules}
              loreDrafts={loreDrafts}
              setLoreDrafts={setLoreDrafts}
            />

            <div>
              <span className="mb-1.5 block text-stone-400">AI allies</span>
              <select
                value={companions}
                onChange={(event) =>
                  setCompanions(event.target.value as GameSettings["companions"])
                }
                className={inputClass}
              >
                {(Object.keys(COMPANION_LABELS) as Array<GameSettings["companions"]>).map(
                  (mode) => (
                    <option key={mode} value={mode}>
                      {COMPANION_LABELS[mode]}
                    </option>
                  ),
                )}
              </select>
              <p className="mt-1 text-xs text-stone-500">
                {solo
                  ? "Party members travel with you until dismissed; guests are allies who show up for a scene or a battle and then leave."
                  : "Guests are friendly NPCs the DM brings in for a scene or a battle; they fight with real stats and leave when the fight ends. Party members stay until dismissed."}
              </p>
              {companions !== "off" ? (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {companions !== "guests" ? (
                    <label className="block">
                      <span className="mb-1 block text-xs text-stone-500">Party members at once</span>
                      <select
                        value={maxCompanions}
                        onChange={(event) => setMaxCompanions(Number(event.target.value))}
                        className={inputClass}
                      >
                        {[1, 2, 3, 4].map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="block">
                    <span className="mb-1 block text-xs text-stone-500">Guests at once</span>
                    <select
                      value={maxGuests}
                      onChange={(event) => setMaxGuests(Number(event.target.value))}
                      className={inputClass}
                    >
                      {[1, 2, 3, 4].map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>

            {ttsEnabled ? (
              <div className="block">
                <span className="mb-1 block text-stone-400">Narrator voice</span>
                <div className="flex items-center gap-2">
                  <select
                    value={ttsVoice}
                    onChange={(event) => setTtsVoice(event.target.value)}
                    className={inputClass}
                  >
                    {TTS_VOICES.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label}
                      </option>
                    ))}
                  </select>
                  <VoicePreviewButton voice={ttsVoice} />
                </div>
              </div>
            ) : null}

            {error ? <p className="text-red-400">{error}</p> : null}
            <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "w-full")}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {solo ? "Create adventure" : "Create campaign"}
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
