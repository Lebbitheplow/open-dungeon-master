"use client";

import { Loader2 } from "lucide-react";
import { use, useCallback, useEffect, useState } from "react";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import AuthForm from "@/app/AuthForm";

// Invite-link landing: /join/CODE. Logged-in users are joined and forwarded
// to the campaign; everyone else logs in or registers first.
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [state, setState] = useState<"checking" | "auth" | "joining" | "error">("checking");
  const [error, setError] = useState("");

  const join = useCallback(async () => {
    setState("joining");
    try {
      const response = await fetch("/api/campaigns/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code.toUpperCase() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not join the campaign.");
        setState("error");
        return;
      }
      window.location.href = `/campaigns/${data.campaign.id}`;
    } catch {
      setError("Could not reach the server.");
      setState("error");
    }
  }, [code]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data) => {
        if (data.user) {
          join();
        } else {
          setState("auth");
        }
      })
      .catch(() => setState("auth"));
  }, [join]);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-stone-800 bg-stone-950/70 p-6">
        <div className="mb-6 flex items-center gap-3">
          <PixelTile src={PIXEL_ICONS.chats} />
          <div>
            <h1 className="font-serif text-xl text-stone-100">Join the party</h1>
            <p className="text-sm text-stone-500">
              Room code <span className="font-mono text-amber-200">{code.toUpperCase()}</span>
            </p>
          </div>
        </div>

        {state === "checking" || state === "joining" ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-stone-500" />
          </div>
        ) : state === "error" ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-red-400">{error}</p>
            <a href="/" className="text-sm text-amber-200 hover:text-amber-400">
              Back to Open Dungeon Master
            </a>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-stone-400">
              Log in or create an account to join this campaign.
            </p>
            <AuthForm onAuthed={() => join()} />
          </>
        )}
      </div>
    </main>
  );
}
