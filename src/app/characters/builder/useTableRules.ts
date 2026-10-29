"use client";

import { useCallback, useEffect, useState } from "react";
import type { HpMethod } from "@/lib/srd/hit-points";
import type { StartingWealthMethod } from "@/lib/srd/starting-wealth";
import { REROLL_BELOW, restOffsets, type PoolEntry } from "./abilityDice";
import type { TableRules } from "./useBuilderDerived";

// The dice of character creation are the server's (/api/characters/rolls):
// the builder asks for a roll and shows what came back. Nothing here throws
// a die of its own, and nothing here lets a rolled number be typed.

export type WealthRoll = {
  classId: string;
  // The faces the server rolled, the gold they came to, and the dice in
  // words ("5d4 x 10 gp").
  faces: number[];
  gold: number;
  dice: string;
};

type ServerThrow = { dice: number[]; dropIndex: number; total: number };

export type AbilityPoolAnswer = {
  pool: PoolEntry[];
  // Already on record and handed back, not thrown now (issue #128), with
  // when it was thrown.
  kept: boolean;
  createdAt: string | null;
  // The reroll rule where the six were thrown (the table's, or the
  // server's): a fresh six only under this total.
  rerollBelow: number;
};

function shapePool(data: { throws?: ServerThrow[]; kept?: boolean; createdAt?: string | null; rerollBelow?: number } | null | undefined): AbilityPoolAnswer | null {
  const throws = data?.throws;
  if (!Array.isArray(throws) || throws.length !== 6) {
    return null;
  }
  return {
    pool: throws.map((entry) => ({
      total: entry.total,
      roll: {
        dice: [entry.dice[0], entry.dice[1], entry.dice[2], entry.dice[3]],
        dropIndex: entry.dropIndex,
        total: entry.total,
        rest: restOffsets(),
      },
    })),
    kept: data?.kept === true,
    createdAt: typeof data?.createdAt === "string" ? data.createdAt : null,
    rerollBelow: typeof data?.rerollBelow === "number" ? data.rerollBelow : REROLL_BELOW,
  };
}

// Six throws of 4d6 from the server, shaped for the dice tray. Where each
// die comes to rest is decoration, so that part is made up here.
// At a table (campaignId), the roll is thrown under that table's rule: in a
// pool of the table's own when it set a rule, in the library's when it
// follows the server (src/lib/db/creation-rolls.ts abilityRollPlace).
export async function requestAbilityPool(campaignId?: string | null): Promise<AbilityPoolAnswer | { error: string }> {
  try {
    const response = await fetch("/api/characters/rolls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "abilities", ...(campaignId ? { campaignId } : {}) }),
    });
    const data = await response.json().catch(() => ({}));
    const answer = response.ok ? shapePool(data?.abilities) : null;
    return answer ?? { error: data?.error || "The server could not roll the dice. Try again." };
  } catch {
    return { error: "Could not reach the server to roll the dice." };
  }
}

// The six already on record for this player, if any, without throwing: what
// a new builder shows as kept instead of as dice in the air (issue #128).
// The reroll rule where the character is made comes with it either way.
export async function fetchOpenAbilityPool(campaignId?: string | null): Promise<{ open: AbilityPoolAnswer | null; rerollBelow: number } | null> {
  try {
    const response = await fetch(campaignId ? `/api/characters/rolls?campaignId=${encodeURIComponent(campaignId)}` : "/api/characters/rolls");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return null;
    }
    return {
      open: shapePool(data?.abilities),
      rerollBelow: typeof data?.rerollBelow === "number" ? data.rerollBelow : REROLL_BELOW,
    };
  } catch {
    return null;
  }
}

// The server's own reroll rule (Admin > Server), for a screen that lets a
// table follow it and should say what that means. Null until the server
// answers, and from a server too old to say.
export function useServerRerollBelow(): number | null {
  const [below, setBelow] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/characters/rolls")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.rerollBelow === "number") {
          setBelow(data.rerollBelow);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return below;
}

