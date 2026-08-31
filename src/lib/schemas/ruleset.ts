import { z } from "zod";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";
import { HOUSE_RULES_MAX } from "@/lib/dm/rules-logic";

// The wire and storage shape of a library ruleset. variantRules reuses the
// game-settings fragment rather than restating it, so a variant rule added
// to the engine is available to a ruleset the same day and cannot drift into
// two spellings.

export const rulesetVariantRulesSchema = gameSettingsSchema.shape.variantRules;

export const createRulesetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  variantRules: rulesetVariantRulesSchema,
  houseRulesText: z.string().max(HOUSE_RULES_MAX).default(""),
  homebrewIds: z.array(z.string().trim().max(60)).max(500).default([]),
});

export const patchRulesetSchema = createRulesetSchema.partial();

export type CreateRulesetInput = z.infer<typeof createRulesetSchema>;
