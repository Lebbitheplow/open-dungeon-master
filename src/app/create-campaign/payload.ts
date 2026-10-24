import type { CampaignDraft, WizardGates } from "@/app/create-campaign/draft";

// What leaves for POST /api/campaigns: every setting the creator collects,
// normalized the way the server expects (AI-only settings off when a person
// narrates, romance only with bonds, the solo entry point's party of one).
// House rules, lore and imported prep are not in it: they are posted after
// the campaign row exists (CreateCampaignDialog.submit). Kept apart so
// scripts/test-create-campaign-options.mjs has one place to audit.
export function campaignPayload(draft: CampaignDraft, { solo, aiNarrates }: Pick<WizardGates, "solo" | "aiNarrates">) {
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
    tableLanguage,
    aiStorySetup,
    campaignLength,
    dicePolicy,
    ttsEnabled,
    ttsVoice,
    ttsSpeed,
    ttsAutoCast,
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
    vitalsApprovals,
    variantRules,
    companions,
    hpMethod,
    startingWealth,
    abilityRerollBelow,
    maxCompanions,
    maxGuests,
    worldPack,
    voiceChat,
  } = draft;
  return {
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
      tableLanguage,
      aiStorySetup: aiNarrates && aiStorySetup,
      campaignLength,
      dicePolicy,
      ttsEnabled,
      ttsVoice,
      ttsSpeed,
      ttsAutoCast,
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
      vitalsApprovals,
      variantRules,
      companions: aiNarrates ? companions : "off",
      hpMethod,
      startingWealth,
      abilityRerollBelow,
      maxCompanions,
      maxGuests,
      worldPack,
      voice: voiceChat,
      // These gameSettings fields are deliberately not offered here.
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
      //
      // `targetParty` is not a campaign setting at all: it is the stand-in
      // party a workshop budgets prep against, and a campaign reads its real
      // character sheets instead (docs/workshop-plan.md section 1.1).
      //
      // `narrationLength` and `styleNotes` say how the AI DM writes for this
      // table (issue 383). What its prose needs is learned by hearing it on
      // the table's model, so both start as no change at all and live in the
      // settings panel's AI group, where the lead tunes them after a session.
      // `combatPace` (issue #432) beside them, for the same reason: a table
      // learns it wants more fights or fewer by playing.
      //
      // `waitForTable` and `waitForTableSeconds` (PR #438): whether the AI DM
      // waits for everyone before it answers is learned once the table plays.
      // It starts on (a lone player is answered at once) and is the Players
      // group's Pacing picker.
      //
      // `companionConscience` (issue 503): how far a lasting companion goes
      // when the party's deeds break what it holds to. Leave is a safe
      // default, nothing is decided by it before the first scene, and it
      // matters only once a lasting companion travels with the party, so it
      // lives in the campaign's Bonds settings (AGENTS.md settings rule 2).
    },
  };
}
