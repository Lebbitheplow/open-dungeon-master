"use client";

import { useState } from "react";
import { InfoButton } from "@/components/ui/InfoDialog";
import { PanelError, SettingToggle } from "./PanelKit";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A player's own consent for one of their characters, on that character's
// Bonds row: "Open to advances from NPCs" (issue 501, PUT /sheet/romance)
// and "Pacts may approach me" (issue 503, PUT /sheet/pacts). Each is theirs
// alone, shown only where it can matter, never shown to anyone else, and
// off until they turn it on. A real switch named for the character, 40px
// tall on a phone, reachable by keyboard with the kit's focus ring.

export type Consent = {
  // The route that saves it.
  route: "romance" | "pacts";
  // The sheet field the stream sends back.
  field: "openToAdvances" | "openToPacts";
  label: string;
  info: (name: string) => string;
};

export const ADVANCES_CONSENT: Consent = {
  route: "romance",
  field: "openToAdvances",
  label: "Open to advances from NPCs",
  info: (name) => `NPCs who already like ${name} may make the first move. You always answer, and switching this off stops it at once. Only you see this setting.`,
};

export const PACTS_CONSENT: Consent = {
  route: "pacts",
  field: "openToPacts",
  label: "Pacts may approach me",
  info: (name) =>
    `Companions who turn against the party may quietly ask ${name} to join them. You always answer, in private: join, play along, tell the party, or refuse. Off, no pact ever approaches ${name}. Only you see this setting.`,
};

export function ConsentSwitch({ campaignId, sheet, consent }: { campaignId: string; sheet: CharacterSheet; consent: Consent }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Shown at once while it saves, until the sheet the stream sends back
  // moves off the value it was pressed from.
  const stored = Boolean(sheet[consent.field]);
  const [pending, setPending] = useState<{ value: boolean; from: boolean } | null>(null);
  const open = pending && pending.from === stored ? pending.value : stored;

  // Never disabled while it saves: a disabled switch drops the keyboard's
  // focus. A second press while the first saves simply sends its own
  // answer, and the sheet the stream sends back settles it.
  async function toggle() {
    const next = !open;
    setBusy(true);
    setError("");
    setPending({ value: next, from: stored });
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet/${consent.route}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: sheet.id, open: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(String(data.error ?? "Could not save that."));
        setPending(null);
      }
    } catch {
      setError("Could not reach the server.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-1.5" data-advances-switch={consent.route === "romance" ? sheet.id : undefined} data-pacts-switch={consent.route === "pacts" ? sheet.id : undefined}>
      <span className="flex flex-wrap items-center gap-1">
        <SettingToggle on={open} onToggle={() => void toggle()} aria-busy={busy || undefined} label={`${consent.label}, for ${sheet.name}`}>
          {consent.label}
        </SettingToggle>
        <InfoButton label={consent.label} text={consent.info(sheet.name)} />
      </span>
      {error ? <PanelError>{error}</PanelError> : null}
    </div>
  );
}
