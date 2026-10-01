// Pure helpers for spotting DM tool calls that leaked into narration as
// literal text. Three leak shapes exist: bracket style
// ("[request_roll characterId=... kind=custom]"), the model's NATIVE
// XML dialect ("<tool_call><function=enemy_attack><parameter=enemyId>..."),
// which reaches us whenever llama-server's extraction misses it, and bare
// JSON arguments (findBareJsonObjects below). Kept
// dependency-free so client components can import it; the name list mirrors
// the tools registered in src/lib/dm/prompt.ts, src/lib/dm/mutations.ts
// (MUTATION_TOOL_NAMES), src/lib/dm/encounter-tools.ts, src/lib/dm/
// map-tools.ts, and src/lib/image-tool.ts.

export const DM_TOOL_NAME_PATTERN =
  "request_roll|group_check|check_notice|apply_hazard|set_npc|npc_reaction|social_check|roll_treasure|damage_object|travel|request_player_input|move_party|update_location|record_event|complete_beat|recall_story|search_lore|write_campaign_note|send_whisper|generate_image|apply_damage|heal|stabilize|take_rest|award_xp|modify_gold|grant_item|remove_item|set_enemy_condition|clear_enemy_condition|set_condition|clear_condition|use_item|purchase|use_resource|use_spell_slot|learn_spell|update_sheet|start_encounter|add_enemies|add_companion|dismiss_companion|pc_attack|cast_at_enemy|cast_at_player|cast_buff|damage_enemy|enemy_attack|enemy_flees|declare_intent|aoe_damage|move_token|take_action|use_reaction|end_turn|end_encounter|summon_pet|pet_attack|damage_pet|dismiss_pet";

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

// A third leak shape: a call's arguments written into the reply as a bare
// JSON object, with no tool name ('{"characterIds":[...],"prompt":"..."}'),
// alone or glued to the end of the prose (gpt-oss on vLLM, PR #53), or the
// whole call as '{"name":"...","arguments":{...}}' without the <tool_call>
// wrapper. Narration never carries JSON, so every object that parses is
// found: the salvage in src/lib/dm/rolls.ts decides which of them were calls,
// and stripToolText removes them all.
export type BareJsonObject = { start: number; end: number; value: Record<string, unknown> };

export function findBareJsonObjects(text: string): BareJsonObject[] {
  const found: BareJsonObject[] = [];
  const opener = /\{\s*"/g;
  for (let match = opener.exec(text); match; match = opener.exec(text)) {
    const end = balancedObjectEnd(text, match.index);
    if (end < 0) {
      continue;
    }
    try {
      const value = JSON.parse(text.slice(match.index, end)) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        found.push({ start: match.index, end, value: value as Record<string, unknown> });
        opener.lastIndex = end;
      }
    } catch {
      // Not JSON after all; look for the next opener inside it.
    }
  }
  return found;
}

// Where the object opening at `start` closes, skipping braces inside
// strings, or -1 when it never does.
function balancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") {
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

// Cuts the given spans out of the text, tidying the gap each leaves.
export function cutSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  if (!spans.length) {
    return text;
  }
  let out = "";
  let cursor = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  out += text.slice(cursor);
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function stripToolText(text: string): string {
  const cleaned = text
    .replace(toolTextRegex(), "")
    .replace(xmlToolCallRegex(), "")
    .replace(fakeRollMarkerRegex(), "")
    .replace(/[ \t]{2,}/g, " ");
  const objects = findBareJsonObjects(cleaned);
  return objects.length ? cutSpans(cleaned, objects) : cleaned;
}
