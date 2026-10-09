import { getGlobalConfig } from "@/lib/db/app-settings";
import { getCampaignById } from "@/lib/db/campaigns";
import { getUserById } from "@/lib/db/users";
import { isDeviceWorld } from "@/lib/server-env";
import { currentUsageScope } from "@/lib/usage/scope";

export { isPrivateBackendHost } from "@/lib/backend-host";

// A server shared with people who are not its admin (issues #137, #138).
// Two decisions, both the admin's, both server-wide:
//
// - who may start a campaign or workshop: everyone, or administrators
//   only. A campaign that cannot be started cannot spend anything, which
//   is the plainest way to keep a paid key for the host's own tables; the
//   others still join by room code.
// - whether the paid backends are for every campaign or only for those an
//   administrator leads. "Paid" means a backend on a public host that takes
//   the host's key (OpenAI, OpenRouter, a hosted vLLM: text, pictures or
//   speech) and the agent program, which runs on the admin's plan. A
//   backend on this machine or the local network is the host's own, keyed
//   or not (a llama-server behind a key, Ollama, ComfyUI, Kokoro, Whisper),
//   and stays open to every table. A player who wants a paid model at their
//   own table brings their own key in the client app, which is what it is
//   for.
//
// The lead decides a campaign's standing, as the agent policy already
// ruled (src/lib/harness/policy.ts): whoever leads the table is who the
// spending answers to. On a world an app hosts there is one owner and no
// policy to apply.

export type SharedHostPolicy = {
  campaignCreation: "everyone" | "admins";
  paidAi: "everyone" | "admins";
};

export function sharedHostPolicy(): SharedHostPolicy {
  if (isDeviceWorld()) {
    return { campaignCreation: "everyone", paidAi: "everyone" };
  }
  const stored = getGlobalConfig().sharedHost;
  return {
    campaignCreation: stored.campaignCreation === "admins" ? "admins" : "everyone",
    paidAi: stored.paidAi === "admins" ? "admins" : "everyone",
  };
}

export function canCreateCampaigns(user: { isAdmin: boolean }): boolean {
  return user.isAdmin || sharedHostPolicy().campaignCreation === "everyone";
}

export const CAMPAIGN_CREATION_REFUSED =
  "On this server an administrator starts campaigns and workshops; ask them for a room code to join one.";

export function campaignCreationRefusal(): Response {
  return Response.json({ error: CAMPAIGN_CREATION_REFUSED }, { status: 403 });
}

// Whether a campaign led by this person may spend the paid backends.
export function paidAiAllowedForLead(lead: { isAdmin: boolean } | null | undefined): boolean {
  if (sharedHostPolicy().paidAi === "everyone") {
    return true;
  }
  return Boolean(lead?.isAdmin);
}

export function paidAiAllowedForCampaign(campaignId: string): boolean {
  if (sharedHostPolicy().paidAi === "everyone") {
    return true;
  }
  const campaign = getCampaignById(campaignId);
  return paidAiAllowedForLead(campaign ? getUserById(campaign.leadUserId) : null);
}

// The answer for the work in flight: the campaign in scope decides; work
// outside any campaign (a library portrait, dictation on the home page)
// answers to the account itself; work the server does for itself with
// neither in scope is the admin's own.
export function paidAiAllowedNow(): boolean {
  if (sharedHostPolicy().paidAi === "everyone") {
    return true;
  }
  const scope = currentUsageScope();
  if (scope.campaignId) {
    return paidAiAllowedForCampaign(scope.campaignId);
  }
  if (scope.userId) {
    return paidAiAllowedForLead(getUserById(scope.userId));
  }
  return true;
}

export type PaidAiKind = "story" | "utility" | "images" | "speech" | "agent";

const PAID_AI_LABEL: Record<PaidAiKind, string> = {
  story: "paid storyteller",
  utility: "paid utility model",
  images: "paid picture backend",
  speech: "paid speech backend",
  agent: "agent program",
};

// Said plainly, with the way forward: this is a policy, not a fault.
export function paidAiRefusal(kind: PaidAiKind): string {
  return `This server keeps its ${PAID_AI_LABEL[kind]} for campaigns an administrator leads. This table can use the server's local backends, or the party lead can bring their own key in the client app.`;
}

export function paidAiRefusalResponse(kind: PaidAiKind): Response {
  return Response.json({ error: paidAiRefusal(kind) }, { status: 403 });
}

// Thrown where the work runs on a queue and only an Error can carry the
// answer back (pictures, narration). The message is the refusal itself.
export class PaidAiRefusedError extends Error {
  kind: PaidAiKind;
  constructor(kind: PaidAiKind) {
    super(paidAiRefusal(kind));
    this.name = "PaidAiRefusedError";
    this.kind = kind;
  }
}
