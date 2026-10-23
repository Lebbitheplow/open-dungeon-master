"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GoldTitle } from "@/components/ui/GoldTitle";
import { Wizard, type WizardStep } from "@/components/ui/Wizard";
import { submitWorldSetup, worldSetupProblems, type WorldSetupLeft } from "@/app/WorldSetupFields";
import { submitContentImport } from "@/app/workshop/ContentImportPicker";
import type { CampaignDefaults, CampaignDefaultSettings } from "@/lib/campaign-defaults";
import { groupByFranchise, type WorldPackSummary } from "@/lib/worlds/summary";
import { genrePreset } from "@/lib/genres";
import type { Genre } from "@/lib/schemas/game-settings";
import { applyPack, clearPack, DEFAULT_DRAFT, type CampaignDraft, type WizardGates } from "@/app/create-campaign/draft";
import { appDefaultSettings, applyDefaults, defaultsFromDraft } from "@/app/create-campaign/defaults";
import { DefaultsBar, DefaultsDialog, DefaultsPanel, type DefaultsActions, type StartFrom } from "@/app/create-campaign/DefaultsFields";
import { presetTheme } from "@/app/create-campaign/portals";
import { EssentialsStep } from "@/app/create-campaign/EssentialsStep";
import { ExperienceStep } from "@/app/create-campaign/ExperienceStep";
import { ReviewStep, type EditTarget } from "@/app/create-campaign/ReviewStep";
import type { GroupId, StepKey } from "@/app/create-campaign/groups";
import { useCampaignDefaults } from "@/app/create-campaign/useCampaignDefaults";
import { withCapabilities, type ServerCapabilities } from "@/app/create-campaign/capabilities";
import { campaignPayload } from "@/app/create-campaign/payload";

const STEP_KEYS: readonly StepKey[] = ["essentials", "experience", "review"];

