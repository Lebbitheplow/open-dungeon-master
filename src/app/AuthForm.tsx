"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { SessionUser } from "@/lib/campaign-types";

type AuthMode = "login" | "register";

// Shared login/register form used by the home screen and invite-link page.
export default function AuthForm({ onAuthed }: { onAuthed: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
      onAuthed(data.user);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
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
