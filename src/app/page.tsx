"use client";

import { Loader2, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
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
      <main className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-stone-500" />
      </main>
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
        <div className="glass texture-noise rounded-xl p-6 shadow-elev-2">
          <h1 className="mb-1 font-display text-xl tracking-wide text-amber-50">
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

function AuthScreen({ onAuthed }: { onAuthed: (user: SessionUser) => void }) {
  const [howToOpen, setHowToOpen] = useState(false);

  return (
    <main className="bg-starfield flex flex-1 items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-sm animate-fade-up-slow">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <PixelTile src={PIXEL_ICONS.story} size="size-16" className="animate-twinkle" />
          <div>
            <h1 className="text-balance font-display text-3xl tracking-wide text-amber-50">
              Open Dungeon Master
            </h1>
            <p className="mt-2 text-pretty text-sm text-stone-400">
              Gather your party. An AI Dungeon Master runs the table; the dice
              are honest and the story is yours.
            </p>
          </div>
        </div>

        <div className="glass texture-noise rounded-xl p-6 shadow-elev-2">
          <AuthForm onAuthed={onAuthed} />
        </div>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setHowToOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs text-stone-500 transition-colors hover:text-amber-200"
          >
            <ScrollText className="size-3.5" /> How to play
          </button>
        </div>

        <footer className="mt-6 flex items-center justify-center gap-4 border-t border-stone-900 pt-4">
          <a href="/licenses" className="text-xs text-stone-600 hover:text-stone-400">
            Licenses
          </a>
          <span className="text-xs text-stone-700">&middot;</span>
          <a href="/privacy" className="text-xs text-stone-600 hover:text-stone-400">
            Privacy
          </a>
          <span className="text-xs text-stone-700">&middot;</span>
          <a href="/terms" className="text-xs text-stone-600 hover:text-stone-400">
            Terms
          </a>
        </footer>
      </div>

      <HowToPlayDialog open={howToOpen} onOpenChange={setHowToOpen} />
    </main>
  );
}
