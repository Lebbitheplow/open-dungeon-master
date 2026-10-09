// Which campaigns may narrate with the server's agent program. The program
// runs on the admin's own plan, so the admin decides: the whole server (the
// default, docs/harness-mcp-plan.md 13) or only campaigns an administrator
// leads.

import { getUserById } from "@/lib/db/users";
import { paidAiAllowedForLead } from "@/lib/shared-host";
import { ADAPTERS, harnessConfig } from "./status.ts";
import { harnessImagesReady } from "./images.ts";
import { isHarnessId } from "./types.ts";

export type HarnessOffer = {
  offered: boolean;
  // The program can paint and a test picture has been made on this machine.
  pictures: boolean;
  // "Claude Code" and the model it narrates on, for the campaign panel.
  label: string;
  model: string;
  reason?: string;
};

export function harnessOfferFor(campaign: { leadUserId: string }): HarnessOffer {
  const config = harnessConfig();
  if (!isHarnessId(config.id)) {
    return { offered: false, pictures: false, label: "", model: "", reason: "This server has no agent program set up." };
  }
  const label = ADAPTERS[config.id].label;
  const lead = getUserById(campaign.leadUserId);
  // Two settings say the same thing from different panels: the agent's own
  // "only campaigns an administrator leads", and the shared-host rule that
  // keeps every paid backend for them (src/lib/shared-host.ts).
  if ((config.campaigns === "admins" || !paidAiAllowedForLead(lead)) && !lead?.isAdmin) {
    return {
      offered: false,
      pictures: false,
      label,
      model: config.model,
      reason: `The server's ${label} is kept for campaigns an administrator leads.`,
    };
  }
  return { offered: true, pictures: harnessImagesReady(), label, model: config.model };
}
