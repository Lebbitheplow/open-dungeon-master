"use client";

import { PageSkeleton } from "@/components/PageSkeleton";
import { useEffect, useState } from "react";
import type React from "react";
import { ui } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { GameIcon } from "@/components/ui/GameIcon";
import type { SessionUser } from "@/lib/campaign-types";
import { HowToPlayDialog } from "@/components/HowToPlayDialog";
import AuthForm from "@/app/AuthForm";
import { ChangePasswordForm } from "@/app/ChangePasswordForm";
import { Dashboard } from "@/app/home/Dashboard";

export default function Home() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <PageSkeleton kind="home" />
    );
  }

  if (user?.mustChangePassword) {
    return (
      <ForcedPasswordChange
        onChanged={() => setUser({ ...user, mustChangePassword: false })}
      />
    );
  }

  return user ? (
    <Dashboard user={user} onLogout={() => setUser(null)} />
  ) : (
    <AuthScreen onAuthed={setUser} />
  );
}

// Shown when a session belongs to an account flagged by an admin password
// reset; the server rejects campaign APIs until the password is changed.
function ForcedPasswordChange({ onChanged }: { onChanged: () => void }) {
  return (
    <main className="bg-starfield flex flex-1 items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm animate-fade-up-slow">
        <div className={cn(ui.card, "ornate texture-noise auth-card shadow-elev-2")}>
          <h1 className="gold-title mb-1 font-display text-xl tracking-wide">
            Set a new password
          </h1>
          <p className="mb-4 text-sm text-stone-400">
            An admin reset your password. Enter the temporary password you were given and pick a
            new one.
          </p>
          <ChangePasswordForm submitLabel="Set new password" onChanged={onChanged} />
        </div>
      </div>
    </main>
  );
}

// The key art behind the door: one painting per setting, a different one each
// visit. The crops live in public/assets/ui/door.
const DOOR_WORLDS = [
  { key: "high-fantasy", name: "High fantasy" },
  { key: "dark-fantasy", name: "Dark fantasy" },
  { key: "horror", name: "Horror" },
  { key: "mystery", name: "Mystery" },
  { key: "steampunk", name: "Steampunk" },
  { key: "cyberpunk", name: "Cyberpunk" },
  { key: "post-apocalyptic", name: "Post-apocalyptic" },
] as const;
const DOOR_KEY = "odm.door";
const FIREFLIES = 14;

function nextDoorWorld(): number {
  try {
    const seen = Number(window.localStorage.getItem(DOOR_KEY));
    const next = Number.isInteger(seen) ? (seen + 1) % DOOR_WORLDS.length : 0;
    window.localStorage.setItem(DOOR_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

// The front door: on a desk the painting stands to the left and the form to
// the right; a phone gets the form alone, as before.
function AuthScreen({ onAuthed }: { onAuthed: (user: SessionUser) => void }) {
  const [howToOpen, setHowToOpen] = useState(false);
  const [world] = useState(nextDoorWorld);
  const painting = DOOR_WORLDS[world];

  return (
    <main className="auth-door bg-starfield">
      <aside className="auth-door-art" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/assets/ui/door/${painting.key}.webp`} alt="" className="auth-door-painting" />
        <div className="auth-door-fireflies">
          {Array.from({ length: FIREFLIES }, (_, index) => (
            <span key={index} style={{ "--n": index } as React.CSSProperties} />
          ))}
        </div>
        <div className="auth-door-caption">
          <span className="eyebrow auth-door-eyebrow">Behind the door tonight</span>
          <span className="auth-door-world font-display text-2xl tracking-wide">{painting.name}</span>
          <span className="auth-door-line font-serif text-sm">One of seven kinds of world your table can play.</span>
        </div>
      </aside>

      <section className="auth-door-form">
        <div className="w-full max-w-sm animate-fade-up-slow">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/ui/book-closed.webp" alt="" className="auth-mark" />
            <div>
              <h1 className="gold-title text-balance font-display text-3xl tracking-wide sm:text-4xl">
                Open Dungeon Master
              </h1>
              <p className="mt-2 text-pretty font-serif text-sm leading-6 text-stone-400">
                Gather your party. An AI Dungeon Master runs the table; the dice
                are honest and the story is yours.
              </p>
            </div>
          </div>

          <div className={cn(ui.card, "ornate texture-noise auth-card shadow-elev-2")}>
            <AuthForm onAuthed={onAuthed} />
          </div>

          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => setHowToOpen(true)} className={cn(ui.btnSmall, "min-h-10")}>
              <GameIcon icon={{ kind: "glyph", key: "tab-story" }} size="size-6" /> How to play
            </button>
          </div>

          <footer className="mt-6 flex items-center justify-center gap-4 border-t border-amber-500/15 pt-4">
            <a href="/licenses" className="inline-flex min-h-10 items-center text-xs text-stone-500 hover:text-amber-200">
              Licenses
            </a>
            <span className="text-xs text-stone-700">&middot;</span>
            <a href="/privacy" className="inline-flex min-h-10 items-center text-xs text-stone-500 hover:text-amber-200">
              Privacy
            </a>
            <span className="text-xs text-stone-700">&middot;</span>
            <a href="/terms" className="inline-flex min-h-10 items-center text-xs text-stone-500 hover:text-amber-200">
              Terms
            </a>
          </footer>
        </div>
      </section>

      <HowToPlayDialog open={howToOpen} onOpenChange={setHowToOpen} />
    </main>
  );
}
