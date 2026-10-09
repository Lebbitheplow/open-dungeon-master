"use client";

import { createContext, useContext, type ReactNode } from "react";

// Which table a content request is made for (src/lib/content/scope.ts). Inside
// a campaign the pickers, the builder and the Hand ask with ?campaign=<id>, so
// they offer the homebrew of whoever runs that table, the same entries the
// server admits at creation and plays with. Outside one (the workshop, the
// library) there is no provider and they read the asker's own shelf.

const ContentScopeContext = createContext<string | null>(null);

export function ContentScopeProvider({ campaignId, children }: { campaignId?: string | null; children: ReactNode }) {
  return <ContentScopeContext.Provider value={campaignId || null}>{children}</ContentScopeContext.Provider>;
}

export function useContentCampaign(): string | null {
  return useContext(ContentScopeContext);
}

// The query a content request sends: the caller's parameters, and the table.
export function scopedParams(params: Record<string, string>, campaignId: string | null | undefined): Record<string, string> {
  return campaignId ? { ...params, campaign: campaignId } : params;
}

// "?campaign=<id>" (or "&campaign=<id>" after other parameters), or nothing.
export function scopeQuery(campaignId: string | null | undefined, joiner: "?" | "&" = "?"): string {
  return campaignId ? `${joiner}campaign=${encodeURIComponent(campaignId)}` : "";
}
