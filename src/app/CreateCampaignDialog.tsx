"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GoldTitle } from "@/components/ui/GoldTitle";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { submitWorldSetup } from "@/app/WorldSetupFields";
import { submitContentImport } from "@/app/workshop/ContentImportPicker";
import { groupByFranchise, type WorldPackSummary } from "@/lib/worlds/summary";
import { genrePreset } from "@/lib/genres";
import type { Genre } from "@/lib/schemas/game-settings";
import {
  applyPack,
  clearPack,
  DEFAULT_DRAFT,
  type CampaignDraft,
  type WizardGates,
} from "@/app/create-campaign/draft";
import { presetTheme } from "@/app/create-campaign/portals";
import { PremiseStep } from "@/app/create-campaign/PremiseStep";
import { WorldStep } from "@/app/create-campaign/WorldStep";
import { PartyStep } from "@/app/create-campaign/PartyStep";
import { FeelStep } from "@/app/create-campaign/FeelStep";
import { AdvancedStep } from "@/app/create-campaign/AdvancedStep";
import { ReviewStep } from "@/app/create-campaign/ReviewStep";

// The slice of /api/capabilities this dialog gates on. null means the
// endpoint never answered, and the dialog assumes everything is available:
// a flaky capability check must never block creating a campaign.
type ServerCapabilities = {
  story: { configured: boolean; reachable: boolean };
  images: { configured: boolean };
  tts: { configured: boolean };
};

const STEP_KEYS = ["premise", "world", "party", "feel", "advanced", "review"] as const;
type StepKey = (typeof STEP_KEYS)[number];