export type TableRulesState = {
  // Undefined in the library, where a character is built under the defaults.
  rules: TableRules | undefined;
  wealth: WealthRoll | null;
  wealthBusy: boolean;
  wealthError: string;
  rollWealth: () => void;
  // The table's settings could not be read. The builder then says so and
  // offers to try again, rather than quietly showing the defaults as if
  // they were this table's (U:UB7).
  rulesError: string;
  retryRules: () => void;
  // Whether a character made here may take a second class (backlog F9):
  // the table's multiclassing setting, on unless the table turned it off,
  // and always in the library, where no table has a say.
  multiclassAllowed: boolean;
};

// What the table has set for the numbers the server derives, and the
// starting wealth it rolled for this class when the table rolls it.
export function useTableRules(
  campaignId: string | undefined,
  classId: string | undefined,
): TableRulesState {
  const [settings, setSettings] = useState<{
    hpMethod: HpMethod;
    startingWealth: StartingWealthMethod;
    multiclassingEnabled: boolean;
  } | null>(null);
  const [wealth, setWealth] = useState<WealthRoll | null>(null);
  const [wealthBusy, setWealthBusy] = useState(false);
  const [wealthError, setWealthError] = useState("");
  const [rulesError, setRulesError] = useState("");
  const [attempt, setAttempt] = useState(0);

  // The state lands in .then callbacks rather than after an await, so each
  // fetch reads as "subscribe to an external system", which is what it is.
  useEffect(() => {
    if (!campaignId) {
      return;
    }
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}`)
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (cancelled) {
          return;
        }
        if (!ok || !data?.campaign) {
          // Rules stay unknown; the server still derives the real numbers
          // when the character is saved.
          setRulesError(data?.error || "This table's rules could not be read, so the numbers shown are the defaults.");
          return;
        }
        // A setting the table never changed is the server's default.
        const stored = data.campaign.gameSettings;
        setRulesError("");
        setSettings({
          hpMethod: stored?.hpMethod ?? "average",
          startingWealth: stored?.startingWealth ?? "equipment",
          multiclassingEnabled: stored?.multiclassingEnabled !== false,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setRulesError("Could not reach the server for this table's rules, so the numbers shown are the defaults.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, attempt]);
  const retryRules = useCallback(() => setAttempt((count) => count + 1), []);

  const rolled = settings?.startingWealth === "rolled";

  // A roll already made for this class at this table comes back as it was.
  useEffect(() => {
    if (!campaignId || !classId || !rolled) {
      return;
    }
    let cancelled = false;
    const query = new URLSearchParams({ campaignId, classId });
    fetch(`/api/characters/rolls?${query.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) {
          setWealth(data?.wealth ?? null);
          setWealthError("");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWealth(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, classId, rolled]);

  const rollWealth = useCallback(() => {
    if (!campaignId || !classId || wealthBusy) {
      return;
    }
    setWealthBusy(true);
    setWealthError("");
    fetch("/api/characters/rolls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "wealth", campaignId, classId }),
    })
      .then(async (response) => ({
        ok: response.ok,
        data: await response.json().catch(() => ({})),
      }))
      .then(({ ok, data }) => {
        if (ok && data?.wealth) {
          setWealth(data.wealth);
        } else {
          setWealthError(data?.error || "The server could not roll your starting wealth. Try again.");
        }
      })
      .catch(() => setWealthError("Could not reach the server to roll your starting wealth."))
      .finally(() => setWealthBusy(false));
  }, [campaignId, classId, wealthBusy]);

  // A roll belongs to the class it was made for.
  const mine = wealth && classId && wealth.classId.toLowerCase() === classId.toLowerCase() ? wealth : null;
  return {
    rules: settings
      ? {
          hpMethod: settings.hpMethod,
          startingWealth: settings.startingWealth,
          wealthRoll: rolled ? (mine?.gold ?? null) : null,
          multiclassAllowed: settings.multiclassingEnabled,
        }
      : undefined,
    wealth: rolled ? mine : null,
    wealthBusy,
    wealthError,
    rollWealth,
    rulesError,
    retryRules,
    multiclassAllowed: !campaignId || (settings?.multiclassingEnabled ?? true),
  };
}
