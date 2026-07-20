// Pure helpers for spotting DM tool calls that leaked into narration as
// literal text. Two leak shapes exist: bracket style
// ("[request_roll characterId=... kind=custom]") and the model's NATIVE
// XML dialect ("<tool_call><function=enemy_attack><parameter=enemyId>..."),
// which reaches us whenever llama-server's extraction misses it. Kept
// dependency-free so client components can import it; the name list mirrors
// the tools registered in src/lib/dm/prompt.ts, src/lib/dm/mutations.ts
// (MUTATION_TOOL_NAMES), src/lib/dm/encounter-tools.ts, src/lib/dm/
// map-tools.ts, and src/lib/image-tool.ts.

export const DM_TOOL_NAME_PATTERN =
  "request_roll|group_check|check_notice|apply_hazard|set_npc|npc_reaction|social_check|roll_treasure|damage_object|travel|request_player_input|move_party|update_location|record_event|recall_story|send_whisper|generate_image|apply_damage|heal|stabilize|take_rest|award_xp|modify_gold|grant_item|remove_item|set_enemy_condition|clear_enemy_condition|set_condition|clear_condition|use_item|purchase|use_resource|use_spell_slot|learn_spell|update_sheet|start_encounter|add_enemies|add_companion|dismiss_companion|pc_attack|cast_at_enemy|cast_at_player|damage_enemy|enemy_attack|enemy_flees|aoe_damage|move_token|take_action|use_reaction|end_turn|end_encounter";

export function toolTextRegex(): RegExp {
  return new RegExp(`\\[(${DM_TOOL_NAME_PATTERN})\\b([^\\]]*)\\]`, "g");
}

// XML tool-call leaks: whole <tool_call> blocks, bare <function=...> blocks
// (the wrapper is sometimes dropped), then any orphaned tags left behind by
// truncation. Order matters: block patterns first so orphan matching only
// sees leftovers.
export function xmlToolCallRegex(): RegExp {
  return new RegExp(
    [
      "<tool_call>[\\s\\S]*?</tool_call>",
      "<function=[^>]*>[\\s\\S]*?</function>",
      "<parameter=[^>]*>[\\s\\S]*?</parameter>",
      "</?tool_call>",
      "<function=[^>]*>",
      "</function>",
      "<parameter=[^>]*>",
      "</parameter>",
    ].join("|"),
    "gi",
  );
}

// Removes any leaked tool-call text; players should never see or hear it.
// Hand-written roll markers: the server appends real "[roll:<uuid>]"
// markers to finished narration so the UI can inline dice cards, and the
// model sometimes imitates the syntax ("[roll:enemy_attack_cultist]").
// Anything in roll-marker shape that is not exactly a server uuid is fake
// bookkeeping text that rolled nothing; players must never see it.
export function fakeRollMarkerRegex(): RegExp {
  return /\[roll:(?![0-9a-f-]{36}\])[^\]]*\]/gi;
}

export function stripToolText(text: string): string {
  return text
    .replace(toolTextRegex(), "")
    .replace(xmlToolCallRegex(), "")
    .replace(fakeRollMarkerRegex(), "")
    .replace(/[ \t]{2,}/g, " ");
}