// The new-campaign wizard: three screens over one draft (src/app/create-
// campaign/draft.ts). The essentials, then how the table feels, then the
// review, with every other choice in named groups a first campaign can leave
// closed (docs/campaign-creator-guided-setup-plan.md). The steps only draw
// fields; every default, every gate and the payload that leaves for the
// server are decided here.
//
// solo: creates a one-player campaign (maxPlayers 1); the player count is
// hidden and the lobby streamlines itself for a party of one. Solo comes
// from the entry point, never from a party size of one.
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
  // Every write goes through here, from handlers and callbacks only, so the
  // ref is always the draft as last written: a save pressed right after
  // typing reads the line just typed.
  const latest = useRef(draft);
  const write = (next: CampaignDraft) => {
    latest.current = next;
    setDraft(next);
  };
  // Whether the person has changed anything themselves: saved defaults that
  // arrive after that are offered, never laid over their work.
  const edited = useRef(false);
  // What they wanted where the server overrode it (withCapabilities).
  const wanted = useRef<Partial<Pick<CampaignDraft, "dmMode" | "ttsEnabled">>>({});
  const [step, setStep] = useState(0);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<GroupId>>(() => new Set());
  // Arrived at a step from the review's Edit, so the way back is offered.
  const [fromReview, setFromReview] = useState(false);
  // The campaign is made but part of what was chosen for it did not land
  // (workshop import audit F03): which campaign, what is left to send, and
  // what to tell the person. Until it clears, the button sends only that.
  const [followUp, setFollowUp] = useState<{ campaignId: string; left: WorldSetupLeft; importDone: boolean; problems: string[] } | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(0);
      setFromReview(false);
      setFollowUp(null);
    }
  }
  const [packs, setPacks] = useState<WorldPackSummary[]>([]);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  // The same answer for callbacks, which may run before the render that
  // carries it (saved defaults landing right after it).
  const capabilitiesNow = useRef<ServerCapabilities | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState<{ title: string; arcComing: boolean } | null>(null);
  const [startFrom, setStartFrom] = useState<StartFrom>("app");
  const [late, setLate] = useState(false);
  const [kept, setKept] = useState<string[]>([]);
  const [defaultsBusy, setDefaultsBusy] = useState(false);
  const [defaultsMessage, setDefaultsMessage] = useState<DefaultsActions["message"]>(null);
  const [managing, setManaging] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<GroupId | "top" | null>(null);

  const patch = (changes: Partial<CampaignDraft>) => {
    edited.current = true;
    // A choice the person made themselves replaces what they wanted before
    // the server overrode it; a field the patch leaves as it was does not.
    for (const key of Object.keys(wanted.current) as Array<keyof typeof wanted.current>) {
      if (key in changes && changes[key] !== latest.current[key]) {
        delete wanted.current[key];
      }
    }
    write({ ...latest.current, ...changes });
  };

  // Everything the AI narrator brings with it. A table running its own game
  // still gets the rules engine, the maps and the dice; what it does not get
  // is a second author, so those settings are hidden rather than shown
  // switched off with no explanation.
  const aiNarrates = draft.dmMode !== "human";

  // "Known missing" is an admin's positive statement (provider "none" or no
  // backend at all), which hides the AI seat. "Unreachable" is a configured
  // backend that is not answering, which keeps the seat but warns.
  const storyKnownMissing = capabilities ? !capabilities.story.configured : false;
  const storyUnreachable = capabilities ? capabilities.story.configured && !capabilities.story.reachable : false;
  const gates: WizardGates = {
    solo,
    aiNarrates,
    storyKnownMissing,
    storyUnreachable,
    ttsAvailable: capabilities ? capabilities.tts.configured : true,
    mapsAvailable: capabilities ? capabilities.images.configured : true,
  };

  const franchises = useMemo(() => groupByFranchise(packs), [packs]);
  const selectedPack = packs.find((pack) => pack.id === draft.worldPack) ?? null;

  // A saved setup (or the app's own) laid over the draft, then the server's
  // limits over that. The campaign's own fields stay (defaults.ts).
  const startFromSettings = (source: StartFrom, settings: CampaignDefaultSettings) => {
    const applied = applyDefaults(latest.current, settings, selectedPack);
    const limits = capabilitiesNow.current;
    const limited = limits ? withCapabilities(applied.draft, limits) : { draft: applied.draft, wanted: {} };
    wanted.current = limited.wanted;
    write(limited.draft);
    setKept(applied.kept);
    setStartFrom(source);
    setLate(false);
  };

  // Saved defaults, read each time the dialog opens: laid over a draft the
  // person has not touched, offered beside one they have.
  const onDefaultsLoaded = (found: CampaignDefaults | null) => {
    if (!found) {
      return;
    }
    if (edited.current) {
      setLate(true);
      setStartFrom("app");
      return;
    }
    startFromSettings("mine", found.settings);
  };
  const defaults = useCampaignDefaults(open, onDefaultsLoaded);

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
        capabilitiesNow.current = data;
        setCapabilities(data);
        // Defaults follow reality: a table should not discover on turn one
        // that the AI seat was never fillable.
        const limited = withCapabilities(latest.current, data);
        Object.assign(wanted.current, limited.wanted);
        write(limited.draft);
      })
      .catch(() => {
        // No answer is not "no AI": without capabilities the dialog offers
        // everything, exactly as it did before the endpoint existed.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const choosePack = (pack: WorldPackSummary) => patch(applyPack(latest.current, pack));
  // Leaving a pack hands the theme back to the genre's preset, unless the
  // person typed their own.
  const dropPack = () => patch(presetTheme(clearPack(latest.current, selectedPack)));
  // Picking a bare genre by hand leaves the pack. A pack is defined as its
  // baseGenre plus overrides, so letting the two disagree would blend the
  // pack's flavor over the wrong preset and overlay its monsters onto the
  // wrong bestiary catalog.
  const pickGenre = (genre: Genre) =>
    patch(presetTheme({ ...(latest.current.worldPack ? clearPack(latest.current, selectedPack) : latest.current), genre }));

  // Saving reads the draft after a half-typed line or veil has been kept: an
  // input still holding focus is blurred first, and the save waits a turn
  // for the blur's write. What the person wanted where the server overrode it
  // is what is saved.
  const saveDefaults = () => {
    const focused = typeof document === "undefined" ? null : document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
      focused.blur();
    }
    setDefaultsMessage(null);
    setDefaultsBusy(true);
    setTimeout(() => {
      void defaults.save(defaultsFromDraft({ ...latest.current, ...wanted.current })).then((outcome) => {
        setDefaultsBusy(false);
        if (outcome.ok) {
          setStartFrom("mine");
          setLate(false);
          setDefaultsMessage({ tone: "ok", text: "Saved. Campaigns you make from now on start from these choices." });
        } else {
          setDefaultsMessage({ tone: "error", text: `${outcome.error} Nothing here changed, and you can still create the campaign.` });
        }
      });
    }, 0);
  };

  const defaultsActions: DefaultsActions = {
    state: defaults.state,
    startFrom,
    late,
    kept,
    busy: defaultsBusy,
    message: defaultsMessage,
    onUseMine: () => {
      if (defaults.state.status === "saved") {
        startFromSettings("mine", defaults.state.defaults.settings);
        setDefaultsMessage({ tone: "ok", text: "This campaign now starts from your defaults." });
      }
    },
    onUseApp: () => {
      startFromSettings("app", appDefaultSettings());
      setDefaultsMessage({ tone: "ok", text: "This campaign now starts from the app's defaults." });
    },
    onSave: saveDefaults,
    onRemove: () => {
      setDefaultsBusy(true);
      void defaults.remove().then((outcome) => {
        setDefaultsBusy(false);
        setStartFrom("app");
        setDefaultsMessage(
          outcome.ok
            ? { tone: "ok", text: "Removed. New campaigns start from the app's defaults; this one keeps what it has." }
            : { tone: "error", text: outcome.error },
        );
      });
    },
    onManage: () => setManaging(true),
  };

  const groups = {
    isOpen: (id: GroupId) => openGroups.has(id),
    setOpen: (id: GroupId, isOpen: boolean) =>
      setOpenGroups((current) => {
        const next = new Set(current);
        if (isOpen) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      }),
  };

  // The review's Edit: the step it names, the group opened, and the way back
  // offered on that step. Nothing in the draft moves.
  const editFrom = (target: EditTarget) => {
    if (target.group) {
      groups.setOpen(target.group, true);
    }
    pendingFocus.current = target.group ?? "top";
    setFromReview(true);
    setStep(STEP_KEYS.indexOf(target.step));
  };
  // Once the step is on screen, its group is brought to the top of the pane
  // and its heading takes focus (after the wizard's own focus on the title);
  // a row with no group of its own starts the step from the top.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) {
      return;
    }
    pendingFocus.current = null;
    if (id === "top") {
      shell.current?.querySelector<HTMLElement>("section[data-active]")?.scrollTo({ top: 0 });
      return;
    }
    const group = shell.current?.querySelector<HTMLElement>(`section[data-active] [data-group="${id}"]`);
    const pane = group?.closest<HTMLElement>("section[data-active]");
    if (group && pane) {
      pane.scrollTop += group.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8;
      group.querySelector<HTMLElement>(".cc-group-toggle")?.focus({ preventScroll: true });
    }
  }, [step]);

  async function submit() {
    if (busy || (solo && storyKnownMissing)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      // A campaign this dialog already made is not made twice: pressing the
      // button again sends only what did not land the first time.
      let campaignId = followUp?.campaignId ?? null;
      let left: WorldSetupLeft = followUp?.left ?? { houseRules: latest.current.houseRules, loreDrafts: latest.current.loreDrafts };
      let importDone = followUp?.importDone ?? false;
      if (!campaignId) {
        const response = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(campaignPayload(latest.current, { solo, aiNarrates: latest.current.dmMode !== "human" })),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error || "Could not create the campaign.");
          return;
        }
        campaignId = String(data.campaign.id);
      }
      // House rules and starting lore land right after the campaign row
      // exists.
      left = await submitWorldSetup(campaignId, left.houseRules, left.loreDrafts);
      const problems = worldSetupProblems(left);
      // The workshop import goes last so its house rules win over the ones
      // typed in this dialog: choosing a prepared workshop is the more
      // deliberate of the two, and the picker says which it will do. What it
      // brought is kept by the campaign, so asking again after a failure
      // brings only what is still missing.
      if (!importDone) {
        const imported = await submitContentImport(campaignId, latest.current.contentImport);
        importDone = !imported || imported.ok;
        if (imported && !imported.ok) {
          problems.push(`${prep?.title ?? "The prep you chose"} did not come in: ${imported.error}`);
        }
      }
      if (problems.length) {
        setFollowUp({ campaignId, left, importDone, problems });
        return;
      }
      setFollowUp(null);
      onCreated(campaignId);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const stepProps = { draft, patch, gates };
  const title = solo ? "New solo adventure" : "New campaign";
  const activeKey = STEP_KEYS[Math.min(Math.max(step, 0), STEP_KEYS.length - 1)];
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
  const backToReview = fromReview ? (
    <div className="cc-return">
      <span className="min-w-0 flex-1">Editing from the review. Nothing you set is lost.</span>
      <button type="button" className="cc-link" onClick={() => setStep(STEP_KEYS.indexOf("review"))}>
        Back to review
      </button>
    </div>
  ) : null;
  const hasTitle = draft.title.trim().length > 0;

  const steps = [
    {
      key: "essentials",
      label: "Essentials",
      title: heading("essentials", "The essentials", solo ? "What is this adventure?" : "What is this campaign?"),
      blurb: "A name, who runs it, the party and the world. The groups at the bottom can wait.",
      content: (
        <>
          {backToReview}
          <EssentialsStep
            {...stepProps}
            active={activeKey === "essentials"}
            titleRef={titleRef}
            defaultsBar={<DefaultsBar actions={defaultsActions} />}
            groups={groups}
            packs={packs}
            franchises={franchises}
            selectedPack={selectedPack}
            prepSource={prep?.title ?? null}
            onChoosePack={choosePack}
            onClearPack={dropPack}
            onPickGenre={pickGenre}
            onPrepChosen={setPrep}
          />
        </>
      ),
      canContinue: hasTitle,
      blocker: hasTitle ? null : solo ? "Name the adventure first." : "Name the campaign first.",
      onBlocked: () => titleRef.current?.focus(),
    },
    {
      key: "experience",
      label: "Experience",
      title: heading("experience", "The experience", "How does this table feel?"),
      blurb: "How the table sounds first, then its atmosphere and safety. All of it can change later in the lobby too.",
      content: (
        <>
          {backToReview}
          <ExperienceStep {...stepProps} active={activeKey === "experience"} groups={groups} />
        </>
      ),
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
          prep={prep}
          error={error}
          followUp={
            followUp
              ? {
                  problems: followUp.problems,
                  busy,
                  onOpen: () => {
                    const id = followUp.campaignId;
                    setFollowUp(null);
                    onCreated(id);
                  },
                }
              : null
          }
          onEdit={editFrom}
          defaultsPanel={<DefaultsPanel actions={defaultsActions} />}
        />
      ),
      canContinue: !busy && !(solo && storyKnownMissing),
    },
  ] satisfies Array<WizardStep & { key: StepKey }>;

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
        <Dialog.Content
          ref={shell}
          className="cc-shell panel fixed left-1/2 top-1/2 z-50 flex h-[min(90vh,46rem)] w-[min(96vw,34rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl p-4 sm:p-6 lg:w-[min(96vw,60rem)]"
        >
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
            // The diamonds go forward too once the name is in, so a person who
            // only wants the review can go straight there.
            jumpAhead
            steps={steps}
            step={step}
            onStepChange={setStep}
            onDone={() => void submit()}
            onCancel={() => onOpenChange(false)}
            doneLabel={
              <>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {followUp ? "Try again" : solo ? "Create adventure" : "Create campaign"}
              </>
            }
            className="[&>header]:pr-9"
          />
          <DefaultsDialog open={managing} onOpenChange={setManaging} actions={defaultsActions} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
