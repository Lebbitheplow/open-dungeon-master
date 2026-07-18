"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { SessionUser } from "@/lib/campaign-types";
import { ChangePasswordForm } from "@/app/ChangePasswordForm";

type AuthMode = "login" | "register";

const OAUTH_ERRORS: Record<string, string> = {
  discord: "Discord sign-in failed. Try again.",
  signups_disabled: "Signups are disabled on this server.",
};

// Shared login/register form used by the home screen and invite-link page.
// After a login that requires a password reset (admin gave the user a temp
// password), a "set a new password" step runs before onAuthed fires.
export default function AuthForm({ onAuthed }: { onAuthed: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Seed the error from an OAuth redirect (?error=...) so it shows on load.
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    const oauthError = new URLSearchParams(window.location.search).get("error");
    return (oauthError && OAUTH_ERRORS[oauthError]) || "";
  });
  const [busy, setBusy] = useState(false);
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [pendingReset, setPendingReset] = useState<{ user: SessionUser; tempPassword: string } | null>(
    null,
  );

  useEffect(() => {
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setDiscordEnabled(data?.discord === true))
      .catch(() => undefined);
    if (new URLSearchParams(window.location.search).get("error")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
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

  return (
    <>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-stone-400">Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            minLength={3}
            maxLength={24}
            className={ui.input}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-stone-400">Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 8 : 1}
            maxLength={100}
            className={ui.input}
          />
        </label>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "w-full")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      {discordEnabled ? (
        <a
          href="/api/auth/discord/start"
          className={cn(ui.btnSecondary, "mt-3 w-full")}
        >
          <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden="true">
            <path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.88 1.52.07.07 0 0 0-.04.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 0 0-.04-.1 13 13 0 0 1-1.87-.9.08.08 0 0 1-.01-.12c.13-.1.25-.2.37-.3a.07.07 0 0 1 .08 0c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08 0c.12.1.25.21.38.3a.08.08 0 0 1-.01.13c-.6.35-1.22.64-1.87.89a.08.08 0 0 0-.04.11c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6.02-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z" />
          </svg>
          Sign in with Discord
        </a>
      ) : null}

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError("");
        }}
        className="mt-4 w-full text-center text-sm text-stone-400 hover:text-stone-200"
      >
        {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}
      </button>
    </>
  );
}
