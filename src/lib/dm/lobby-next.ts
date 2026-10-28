// The lobby's one line about what happens next for this viewer (F06 of
// docs/app-usability-audit-2026-10-16.md): choose a hero, ready up, wait for
// named people, or begin. Read from the same seats and blocker the Begin
// button uses (lobbyBlocker in viewer.ts), so it never disagrees with it.
// Pure, for scripts/test-lobby-next.mjs.

export type LobbyNextInput = {
  solo: boolean;
  // The viewer sits in a DM seat and plays no character.
  isDm: boolean;
  hasSheet: boolean;
  ready: boolean;
  // Owner or the person in the DM seat: who may press Begin.
  canStart: boolean;
  // lobbyBlocker's answer: "" when the adventure can open.
  blocker: string;
  // The other players, by name, who still need a hero or to ready up.
  needHero: string[];
  notReady: string[];
};

export type LobbyNext = { text: string; tone: "do" | "wait" | "go" };

function names(list: string[]): string {
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

export function lobbyNext(input: LobbyNextInput): LobbyNext {
  if (input.solo) {
    return input.hasSheet
      ? { text: "Your hero is ready. Begin whenever you like.", tone: "go" }
      : { text: "Next: choose your hero, then begin.", tone: "do" };
  }
  if (!input.isDm && !input.hasSheet) {
    return { text: "Next: choose your hero. A ready-made one has you playing in a minute.", tone: "do" };
  }
  if (!input.ready) {
    return input.isDm
      ? { text: "Next: ready up when the table is set. The adventure is yours to open.", tone: "do" }
      : { text: "Next: ready up when you are set.", tone: "do" };
  }
  if (input.blocker) {
    if (input.needHero.length) {
      return { text: `Waiting for ${names(input.needHero)} to choose a hero.`, tone: "wait" };
    }
    if (input.notReady.length) {
      return { text: `Waiting for ${names(input.notReady)} to ready up.`, tone: "wait" };
    }
    return { text: input.blocker, tone: "wait" };
  }
  return input.canStart
    ? { text: "Everyone is ready. Begin the adventure.", tone: "go" }
    : { text: "Everyone is ready. The owner or the GM opens the adventure.", tone: "wait" };
}
