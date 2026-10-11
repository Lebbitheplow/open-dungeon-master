import { activePublicEncounter } from "@/lib/db/encounter-view";
import { listNpcs, setNpcVoice } from "@/lib/db/npcs";
import { listSheets } from "@/lib/db/sheets";
import { listCampaignVoices, setCampaignVoice } from "@/lib/db/voices";
import { publishCast } from "@/lib/dm/cast";
import type { NpcVoice } from "@/lib/npcs/forge";
import { castingPool, pickVoice, type VoiceGender } from "@/lib/tts-cast";
import { genderMark } from "@/lib/gender";
import { baseCreatureName } from "@/lib/tts-segments";
import { serverVoices, ttsBackend, type TtsBackend } from "@/lib/tts-backend";

// Everyone at a table who may be given a voice (issue 97): the characters
// (players' and AI companions), the cast, and the monsters of the fight in
// progress or with a voice already chosen. One list for the renderer
// (src/lib/tts.ts) and for the voices panel, read fresh each time so a voice
// picked a moment ago is the one heard.

export type RosterKind = "pc" | "companion" | "npc" | "monster";

export type RosterEntry = {
  // "pc:<sheet id>", "npc:<npc id>" or "monster:<name>".
  key: string;
  kind: RosterKind;
  name: string;
  aliases: string[];
  portraitUrl: string;
  // Whose character this is; "" for everyone the DM plays.
  ownerUserId: string;
  // What their own record says, for casting; "" when it says nothing.
  gender: VoiceGender;
  voice: NpcVoice | null;
};

function monsterKey(name: string): string {
  return `monster:${baseCreatureName(name).toLowerCase().slice(0, 80)}`;
}

export function voiceRoster(campaignId: string): RosterEntry[] {
  const saved = new Map(listCampaignVoices(campaignId).map((entry) => [entry.key, entry]));
  const roster: RosterEntry[] = [];
  for (const sheet of listSheets(campaignId)) {
    // A conjured creature is a sheet too, and has nothing to say.
    if (sheet.summon) {
      continue;
    }
    const key = `pc:${sheet.id}`;
    roster.push({
      key,
      kind: sheet.isCompanion ? "companion" : "pc",
      name: sheet.name,
      aliases: [],
      portraitUrl: sheet.portrait?.url ?? "",
      ownerUserId: sheet.isCompanion ? "" : sheet.userId,
      gender: genderMark(sheet.gender),
      voice: saved.get(key)?.voice ?? null,
    });
  }
  for (const npc of listNpcs(campaignId)) {
    if (npc.archived) {
      continue;
    }
    roster.push({
      key: `npc:${npc.id}`,
      kind: "npc",
      name: npc.name,
      aliases: npc.aliases,
      portraitUrl: npc.portraitUrl,
      ownerUserId: "",
      gender: genderMark(npc.gender),
      voice: npc.voice,
    });
  }
  const monsters = new Map<string, string>();
  try {
    for (const enemy of activePublicEncounter(campaignId, { enemyNumbers: true })?.enemies ?? []) {
      if (enemy.status === "alive" && !monsters.has(monsterKey(enemy.name))) {
        monsters.set(monsterKey(enemy.name), baseCreatureName(enemy.name));
      }
    }
  } catch {
    // No readable fight: only the monsters already given a voice are listed.
  }
  for (const entry of saved.values()) {
    if (entry.key.startsWith("monster:") && !monsters.has(entry.key)) {
      monsters.set(entry.key, entry.name);
    }
  }
  for (const [key, name] of monsters) {
    roster.push({ key, kind: "monster", name, aliases: [], portraitUrl: "", ownerUserId: "", gender: "", voice: saved.get(key)?.voice ?? null });
  }
  return roster;
}

// Saves one speaker's voice where that kind of speaker keeps it. False when
// nobody at this table answers to the key.
export function setRosterVoice(campaignId: string, entry: Pick<RosterEntry, "key" | "name">, voice: NpcVoice | null): boolean {
  if (entry.key.startsWith("npc:")) {
    return setNpcVoice(campaignId, entry.key.slice("npc:".length), voice);
  }
  setCampaignVoice(campaignId, entry.key, entry.name, voice);
  return true;
}

// Gives every listed speaker without a voice one of the server's, each as
// different from the rest of the table as the server allows, and saves the
// choices. `only` narrows it to the speakers of one passage. Returns how
// many were cast.
export async function castUnvoiced(
  campaignId: string,
  roster: RosterEntry[],
  narratorVoice: string,
  options: { only?: Set<string>; backend?: TtsBackend } = {},
): Promise<number> {
  const waiting = roster.filter((entry) => !entry.voice && (!options.only || options.only.has(entry.key)));
  if (!waiting.length) {
    return 0;
  }
  const backend = options.backend ?? ttsBackend();
  const { ids } = await serverVoices(backend);
  const pool = castingPool(ids, narratorVoice || backend.defaultVoice);
  const taken = roster.flatMap((entry) => (entry.voice ? [entry.voice.voiceId] : []));
  let cast = 0;
  let npcChanged = false;
  for (const entry of waiting) {
    const voiceId = pickVoice(entry.name, entry.gender, pool, taken);
    if (!voiceId) {
      break;
    }
    const voice = { voiceId, speed: 1 };
    if (setRosterVoice(campaignId, entry, voice)) {
      entry.voice = voice;
      taken.push(voiceId);
      cast += 1;
      npcChanged ||= entry.kind === "npc";
    }
  }
  if (npcChanged) {
    publishCast(campaignId);
  }
  return cast;
}