// The new-campaign wizard: six screens over one draft (src/app/create-
// campaign/draft.ts), paced one decision at a time instead of one long form.
// The steps only draw fields; every default, every gate and the payload that
// leaves for the server are decided here.
//
// solo: creates a one-player campaign (maxPlayers 1); the player count is
// hidden and the lobby streamlines itself for a party of one.
//
// Some game settings are deliberately not offered here; scripts/test-create-
// campaign-options.mjs holds the list and fails if one goes missing without a
// reason. `targetParty` is one of them: it is the stand-in party a workshop
// budgets prep against, and a campaign reads its real character sheets
// instead (docs/workshop-plan.md section 1.1).
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
  // The default genre's preset writes the first theme, exactly as picking any
  // other portal would; typing in the field takes it over for good.
  const [draft, setDraft] = useState<CampaignDraft>(() => presetTheme(DEFAULT_DRAFT));
  // The wizard's step is held here so each step can be told when it is the
  // one on screen: every step is mounted at once, and an entrance should play
  // when it is seen. It starts over each time the dialog opens, as it did
  // while the wizard kept it.
  const [step, setStep] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(0);
    }
  }
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const patch = (changes: Partial<CampaignDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));

  // Everything the AI narrator brings with it. A table running its own game
  // still gets the rules engine, the maps and the dice; what it does not get
  // is a second author, so those settings are hidden rather than shown
  // switched off with no explanation.
  const aiNarrates = draft.dmMode !== "human";

  // "Known missing" is an admin's positive statement (provider "none" or no
  // backend at all), which hides the AI seat. "Unreachable" is a configured
  // backend that is not answering, which keeps the seat but warns.
  const storyKnownMissing = capabilities ? !capabilities.story.configured : false;
  const storyUnreachable = capabilities
    ? capabilities.story.configured && !capabilities.story.reachable
    : false;
  const gates: WizardGates = {
    solo,
    aiNarrates,
    storyKnownMissing,
    storyUnreachable,
    ttsAvailable: capabilities ? capabilities.tts.configured : true,
    mapsAvailable: capabilities ? capabilities.images.configured : true,
  };

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
    void fetch("/api/capabilities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: ServerCapabilities | null) => {
        if (cancelled || !data?.story) {
          return;
        }
        setCapabilities(data);
        // Defaults follow reality: a table should not discover on turn one
        // that the AI seat was never fillable.
        setDraft((current) => ({
          ...current,
          dmMode: !data.story.configured || !data.story.reachable ? "human" : current.dmMode,
          ttsEnabled: data.tts?.configured ? current.ttsEnabled : false,
          mapsEnabled: data.images?.configured ? current.mapsEnabled : false,
        }));
      })
      .catch(() => {
        // No answer is not "no AI": without capabilities the dialog offers
        // everything, exactly as it did before the endpoint existed.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const franchises = useMemo(() => groupByFranchise(packs), [packs]);
  const selectedPack = packs.find((pack) => pack.id === draft.worldPack) ?? null;

  const choosePack = (pack: WorldPackSummary) => setDraft((current) => applyPack(current, pack));
  // Leaving a pack hands the theme back to the genre's preset, unless the
  // person typed their own.
  const dropPack = () => setDraft((current) => presetTheme(clearPack(current, selectedPack)));
  // Picking a bare genre by hand leaves the pack. A pack is defined as its
  // baseGenre plus overrides, so letting the two disagree would blend the
  // pack's flavor over the wrong preset and overlay its monsters onto the
  // wrong bestiary catalog.
  const pickGenre = (genre: Genre) =>
    setDraft((current) =>
      presetTheme({
        ...(current.worldPack ? clearPack(current, selectedPack) : current),
        genre,
      }),
    );

  async function submit() {
    if (busy || (solo && storyKnownMissing)) {
      return;
    }
    const {
      title,
      description,
      theme,
      maxPlayers,
      startingLevel,
      difficulty,
      dmMode,
      genre,
      customGenreText,
      aiStorySetup,
      campaignLength,
      dicePolicy,
      ttsEnabled,
      ttsVoice,
      mapsEnabled,
      ambienceEnabled,
      ambienceAuto,
      boardDrawing,
      enemyIntent,
      presentation,
      multiCharacter,
      multiclassingEnabled,
      midGameJoinOpen,
      holdSubmissions,
      narrationGuard,
      safety,
      gm,
      relationships,
      romance,
      worldSimulation,
      inventoryApprovals,
      variantRules,
      companions,
      maxCompanions,
      maxGuests,
      worldPack,
      voiceChat,
      houseRules,
      loreDrafts,
      contentImport,
    } = draft;
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
            dmMode,
            genre,
            customGenreText: customGenreText.trim(),
            aiStorySetup: aiNarrates && aiStorySetup,
            campaignLength,
            dicePolicy,
            ttsEnabled,
            ttsVoice,
            mapsEnabled,
            ambienceEnabled,
            ambienceAuto: ambienceEnabled && ambienceAuto,
            boardDrawing,
            enemyIntent,
            presentation,
            multiCharacter,
            multiclassingEnabled,
            midGameJoinOpen,
            holdSubmissions,
            narrationGuard: aiNarrates && narrationGuard,
            safety,
            gm,
            relationships,
            // Romance rides on the bond meter, so it cannot be on without it.
            romance: relationships === "off" ? "off" : romance,
            worldSimulation: aiNarrates && worldSimulation,
            inventoryApprovals,
            variantRules,
            companions: aiNarrates ? companions : "off",
            maxCompanions,
            maxGuests,
            worldPack,
            voice: voiceChat,
            // Three gameSettings fields are deliberately not offered here.
            //
            // `stages` trades turn quality for speed on a slow local model,
            // which is an operator decision, not a table decision, so it
            // stays in the lobby's settings panel where the labels can
            // explain which stages actually save a model call.
            //
            // `beatReminder` is how often a human DM is nudged to write down
            // the story they told out loud. Nobody knows their answer before
            // they have run a session, and the nudge is the thing that
            // teaches them they want one, so it lives in the settings panel
            // they are already looking at when it fires.
            //
            // `dmAssist` is which parts of the game an assisted-mode DM hands
            // to the AI. Picking "I run the game, with AI help" on the first
            // step is already the answer to "do you want help"; which help,
            // and when, is a question a person answers at the table with the
            // console in front of them, so all three start on and the
            // settings panel shows them only once the mode is assisted.
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
      // The workshop import goes last so its house rules win over the ones
      // typed in this dialog: choosing a prepared workshop is the more
      // deliberate of the two, and the picker says which it will do.
      await submitContentImport(data.campaign.id, contentImport);
      onCreated(data.campaign.id);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const stepProps = { draft, patch, gates };
  const title = solo ? "New solo adventure" : "New campaign";

  // A step is dropped when nothing on it applies. Today every step keeps at
  // least one field in every mode (voice chat leaves the Advanced step on a
  // solo table, but the variant rules and prep stay), so the filter is there
  // for the mode that changes that, not for one that exists now.
  const applies: Record<StepKey, boolean> = {
    premise: true,
    world: true,
    party: true,
    feel: true,
    advanced: true,
    review: true,
  };
  const order = STEP_KEYS.filter((key) => applies[key]);
  const activeKey = order[Math.min(Math.max(step, 0), order.length - 1)];
  // The step's short name stays as the eyebrow; the question under it is the
  // gold title, which rises again each time its step comes on screen.
  const heading = (key: StepKey, name: string, question: string) => (
    <span className="block">
      <span className="cc-eyebrow block text-stone-500">{name}</span>
      <GoldTitle as="span" size="text-lg sm:text-xl" animate={activeKey === key} className="inline-block">
        {question}
      </GoldTitle>
    </span>
  );

  const steps = (
    [
      {
        key: "premise",
        label: "Premise",
        title: heading("premise", "The premise", solo ? "What is this adventure?" : "What is this campaign?"),
        blurb: solo ? "Name the adventure and decide who narrates." : "Name it and decide who runs the table.",
        content: (
          <PremiseStep
            {...stepProps}
            packs={packs}
            franchises={franchises}
            selectedPack={selectedPack}
            onChoosePack={choosePack}
            onClearPack={dropPack}
          />
        ),
        canContinue: draft.title.trim().length > 0,
      },
      {
        key: "world",
        label: "Setting",
        title: heading("world", "The world", "What kind of world is this?"),
        blurb:
          "Pick a setting and say what the story is about. Every setting is the same 5e underneath; what changes is how the Dungeon Master talks, what the maps look like, and who lives there.",
        continueLabel: `Continue in ${genrePreset(draft.genre).name}`,
        content: (
          <WorldStep
            {...stepProps}
            active={activeKey === "world"}
            selectedPack={selectedPack}
            onPickGenre={pickGenre}
          />
        ),
      },
      {
        key: "party",
        label: "Party",
        title: heading("party", "The party", solo ? "How strong, and how hard?" : "Who is playing, and how hard?"),
        blurb: solo ? "Where your hero begins." : "Who is adventuring, and how hard the road is.",
        content: <PartyStep {...stepProps} />,
      },
      {
        key: "feel",
        label: "The table",
        title: heading("feel", "The feel", "How does this table feel?"),
        blurb: "What is on at the table. Flip any of these later in the lobby too.",
        content: <FeelStep {...stepProps} active={activeKey === "feel"} />,
      },
      {
        key: "advanced",
        label: "Advanced",
        title: heading("advanced", "Advanced", "The parts you can skip"),
        blurb: "Variant rules, house rules, prep and live voice. All optional.",
        content: <AdvancedStep {...stepProps} />,
      },
      {
        key: "review",
        label: "Review",
        title: heading("review", "Review", "Here is what you made"),
        blurb: "Ready the table. The cover is the tile this will wear on the home screen until you paint it one.",
        content: (
          <ReviewStep
            {...stepProps}
            active={activeKey === "review"}
            selectedPack={selectedPack}
            error={error}
          />
        ),
        canContinue: !busy && !(solo && storyKnownMissing),
      },
    ] satisfies Array<WizardStep & { key: StepKey }>
  ).filter((entry) => applies[entry.key]);

  // The choices so far, in one quiet line in the header, so a later step
  // still says which world it is furnishing.
  const draftLine = [
    genrePreset(draft.genre).name,
    solo ? "solo" : `${draft.maxPlayers} players`,
    `level ${draft.startingLevel}`,
    draft.difficulty,
  ].join(" · ");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[#05030d]/70 backdrop-blur-sm" />
        {/* A fixed height rather than a cap: the wizard's steps sit side by
            side and each scrolls on its own, so the panel has to be the
            thing that decides how tall a step may be. 90vh reads as a full
            sheet on a phone; the rem cap keeps it a dialog on a monitor.
            Wide at lg so the eight portals sit four across; on a phone the
            panel takes nearly the whole width so they still fit two. */}
        <Dialog.Content className="cc-shell panel fixed left-1/2 top-1/2 z-50 flex h-[min(90vh,46rem)] w-[min(96vw,34rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl p-4 sm:p-6 lg:w-[min(96vw,60rem)]">
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            className="absolute right-3 top-3 z-10 rounded p-1 text-stone-400 hover:bg-stone-900 sm:right-5 sm:top-5"
          >
            <X className="size-4" />
          </Dialog.Close>
          <Wizard
            title={title}
            aside={<span className="pr-2">{draftLine}</span>}
            variant="diamonds"
            wipe
            steps={steps}
            step={step}
            onStepChange={setStep}
            onDone={() => void submit()}
            onCancel={() => onOpenChange(false)}
            doneLabel={
              <>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {solo ? "Create adventure" : "Create campaign"}
              </>
            }
            className="[&>header]:pr-9"
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
