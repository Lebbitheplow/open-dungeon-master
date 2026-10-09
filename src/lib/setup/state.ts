// Whether this server's admin has been through the guided setup
// (src/app/setup). Only steers where the app points an admin: a fresh
// server's first account lands in the wizard, and the home screen offers it
// again while the storyteller is not working and nobody has finished or
// waved it away. The settings themselves live in the global config.
import { getAppSetting, setAppSetting } from "@/lib/db/app-settings";
import { nowIso } from "@/lib/db/core";

const SETUP_STATE_KEY = "setup_state";

export type SetupState = {
  finishedAt: string;
  dismissedAt: string;
};

const EMPTY: SetupState = { finishedAt: "", dismissedAt: "" };

export function getSetupState(): SetupState {
  const stored = getAppSetting<Partial<SetupState> | null>(SETUP_STATE_KEY, null);
  return {
    finishedAt: typeof stored?.finishedAt === "string" ? stored.finishedAt : "",
    dismissedAt: typeof stored?.dismissedAt === "string" ? stored.dismissedAt : "",
  };
}

export type SetupMark = "finished" | "dismissed" | "open";

export function markSetup(mark: SetupMark): SetupState {
  const next: SetupState =
    mark === "finished"
      ? { ...getSetupState(), finishedAt: nowIso() }
      : mark === "dismissed"
        ? { ...getSetupState(), dismissedAt: nowIso() }
        : EMPTY;
  setAppSetting(SETUP_STATE_KEY, next);
  return next;
}

// The home screen's nudge: an admin, a server somebody runs (a device world's
// app has its own Story AI screen), no answer from the storyteller, and the
// wizard neither finished nor waved away.
export function setupNudgeWanted(input: {
  isAdmin: boolean;
  deviceWorld: boolean;
  state: SetupState;
  storyWorking: boolean;
}): boolean {
  return input.isAdmin && !input.deviceWorld && !input.storyWorking && !input.state.finishedAt && !input.state.dismissedAt;
}
