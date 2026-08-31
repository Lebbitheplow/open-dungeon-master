// One switch from an adjudication name to the handler that performs it.
//
// Every arm calls exactly what turn.ts calls for the same tool. That is the
// point: there is one rules engine, and swapping the AI DM for a person
// swaps the caller, not the game.
import { handleCompleteBeat } from "@/lib/dm/arc";
import { handleCastBuff } from "@/lib/dm/cast-tools";
import { handleCheckNotice, handleGroupCheck } from "@/lib/dm/check-tools";
import { handleAddCompanion, handleDismissCompanion } from "@/lib/dm/companion-tools";
import { applyEncounterCall, ENCOUNTER_TOOL_NAMES } from "@/lib/dm/encounter-tools";
import { handleApplyHazard } from "@/lib/dm/hazard-tools";
import { handleSearchLore } from "@/lib/dm/lore-search";
import { applyDmMutation, MUTATION_TOOL_NAMES } from "@/lib/dm/mutations";
import { handleWriteCampaignNote } from "@/lib/dm/note-tools";
import {
  handleDamagePet,
  handleDismissPet,
  handlePetAttack,
  handleSummonPet,
} from "@/lib/dm/pet-tools";
import { handleRecallStory } from "@/lib/dm/recall";
import {
  handleRelationshipBeat,
  handleRelationshipEnd,
  handleRomanceAdvance,
} from "@/lib/dm/relationship-tools";
import { handleTakeRest } from "@/lib/dm/rest-tools";
import { handleNpcReaction, handleSetNpc, handleSocialCheck } from "@/lib/dm/social-tools";
import { handlePartyStash } from "@/lib/dm/party-tools";
import { handleClearEffect, handleSetEffect } from "@/lib/dm/effect-tools";
import { handleEndScene, handleSceneCheck, handleStartScene } from "@/lib/dm/scene-tools";
import { handlePlaySting, handleSetAmbience } from "@/lib/dm/ambience-tools";
import { handleDismount, handleMountUp } from "@/lib/dm/mount-tools";
import {
  handleDamageObject,
  handlePassTime,
  handleRollTreasure,
  handleTravel,
} from "@/lib/dm/world-tools";
import { handleSendWhisper } from "@/lib/dm/whispers";
import {
  handleLocationCall,
  handleRecordEvent,
  handleRequestPlayerInput,
} from "@/lib/dm/turn";
import { handleGenerateImage } from "@/lib/dm/images";
import { handleRequestRoll } from "@/lib/dm/invoke-roll";
import { handleSplitDamage } from "@/lib/dm/split-damage";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const MUTATIONS = new Set<string>(MUTATION_TOOL_NAMES);
const ENCOUNTERS = new Set<string>(ENCOUNTER_TOOL_NAMES);

export type DispatchContext = {
  campaign: Campaign;
  turn: DmTurn;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  realDiceUserIds: Set<string>;
};

