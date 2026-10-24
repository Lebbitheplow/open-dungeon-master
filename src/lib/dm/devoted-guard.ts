import { companionConduct, saveConduct } from "@/lib/db/companion-conduct";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { getSheetById } from "@/lib/db/sheets";
import { withinFeet } from "@/lib/dm/authored-saves";
import { conscienceSetting, consciousCompanions } from "@/lib/dm/conscience";
import { freshLastHit } from "@/lib/dm/last-hit";
import { standingWith } from "@/lib/dm/party-conduct";
import { GUARD_REACTION, guardRefusal } from "@/lib/dm/party-conduct-logic";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { allyOf, noHit, settle, SPENT, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { publishEphemeral } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";

// A devoted companion takes a blow meant for its friend (issue 503 Phase
// 4), through use_reaction like every reaction that moves a hit onto its
// taker (Divine Allegiance, authored-reactions.ts take_for_ally): the
// friend's last hit comes back off them and lands on the companion as it
// was dealt. Its reaction, within 5 feet, once a fight, and only for a
// character it is devoted to. Null when the call names some other reaction.

const LABEL = textKey(GUARD_REACTION);

export function devotedGuard(ctx: Ctx): ToolResult | null {
  if (textKey(ctx.args.feature ?? "") !== LABEL) {
    return null;
  }
  const { campaign, sheet, encounter } = ctx;
  const npc = conscienceSetting(campaign) !== "off" && consciousCompanions([sheet]).length ? companionNpcFor(sheet) : null;
  if (!npc || !encounter) {
    return { error: `${GUARD_REACTION} is a lasting companion's, for a friend it is devoted to, in a fight. Nothing was spent.`, refused: "rules" };
  }
  const ally = allyOf(ctx);
  if (!ally || ally.id === sheet.id) {
    return { error: `${GUARD_REACTION} takes a blow meant for a friend: pass the friend's targetCharacterId. Nothing was spent.`, retry: true };
  }
  const conduct = companionConduct(npc.id);
  const refused = guardRefusal({
    companion: sheet.name,
    ally: ally.name,
    approval: standingWith(campaign.id, sheet.name, ally.id),
    usedThisFight: conduct.guardedIn === encounter.id,
  });
  if (refused) {
    return { error: refused, refused: "rules" };
  }
  if (!withinFeet(encounter.id, sheet.id, ally.id, 5)) {
    return { error: `${ally.name} is beyond 5 feet of ${sheet.name}. Nothing was spent.`, refused: "rules" };
  }
  const record = freshLastHit(campaign.id, ally.id);
  if (!record || record.source !== "attack" || record.answered.includes(LABEL) || !record.swings.some((swing) => swing.hit)) {
    return noHit(ally.name, GUARD_REACTION, `an attack that hit ${ally.name}`);
  }
  const raw = record.swings.filter((swing) => swing.hit).reduce((sum, swing) => sum + swing.raw, 0);
  const settled = settle(ctx, record, record.swings.map((swing) => ({ ...swing, hit: false, raw: 0 })), LABEL);
  const taken = applyPcDamage(campaign, ctx.turn.id, getSheetById(sheet.id) ?? sheet, { amount: raw, reason: `${GUARD_REACTION} for ${ally.name}` });
  spendReaction(ctx);
  saveConduct(npc.id, { ...companionConduct(npc.id), guardedIn: encounter.id });
  publishEphemeral(campaign.id, "relationships_updated", {});
  return {
    ok: true,
    reaction: GUARD_REACTION,
    spent: SPENT(sheet.name),
    applied: `${sheet.name} throws themselves in the way and takes the ${raw} damage meant for ${ally.name}, whose ${settled.given} hit points come back. Once this fight.`,
    taken,
  };
}
