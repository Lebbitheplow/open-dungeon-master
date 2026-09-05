"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { SessionUser } from "@/lib/campaign-types";
import { ChangePasswordForm } from "@/app/ChangePasswordForm";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

type AuthMode = "login" | "register";

const OAUTH_ERRORS: Record<string, string> = {
  discord: "Discord sign-in failed. Try again.",
  signups_disabled: "Signups are disabled on this server.",
  invite_required: "This server needs an invite code to create an account.",
  invite_invalid: "That invite code is not valid (or has been used up).",
};

type SignupMode = "open" | "invite" | "closed";

const MODE_OPTIONS: Array<{ value: AuthMode; label: string }> = [
  { value: "login", label: "Log in" },
  { value: "register", label: "Create account" },
];

// The prototype draws the fields a touch taller than the app's default input
// and the Discord button in Discord's own blurple, so it reads as a third
// party door rather than one of ours.
const FIELD = cn(ui.input, "h-11");
const DISCORD_BTN =
  "inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-indigo-400/30 bg-[#5865f2]/15 px-4 text-sm text-indigo-100 transition-all duration-150 ease-snap hover:bg-[#5865f2]/25 hover:text-white active:scale-[0.98]";

function discordStartHref(inviteCode: string, joinCode?: string): string {
  const query = new URLSearchParams();
  if (inviteCode.trim()) {
    query.set("invite", inviteCode.trim().toUpperCase());
  }
  if (joinCode) {
    query.set("next", `/join/${joinCode.trim().toUpperCase()}`);
  }
  const qs = query.toString();
  return qs ? `/api/auth/discord/start?${qs}` : "/api/auth/discord/start";
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-[#8b9bf5]" aria-hidden="true">
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.88 1.52.07.07 0 0 0-.04.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.1 13 13 0 0 1-1.87-.9.08.08 0 0 1-.01-.12c.13-.1.25-.2.37-.3a.07.07 0 0 1 .08 0c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08 0c.12.1.25.21.38.3a.08.08 0 0 1-.01.13c-.6.35-1.22.64-1.87.89a.08.08 0 0 0-.04.11c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6.02-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z" />
    </svg>
  );
}