export async function dispatchAdjudication(
  name: string,
  rawArguments: string,
  context: DispatchContext,
): Promise<Record<string, unknown>> {
  const { campaign, turn, sheets, sheetsById } = context;

  if (MUTATIONS.has(name)) {
    return applyDmMutation(campaign, turn.id, name, rawArguments, sheets, sheetsById).result;
  }
  if (ENCOUNTERS.has(name)) {
    return applyEncounterCall(campaign, turn, name, rawArguments, sheets, sheetsById, {
      realDiceUserIds: context.realDiceUserIds,
      toolCallId: null,
    }).result;
  }

  switch (name) {
    case "request_roll":
      return handleRequestRoll(
        campaign,
        turn,
        rawArguments,
        sheets,
        sheetsById,
        context.realDiceUserIds,
      );
    case "cast_buff":
      return handleCastBuff(campaign, turn, rawArguments, sheets, sheetsById);
    case "take_rest":
      return handleTakeRest(campaign, turn.id, rawArguments, sheets, sheetsById);
    case "group_check":
      return handleGroupCheck(campaign, turn, rawArguments, sheets, sheetsById);
    case "check_notice":
      return handleCheckNotice(campaign, rawArguments, sheets, sheetsById);
    case "split_damage":
      return handleSplitDamage(campaign, turn, rawArguments, sheets, sheetsById);
    case "apply_hazard":
      return handleApplyHazard(campaign, turn, rawArguments, sheets, sheetsById);
    case "summon_pet":
      return handleSummonPet(campaign, turn, rawArguments, sheets, sheetsById);
    case "pet_attack":
      return handlePetAttack(campaign, turn, rawArguments, sheets, sheetsById);
    case "damage_pet":
      return handleDamagePet(campaign, rawArguments, sheets, sheetsById);
    case "dismiss_pet":
      return handleDismissPet(campaign, rawArguments, sheets, sheetsById);
    case "set_npc":
      return handleSetNpc(campaign, rawArguments);
    case "npc_reaction":
      return handleNpcReaction(campaign, turn, rawArguments);
    case "social_check":
      return handleSocialCheck(campaign, turn, rawArguments, sheets, sheetsById);
    case "relationship_beat":
      return handleRelationshipBeat(campaign, turn, rawArguments, sheets, sheetsById);
    case "romance_advance":
      return handleRomanceAdvance(campaign, turn, rawArguments, sheets, sheetsById);
    case "relationship_end":
      return handleRelationshipEnd(campaign, rawArguments, sheets, sheetsById);
    case "roll_treasure":
      return handleRollTreasure(campaign, turn, rawArguments, sheets, sheetsById);
    case "travel":
      return handleTravel(campaign, turn, rawArguments, sheets, sheetsById);
    case "pass_time":
      return handlePassTime(campaign, rawArguments);
    case "party_stash":
      return handlePartyStash(campaign, rawArguments, sheets, sheetsById);
    case "set_effect":
      return handleSetEffect(campaign, rawArguments, sheets, sheetsById);
    case "clear_effect":
      return handleClearEffect(campaign, rawArguments, sheets, sheetsById);
    case "start_scene":
      return handleStartScene(campaign, rawArguments);
    case "scene_check":
      return handleSceneCheck(campaign, rawArguments, sheets, sheetsById);
    case "end_scene":
      return handleEndScene(campaign, rawArguments);
    case "set_ambience":
      return handleSetAmbience(campaign, rawArguments);
    case "play_sting":
      return handlePlaySting(campaign, rawArguments);
    case "mount_up":
      return handleMountUp(campaign, rawArguments, sheets, sheetsById);
    case "dismount":
      return handleDismount(campaign, rawArguments, sheets, sheetsById);
    case "damage_object":
      return handleDamageObject(rawArguments);
    case "add_companion":
      return handleAddCompanion(campaign, rawArguments, sheets);
    case "dismiss_companion":
      return handleDismissCompanion(campaign, rawArguments, sheets);
    case "move_party":
    case "update_location": {
      const result = handleLocationCall(campaign, name, rawArguments);
      // Bookkeeping the model's turn uses to link its narration to a map;
      // a person's narration is a separate message, so it goes no further.
      delete result.movedToNewLocation;
      delete result._locationId;
      delete result._mapAvailable;
      return result;
    }
    case "request_player_input":
      return handleRequestPlayerInput(campaign, rawArguments, sheets, sheetsById);
    case "generate_image":
      return handleGenerateImage(campaign, rawArguments);
    case "record_event":
      return handleRecordEvent(campaign, rawArguments, sheets, sheetsById);
    case "complete_beat":
      return handleCompleteBeat(campaign.id, rawArguments, false).result;
    case "write_campaign_note":
      return handleWriteCampaignNote(campaign, rawArguments);
    case "send_whisper":
      return handleSendWhisper(campaign, turn.id, rawArguments, sheets, sheetsById);
    case "recall_story":
      return handleRecallStory(campaign.id, rawArguments);
    case "search_lore":
      return handleSearchLore(campaign.id, rawArguments);
    default:
      return { error: `The engine has no action called "${name}".` };
  }
}
