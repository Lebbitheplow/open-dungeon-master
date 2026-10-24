import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { advanceClock } from "@/lib/db/clock";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listFactions } from "@/lib/db/factions";
import { listOpenItemProposals, resolveItemProposal } from "@/lib/db/item-proposals";
import { insertCampaignMessage } from "@/lib/db/messages";
import { getPact, savePact } from "@/lib/db/pacts";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { computeSheetDerived } from "@/lib/srd";
import { passiveScore } from "@/lib/dm/check-tools";
import { moveToSide } from "@/lib/dm/combat-sides";
import { conscienceSetting } from "@/lib/dm/conscience";
import { departNow } from "@/lib/dm/departure";
import type { DepartureResponse, DepartureWhere } from "@/lib/dm/departure-logic";
import { addRowMath, handedOverRow, removeItemMath } from "@/lib/dm/mutation-math";
import {
  APPROACH_TOOL,
  approachArgs,
  companionMembers,
  notices,
  PACT_REVEAL_PREFIX,
  planLine,
  playerMembers,
  tacticFor,
  type Pact,
  type SecretAction,
} from "@/lib/dm/pact-logic";
import { publicItemProposal } from "@/lib/dm/proposal-view";
import { publishRelationshipsUpdated } from "@/lib/dm/relationship-subject";
import { revealRolls, rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { listPriceCp } from "@/lib/dm/trade-value";
import { tickWorldTimeskip } from "@/lib/dm/world-tick";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { EquipmentItem } from "@/lib/schemas/sheet";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A pact's plan going off (issue 503 Phases 5 and 7): its harmless sabotage
// first, through real rules (theft moves inventory, a false trail costs a
// day and a Survival contest, denouncing moves reputation), then its
// companions leave through Phase 2's departure (departNow), or at a Turn
// table, in a fight, turn on the party through Phase 6's moveToSide. Every
// secret behind it comes out: its hidden rolls turn public
// (roll-card.ts revealRolls) and the table is told in a reveal card.
//
// Must not import src/lib/dm/pacts.ts (it calls in here).

export type FireWhere = "night" | "road" | "fight" | "scene";
export type FireReason = "plan" | "reported" | "caught";

function tableLine(campaign: Campaign, content: string, glyph: "system-party" | "cue-battle" | "cue-travel" | "cue-coin" = "system-party") {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph, content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

const skillMod = (sheet: CharacterSheet, skill: string) => computeSheetDerived(sheet).skills[skill] ?? 0;
const standing = (sheet: CharacterSheet) => sheet.currentHp > 0 && !sheet.deathSaves?.dead;

// One equipment line moved from a sheet (null when it is not there), with
// an audit row that says only what the victim would notice.
export function takeItem(campaign: Campaign, from: CharacterSheet, name: string, why: string, turnId = ""): EquipmentItem | null {
  const taken = removeItemMath(from.equipment, name, 1);
  if (!taken) {
    return null;
  }
  const patch = { equipment: taken.equipment };
  patchSheet(from.id, patch);
  insertSheetAudit({ campaignId: campaign.id, characterId: from.id, turnId: turnId || null, kind: "item", delta: { removed: taken.item.name }, reason: why, seq: allocateSeq(campaign.id), before: from, patch });
  const updated = getSheetById(from.id);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return handedOverRow(taken.item, taken.removed);
}

export function giveItem(campaign: Campaign, to: CharacterSheet, row: EquipmentItem, why: string) {
  const fresh = getSheetById(to.id) ?? to;
  const patch = { equipment: addRowMath(fresh.equipment, row) };
  patchSheet(fresh.id, patch);
  insertSheetAudit({ campaignId: campaign.id, characterId: fresh.id, turnId: null, kind: "item", delta: { added: row.name }, reason: why, seq: allocateSeq(campaign.id), before: fresh, patch });
  const updated = getSheetById(fresh.id);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The party's best thing: the most valuable line any of its standing
// characters carries.
function bestLoot(party: readonly CharacterSheet[]): { sheet: CharacterSheet; item: EquipmentItem } | null {
  let best: { sheet: CharacterSheet; item: EquipmentItem; worth: number } | null = null;
  for (const sheet of party) {
    for (const item of sheet.equipment) {
      const worth = listPriceCp(item) ?? 0;
      if (worth > 0 && (!best || worth > best.worth)) {
        best = { sheet, item, worth };
      }
    }
  }
  return best ? { sheet: best.sheet, item: best.item } : null;
}

// The watch: the best passive score among the party's standing characters.
function bestWatcher(campaign: Campaign, party: readonly CharacterSheet[], sense: "perception" | "insight"): { sheet: CharacterSheet; score: number } | null {
  return party.filter(standing).reduce<{ sheet: CharacterSheet; score: number } | null>((best, sheet) => {
    const score = passiveScore(campaign, sheet, sense);
    return !best || score > best.score ? { sheet, score } : best;
  }, null);
}

// The pact goes now. `where`: the night watch, the road, a fight, or a scene
// forced on it (reported, or a spy caught). Returns the table's lines.
export function firePact(campaign: Campaign, turnId: string, stale: Pact, where: FireWhere, reason: FireReason, by = ""): string[] {
  const pact = getPact(stale.id);
  if (!pact || pact.status !== "forming") {
    return [];
  }
  const live = getCampaignById(campaign.id) ?? campaign;
  const setting = conscienceSetting(live);
  const sheets = listSheets(campaign.id);
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const companions = companionMembers(pact).flatMap((member) => (byId.has(member.sheetId) ? [byId.get(member.sheetId)!] : []));
  const ours = new Set([...companions.map((sheet) => sheet.id), ...playerMembers(pact).filter((member) => member.stance === "joined").map((member) => member.characterId)]);
  const party = sheets.filter((sheet) => !sheet.isCompanion && !sheet.summon && !ours.has(sheet.id));
  const leader = companions.find((sheet) => companionNpcFor(sheet)?.id === pact.leaderNpcId) ?? companions[0];
  const lines: string[] = [];
  const departed: string[] = [];
  let exposed = reason !== "plan";

  // Its sabotage first, the counters the party has against each.
  if (reason === "plan" && pact.plan === "sabotage" && leader) {
    const actor = companions.find((sheet) => tacticFor(sheet.class) === pact.tactic) ?? leader;
    if (pact.tactic === "theft") {
      const caught = theft(campaign, turnId, actor, party);
      exposed = caught.exposed;
      lines.push(caught.line);
    } else if (pact.tactic === "false_trail") {
      const trail = falseTrail(campaign, actor, party);
      exposed = trail.exposed;
      lines.push(trail.line);
    }
  }

  // Then the plan itself: a strike in a fight at a Turn table turns its
  // members on the party where they stand; anything else leaves.
  const striking = pact.plan === "strike" && where === "fight" && setting === "turn" && Boolean(getActiveEncounter(campaign.id));
  const reportTo = pact.plan === "sabotage" && pact.tactic === "denounce" && reason === "plan" ? ([...listFactions(campaign.id)].sort((a, b) => b.power - a.power)[0] ?? null) : null;
  for (const sheet of companions) {
    if (striking) {
      const moved = moveToSide(live, sheet.id, "foe", { reason: "The pact strikes.", quiet: true });
      if ("ok" in moved) {
        lines.push(moved.line);
      }
      continue;
    }
    const response: DepartureResponse =
      pact.plan === "strike" && setting === "turn" && reason === "plan"
        ? "bide_strike"
        : exposed
          ? "walk_out"
          : reportTo && sheet.id === leader?.id
            ? "report"
            : "slip_away";
    const at: DepartureWhere = where === "night" ? "night" : where === "fight" ? "fight" : "scene";
    // Read again: the sheet leaves as it is now, with anything it just took.
    const leaving = getSheetById(sheet.id) ?? sheet;
    // The departure tells the table itself; the DM hears it with the rest.
    const outcome = departNow(live, leaving, response, at, response === "report" ? reportTo : null);
    departed.push(`${outcome.companion} ${outcome.how.charAt(0).toLowerCase()}${outcome.how.slice(1)}.`);
  }

  // The players in it: one who joined goes with the pact (or, striking,
  // turns where they mean to strike); one only playing along is clear.
  const secrets = pact.secrets.map((secret) => ({ ...secret }));
  for (const member of playerMembers(pact)) {
    const sheet = byId.get(member.characterId);
    if (!sheet) {
      continue;
    }
    if (member.stance === "spy") {
      lines.push(`${sheet.name} had only been playing along with the pact.`);
      continue;
    }
    const attack = secrets.find((secret) => secret.characterId === sheet.id && secret.kind === "attack" && !secret.revealed);
    if (striking && attack) {
      const moved = moveToSide(live, sheet.id, "foe", { reason: `${sheet.name} turns on ${attack.targetName || "the party"}.`, quiet: true });
      if ("ok" in moved) {
        lines.push(moved.line);
      }
    } else {
      lines.push(`${sheet.name} goes with the pact.`);
    }
  }

  // Every secret behind it comes out.
  lines.push(...revealSecrets(campaign, secrets, byId));
  withdrawApproaches(campaign, pact.id);
  const members = [...companions.map((sheet) => sheet.name), ...playerMembers(pact).filter((member) => member.stance === "joined").map((member) => member.name)];
  const opener = reason === "reported" ? (by ? `${by} told the party of the pact` : "The pact is out in the open") : reason === "caught" ? "The pact caught a spy and moved at once" : "The pact made its move";
  const head = `${PACT_REVEAL_PREFIX}${opener}: ${members.join(", ")}, meaning to ${planLine(pact)}.`;
  tableLine(campaign, `${head} ${lines.join(" ")}`.trim(), striking ? "cue-battle" : "system-party");
  savePact({
    ...pact,
    secrets: secrets.map((secret) => ({ ...secret, revealed: true })),
    status: "fired",
    exposed: true,
    firedAt: (getCampaignById(campaign.id) ?? campaign).clock.instant,
    how: [...lines, ...departed].join(" "),
  });
  publishRelationshipsUpdated(campaign.id);
  return [`${head} ${lines.join(" ")}`.trim(), ...departed];
}

// Theft at the night watch: the thief's Sleight of Hand against the watch's
// passive Perception. Unseen, the party's best thing (or its fullest purse)
// goes into the thief's pack and leaves with the thief's sheet.
function theft(campaign: Campaign, turnId: string, thief: CharacterSheet, party: readonly CharacterSheet[]): { exposed: boolean; line: string } {
  const roll = rollCard(campaign, null, thief.id, "skill_check", `${thief.name}: Sleight of Hand, in the night`, d20Expression(skillMod(thief, "sleight_of_hand")), sheetAttacker(thief));
  const watch = bestWatcher(campaign, party, "perception");
  if (watch && notices(watch.score, roll.total)) {
    return { exposed: true, line: `${watch.sheet.name} caught ${thief.name} with a hand in the party's packs.` };
  }
  const loot = bestLoot(party.filter(standing));
  if (loot) {
    const row = takeItem(campaign, loot.sheet, loot.item.name, `${loot.item.name} went missing in the night`, turnId);
    if (row) {
      giveItem(campaign, thief, row, `took ${row.name} from ${loot.sheet.name}`);
      return { exposed: false, line: `${thief.name} took ${loot.sheet.name}'s ${row.name} in the night.` };
    }
  }
  const purse = [...party].sort((a, b) => b.gold - a.gold)[0];
  if (purse && purse.gold > 0) {
    patchSheet(purse.id, { gold: 0 });
    const fresh = getSheetById(thief.id) ?? thief;
    patchSheet(fresh.id, { gold: fresh.gold + purse.gold });
    for (const id of [purse.id, thief.id]) {
      const updated = getSheetById(id);
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
    return { exposed: false, line: `${thief.name} took ${purse.name}'s purse (${purse.gold} gp) in the night.` };
  }
  return { exposed: false, line: `${thief.name} went through the party's packs and found nothing worth taking.` };
}

// A false trail on the road: the guide's Survival against the party's best
// Survival. Noticed, the party keeps to the road; not, it loses a day and
// the pact slips away.
function falseTrail(campaign: Campaign, guide: CharacterSheet, party: readonly CharacterSheet[]): { exposed: boolean; line: string } {
  const theirs = rollCard(campaign, null, guide.id, "skill_check", `${guide.name}: Survival, a false trail`, d20Expression(skillMod(guide, "survival")), sheetAttacker(guide));
  const tracker = party.filter(standing).sort((a, b) => skillMod(b, "survival") - skillMod(a, "survival"))[0];
  if (tracker) {
    const ours = rollCard(campaign, null, tracker.id, "skill_check", `${tracker.name}: Survival, keeping to the road`, d20Expression(skillMod(tracker, "survival")), sheetAttacker(tracker));
    if (ours.total >= theirs.total) {
      return { exposed: true, line: `${tracker.name} saw ${guide.name} turning the party from the road in time.` };
    }
  }
  advanceClock(campaign.id, 1, "days");
  tickWorldTimeskip(campaign.id, 6);
  return { exposed: false, line: `${guide.name} led the party off the road: it has lost a day and is somewhere it never meant to be.` };
}

// Each held secret action, out: its hidden roll turns public, a stolen
// thing reaches its thief, and harm the server could not settle is handed
// to the DM to resolve with the real tools.
function revealSecrets(campaign: Campaign, secrets: SecretAction[], byId: Map<string, CharacterSheet>): string[] {
  const held = secrets.filter((secret) => !secret.revealed);
  revealRolls(campaign.id, held.map((secret) => secret.rollId));
  const lines: string[] = [];
  for (const secret of held) {
    secret.revealed = true;
    if (secret.kind === "steal" && secret.item && !secret.caught) {
      const thief = byId.get(secret.characterId);
      const row = stashedRow(secret);
      if (thief && row) {
        giveItem(campaign, thief, row, `took ${secret.item} from ${secret.targetName}`);
      }
      lines.push(`${secret.name} had taken ${secret.targetName}'s ${secret.item}.`);
    } else if (secret.kind === "harm") {
      lines.push(`${secret.name} had, in secret: ${secret.text}. Its harm is resolved now, with the real tools.`);
    } else if (secret.kind !== "attack") {
      lines.push(`${secret.name} had, in secret: ${secret.text}.`);
    }
  }
  return lines;
}

function stashedRow(secret: SecretAction): EquipmentItem | null {
  try {
    const row = JSON.parse(secret.itemJson || "null") as EquipmentItem | null;
    return row && typeof row.name === "string" ? row : null;
  } catch {
    return null;
  }
}

// Any approach of this pact still waiting on an answer is withdrawn,
// quietly: it was only ever its player's.
function withdrawApproaches(campaign: Campaign, pactId: string) {
  for (const proposal of listOpenItemProposals(campaign.id)) {
    if (proposal.toolName === APPROACH_TOOL && approachArgs(proposal.argsJson)?.pactId === pactId) {
      const resolved = resolveItemProposal(proposal.id, "cancelled", "the pact moved");
      if (resolved) {
        publishPersisted(campaign.id, "item_proposal_resolved", { proposal: publicItemProposal(resolved) });
      }
    }
  }
}