// Shared login/register form used by the home screen and invite-link page.
// After a login that requires a password reset (admin gave the user a temp
// password), a "set a new password" step runs before onAuthed fires.
export default function AuthForm({
  onAuthed,
  joinCode,
}: {
  onAuthed: (user: SessionUser) => void;
  // Campaign room code when this form sits on a /join/CODE page. It rides
  // along on register so an invite-only server can accept the signup, and
  // on the Discord link so the OAuth round trip returns to the join page.
  joinCode?: string;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // An ?invite= in the URL (a shared signup link) prefills the account
  // invite code and locks the field so it cannot be mistyped away.
  const [urlInvite] = useState(() => {
    if (typeof window === "undefined") return "";
    return (new URLSearchParams(window.location.search).get("invite") || "")
      .trim()
      .toUpperCase()
      .slice(0, 40);
  });
  // Seed the error from an OAuth redirect (?error=...) so it shows on load.
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    const oauthError = new URLSearchParams(window.location.search).get("error");
    return (oauthError && OAUTH_ERRORS[oauthError]) || "";
  });
  const [busy, setBusy] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [signupMode, setSignupMode] = useState<SignupMode>("open");
  const [inviteCode, setInviteCode] = useState(urlInvite);
  const [pendingReset, setPendingReset] = useState<{ user: SessionUser; tempPassword: string } | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        setDiscordEnabled(data?.discord === true);
        if (data?.signupMode === "invite" || data?.signupMode === "closed") {
          setSignupMode(data.signupMode);
        }
      })
      .catch(() => undefined);
    if (new URLSearchParams(window.location.search).get("error")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  function switchMode(next: AuthMode) {
    setMode(next);
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, string> = { username, password };
      if (mode === "register" && inviteCode.trim()) {
        payload.inviteCode = inviteCode.trim().toUpperCase();
      }
      // The room code from a /join page vouches for the signup on an
      // invite-only server (only a member could have shared it).
      if (mode === "register" && joinCode) {
        payload.joinCode = joinCode.trim().toUpperCase();
      }
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      if (data.user?.mustChangePassword) {
        setPendingReset({ user: data.user, tempPassword: password });
        return;
      }
      onAuthed(data.user);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (pendingReset) {
    return (
      <>
        <p className="mb-3 text-sm text-stone-400">
          An admin reset your password. Pick a new one to continue.
        </p>
        <ChangePasswordForm
          currentPassword={pendingReset.tempPassword}
          lockCurrent
          submitLabel="Set new password"
          onChanged={() => onAuthed({ ...pendingReset.user, mustChangePassword: false })}
        />
      </>
    );
  }

  // A closed server has one mode only, so the switch is hidden rather than
  // shown with a dead option.
  const canRegister = signupMode !== "closed";
  // On a join page both modes end at the same seat, so the button says so.
  const submitLabel = joinCode ? "Join the table" : mode === "login" ? "Log in" : "Create account";

  return (
    <>
      {canRegister ? (
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={switchMode}
          label="Log in or create an account"
          className="mb-5 w-full"
        />
      ) : null}

      <form onSubmit={submit} className="space-y-3.5">
        <label className="block">
          <span className="mb-1.5 block text-xs text-stone-400">Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            minLength={3}
            maxLength={24}
            placeholder={mode === "register" ? "Choose a name" : undefined}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs text-stone-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 8 : 1}
            maxLength={100}
            className={FIELD}
          />
        </label>
        {mode === "register" && signupMode === "invite" ? (
          <label className="block">
            <span className="mb-1.5 block text-xs text-stone-400">Invite code</span>
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              required
              readOnly={Boolean(urlInvite)}
              maxLength={40}
              placeholder="ODM-XXXXXXXXXX"
              className={cn(FIELD, "font-mono uppercase tracking-wider", urlInvite && "text-amber-200")}
            />
            <span className="mt-1.5 block text-xs text-stone-500">
              {urlInvite
                ? "This code came with your invite link."
                : "This server is invite-only. Ask whoever runs it for a code."}
            </span>
          </label>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          >
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "h-12 w-full")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitLabel}
        </button>
        {mode === "register" ? (
          <p className="text-center text-xs leading-5 text-stone-500">
            Creating an account means you accept this server&apos;s{" "}
            <a href="/terms" className="text-stone-400 underline hover:text-amber-200">
              terms of service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="text-stone-400 underline hover:text-amber-200">
              privacy policy
            </a>
            .
          </p>
        ) : null}
      </form>

      {discordEnabled ? (
        <>
          <div className="my-4 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-stone-700/60" />
            <span className="text-[11px] uppercase tracking-[0.2em] text-stone-600">or</span>
            <span className="h-px flex-1 bg-stone-700/60" />
          </div>
          <a
            // A filled invite code rides along so a brand-new Discord account
            // can pass an invite-only server's gate in one round trip, and on
            // a join page the return path rides along so the callback lands
            // back on the campaign instead of the dashboard.
            href={discordStartHref(inviteCode, joinCode)}
            className={DISCORD_BTN}
          >
            <DiscordMark />
            {joinCode ? "Continue with Discord" : "Sign in with Discord"}
          </a>
        </>
      ) : null}

      {canRegister ? (
        <p className="mt-5 text-center text-[13px] text-stone-400">
          {mode === "login" ? "New here? " : "Have an account? "}
          <button
            type="button"
            onClick={() => switchMode(mode === "login" ? "register" : "login")}
            className="text-amber-200 underline-offset-2 hover:text-amber-100 hover:underline"
          >
            {mode === "login" ? "Create an account" : "Log in"}
          </button>
        </p>
      ) : mode === "login" ? (
        <p className="mt-5 text-center text-xs text-stone-500">
          This server is not accepting new accounts.
        </p>
      ) : null}
    </>
  );
}
