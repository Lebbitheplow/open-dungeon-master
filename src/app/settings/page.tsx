"use client";

import { Check, Link2, Loader2, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, UserAvatar, ui } from "@/lib/ui";
import { DiceLookEditor } from "@/components/DiceLookEditor";
import { PageLoading, PageNotice, PageSection, PageShell } from "@/components/PageShell";
import { GameIcon } from "@/components/ui/GameIcon";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { DeleteAccountDialog } from "@/app/settings/DeleteAccountDialog";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { AppearanceSection } from "@/app/settings/AppearanceSection";
import { BlockedPlayersSection } from "@/app/settings/BlockedPlayersSection";
import { ConnectedAgentsSection } from "@/app/settings/ConnectedAgentsSection";
import { ChangePasswordForm } from "@/app/ChangePasswordForm";
import { currentPathname, currentQuery, replaceAddress } from "@/lib/navigation";

type Me = {
  id: string;
  username: string;
  avatar: { url: string } | null;
  isAdmin?: boolean;
  discordLinked?: boolean;
  discordAvailable?: boolean;
  hasPassword?: boolean;
  deletionDueAt?: string | null;
};

function dueDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Account settings: profile picture, password, Discord link, deletion, and
// the About card naming the server.
export default function SettingsPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [cropping, setCropping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  // Set once the server has accepted the request: this session is over, so
  // the page turns into the farewell note instead of re-fetching anything.
  const [scheduled, setScheduled] = useState<{ dueAt: string; purged: boolean } | null>(null);
  const [keeping, setKeeping] = useState(false);
  // Server identity for the About section, from the same public endpoint
  // the login form and client apps read. graceDays feeds the deletion copy.
  const [about, setAbout] = useState<{
    serverName: string;
    version: string;
    graceDays: number;
  } | null>(null);
  // A world one of the apps hosts: guests never chose a password (the app
  // minted one and renews their session with it), so offering to change it
  // would lock them out of their own seat. The host keeps the option.
  const [deviceWorld, setDeviceWorld] = useState(false);
  // Seeded from the Discord link redirect (?linked=1 / ?error=...).
  const [discordNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    const query = currentQuery();
    if (query.get("linked") === "1") return "Discord account linked.";
    if (query.get("error") === "discord_taken") {
      return "That Discord account is already linked to another user.";
    }
    return "";
  });

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMe(data?.user ?? null))
      .finally(() => setLoading(false));
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        setDeviceWorld(data?.deviceWorld === true);
        if (data?.serverName && data?.version) {
          setAbout({
            serverName: data.serverName,
            version: data.version,
            graceDays:
              typeof data.accountDeletionGraceDays === "number" ? data.accountDeletionGraceDays : 14,
          });
        }
      })
      .catch(() => undefined);
    const query = currentQuery();
    if (query.get("linked") || query.get("error")) {
      replaceAddress(currentPathname());
    }
  }, []);

  async function setAvatar(avatar: { url: string } | null) {
    setSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar }),
      });
      if (response.ok && me) {
        setMe({ ...me, avatar });
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount() {
    if (!me) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch("/api/profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(me.hasPassword ? { password: deleteConfirm } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDeleteError(data.error || "Could not delete your account.");
        setDeleting(false);
        return;
      }
      setConfirmingDelete(false);
      setScheduled({ dueAt: data.dueAt, purged: data.purged === true });
    } catch {
      setDeleteError("Could not delete your account.");
      setDeleting(false);
    }
  }

  async function keepAccount() {
    setKeeping(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepAccount: true }),
      });
      if (response.ok) {
        setMe((current) => (current ? { ...current, deletionDueAt: null } : current));
      }
    } finally {
      setKeeping(false);
    }
  }

  function flashPasswordSaved() {
    setPasswordChanged(true);
    setTimeout(() => setPasswordChanged(false), 2500);
  }

  // The confirm button unlocks on the right password, or on typing DELETE for
  // Discord-only accounts that have no password.
  const deleteReady = me?.hasPassword ? deleteConfirm.length > 0 : deleteConfirm === "DELETE";
  const graceDays = about?.graceDays ?? 14;
  const graceCopy =
    graceDays === 0
      ? "Your account, the campaigns you created, your characters and your pictures are erased immediately."
      : `Your account is signed out everywhere and erased after ${graceDays} day${graceDays === 1 ? "" : "s"}, together with the campaigns you created, your characters and your pictures. Signing in before then lets you keep it.`;

  if (loading) {
    return <PageLoading width="narrow" />;
  }

  if (scheduled) {
    return (
      <PageNotice width="narrow">
        {scheduled.purged
          ? "Your account and everything it owned have been deleted. "
          : `Your account is scheduled for deletion on ${dueDate(scheduled.dueAt)}. You have been signed out everywhere. To keep it, sign in again before then and choose "Keep my account". `}
        <Link href="/" className="text-amber-200 hover:text-amber-400">
          Back to the front door
        </Link>
      </PageNotice>
    );
  }

  if (!me) {
    return (
      <PageNotice width="narrow">
        <Link href="/" className="text-amber-200 hover:text-amber-400">
          Log in
        </Link>{" "}
        to manage your account.
      </PageNotice>
    );
  }

  return (
    <PageShell
      user={me}
      width="narrow"
      icon={PIXEL_ICONS.characters}
      glyph="tab-settings"
      title="Account settings"
      blurb={`Signed in as ${me.username}`}
      actions={
        me.isAdmin ? (
          <Link href="/admin" className={ui.btnSecondary}>
            <GameIcon icon={{ kind: "glyph", key: "tab-admin" }} size="size-6" /> Admin panel
          </Link>
        ) : null
      }
    >
      <PageSection heading="Profile picture" glyph="tab-characters">
        <div className="flex items-center gap-5">
          <span className="medallion">
            {me.avatar ? (
              <ImageLightbox
                src={me.avatar.url}
                alt="Your avatar"
                caption="Your avatar"
                className="size-24 rounded-full object-cover"
              />
            ) : (
              // Nobody chose a picture: the sigil this account hashes to, the
              // same one the lobby and the table already show for them.
              <UserAvatar userId={me.id} size="size-24" />
            )}
          </span>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setCropping(true)}
              disabled={saving}
              className={ui.btnPrimary}
            >
              {me.avatar ? "Change picture" : "Add picture"}
            </button>
            {me.avatar ? (
              <button
                type="button"
                onClick={() => setAvatar(null)}
                disabled={saving}
                className={cn(ui.btnSmall, "text-xs hover:border-red-500/50 hover:text-red-400")}
              >
                <Trash2 className="size-3.5" /> Remove
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-xs text-stone-500">
          Shown next to your name in lobbies and at the table. Character portraits are set on each
          character.
        </p>
      </PageSection>

      <PageSection
        heading="Your dice"
        glyph="die-d20"
        intro="The virtual dice that tumble across every table you sit at. Pick a set to start from, then change the colours, pattern and finish; the preview rolls as you go."
      >
        <DiceLookEditor />
      </PageSection>

      {deviceWorld && !me.isAdmin ? null : (
      <PageSection heading={me.hasPassword === false ? "Set a password" : "Password"} glyph="tab-admin">
        {me.hasPassword === false ? (
          <>
            <p className="mb-3 text-sm text-stone-400">
              You sign in with Discord. Set a password to also log in with your username, for
              example in the desktop and mobile apps.
            </p>
            {/* lockCurrent hides the current-password field; the server
                skips verification for accounts that have none. */}
            <ChangePasswordForm
              currentPassword=""
              lockCurrent
              submitLabel="Set password"
              onChanged={() => {
                setMe((current) => (current ? { ...current, hasPassword: true } : current));
                flashPasswordSaved();
              }}
            />
          </>
        ) : (
          <ChangePasswordForm onChanged={flashPasswordSaved} />
        )}
        {passwordChanged ? (
          <p className="reveal mt-2 inline-flex items-center gap-1 text-sm text-emerald-400">
            <Check className="size-4" /> Password saved. Other devices were signed out.
          </p>
        ) : null}
      </PageSection>
      )}

      {me.discordAvailable || me.discordLinked ? (
        <PageSection heading="Discord" glyph="system-share">
          {me.discordLinked ? (
            <p className="reveal text-sm text-stone-400">
              <Check className="mr-1 inline size-4 text-emerald-400" />
              Linked. You can sign in with Discord.
            </p>
          ) : (
            <a href="/api/auth/discord/start?link=1" className={ui.btnSmall}>
              <Link2 className="size-3.5" /> Link Discord account
            </a>
          )}
          {discordNotice ? <p className="live-in mt-2 text-sm text-amber-300">{discordNotice}</p> : null}
        </PageSection>
      ) : null}

      <AppearanceSection />
      <BlockedPlayersSection />
      <ConnectedAgentsSection />

      {me.deletionDueAt ? (
        <PageSection
          heading="Deletion scheduled"
          glyph="quest-failed"
          ribbon="Pending"
          ribbonTone="ember"
          tone="danger"
          intro={`This account will be permanently deleted on ${dueDate(me.deletionDueAt)}. Until then everything still works, and you can call it off.`}
        >
          <button
            type="button"
            onClick={keepAccount}
            disabled={keeping}
            className={ui.btnPrimary}
          >
            {keeping ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            Keep my account
          </button>
        </PageSection>
      ) : (
        <PageSection
          heading="Delete account"
          glyph="quest-failed"
          ribbon="Irreversible"
          ribbonTone="ember"
          tone="danger"
          intro={graceCopy}
        >
          <button
            type="button"
            onClick={() => {
              setDeleteConfirm("");
              setDeleteError("");
              setConfirmingDelete(true);
            }}
            className={cn(ui.btnSmall, "hover:border-red-500/50 hover:text-red-400")}
          >
            <Trash2 className="size-3.5" /> Delete account
          </button>
        </PageSection>
      )}

      <PageSection heading="About" glyph="system-lore">
        {about ? (
          <p className="reveal text-sm text-stone-300">
            {about.serverName} <span className="text-stone-500">v{about.version}</span>
          </p>
        ) : (
          <p className="text-sm text-stone-500">Open Dungeon Master</p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/reference" className={ui.btnSmall}>
            Rules reference
          </Link>
          <Link href="/terms" className={ui.btnSmall}>
            Terms of service
          </Link>
          <Link href="/privacy" className={ui.btnSmall}>
            Privacy policy
          </Link>
          <Link href="/licenses" className={ui.btnSmall}>
            Licenses and attribution
          </Link>
          <a
            href="https://github.com/Lebbitheplow/open-dungeon-master"
            target="_blank"
            rel="noopener noreferrer"
            className={ui.btnSmall}
          >
            GitHub
          </a>
        </div>
      </PageSection>

      {cropping ? (
        <AvatarCropDialog
          title="Profile picture"
          onUploaded={(image) => setAvatar({ url: image.url })}
          onClose={() => setCropping(false)}
        />
      ) : null}

      {confirmingDelete ? (
        <DeleteAccountDialog
          hasPassword={Boolean(me.hasPassword)}
          graceCopy={graceCopy}
          graceDays={graceDays}
          value={deleteConfirm}
          onValue={setDeleteConfirm}
          error={deleteError}
          deleting={deleting}
          ready={deleteReady}
          onConfirm={deleteAccount}
          onClose={() => setConfirmingDelete(false)}
        />
      ) : null}
    </PageShell>
  );
}
