"use client";

import { ui } from "@/lib/ui";
import { CopyLine } from "@/components/CopyLine";
import { AdminInvitesSection } from "@/app/admin/AdminInvitesSection";
import type { Draft } from "@/app/setup/draft";
import { ChoiceCard, ChoiceCards, Lamp } from "@/app/setup/SetupParts";

type Update = (change: (draft: Draft) => Draft) => void;

// How players reach the server and who may make an account there. The
// addresses are this machine's own (GET /api/admin/setup), so the admin
// copies a working link instead of working one out.
export function PlayersStep({
  draft,
  update,
  lanUrls,
}: {
  draft: Draft;
  update: Update;
  lanUrls: string[];
}) {
  const set = (patch: Partial<Draft>) => update((current) => ({ ...current, ...patch }));
  const internet = Boolean(draft.publicUrl.trim());
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-stone-200">Where players find it</h4>
        <div className="stagger space-y-2">
          {lanUrls.length ? (
            lanUrls.slice(0, 3).map((url) => (
              <div key={url} className="su-row flex-col items-stretch">
                <span className="flex items-center gap-2 text-xs text-stone-400">
                  <Lamp tone="ok" /> On your home network (same Wi-Fi)
                </span>
                <CopyLine text={url} label="network address" />
              </div>
            ))
          ) : (
            <div className="su-row text-xs text-stone-400">
              <Lamp tone="off" /> This computer has no network address other players could use right now.
            </div>
          )}
          <div className="su-row flex-col items-stretch">
            <span className="flex items-center gap-2 text-xs text-stone-400">
              <Lamp tone={internet ? "ok" : "off"} /> Over the internet (optional)
            </span>
            <input
              className={ui.input}
              value={draft.publicUrl}
              onChange={(event) => set({ publicUrl: event.target.value })}
              placeholder="https://dungeon.example.org"
              aria-label="Public address"
            />
            <span className="text-[11px] leading-4 text-stone-500">
              Only if a reverse proxy or a tunnel puts this server on the internet: the address players type. Invite links and
              Discord sign-in use it.
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-stone-200">Who may make an account</h4>
        <ChoiceCards label="Who may make an account">
          <ChoiceCard
            picked={draft.signupMode === "invite"}
            onPick={() => set({ signupMode: "invite" })}
            glyph="tab-handout"
            title="With an invite code"
            sub="You hand out codes; nobody else gets in. The safe choice for a server on the internet."
            badge={internet ? { text: "Recommended", tone: "ready" } : null}
          />
          <ChoiceCard
            picked={draft.signupMode === "open"}
            onPick={() => set({ signupMode: "open" })}
            glyph="tab-characters"
            title="Anyone with the address"
            sub="Easiest for a home network where only your friends can reach it."
            badge={!internet ? { text: "Fine at home", tone: "ready" } : null}
          />
          <ChoiceCard
            picked={draft.signupMode === "closed"}
            onPick={() => set({ signupMode: "closed" })}
            glyph="tab-admin"
            title="Nobody new"
            sub="Only the accounts that exist now. Open it again from the admin panel any time."
          />
        </ChoiceCards>
        {draft.signupMode === "open" && internet ? (
          <p key="warn" className="reveal su-note">
            Anyone who finds the address can make an account and play on this server&apos;s storyteller. With a paid key behind
            it, choose invite codes.
          </p>
        ) : null}
        {draft.signupMode === "invite" ? (
          <div key="invites" className="reveal-height">
            <AdminInvitesSection />
          </div>
        ) : null}
        <p className="text-[11px] text-stone-500">
          Once they have an account, players join a table with the campaign&apos;s room code.
        </p>
      </div>
    </div>
  );
}
