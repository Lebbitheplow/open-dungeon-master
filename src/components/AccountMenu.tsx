"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AppWindow,
  CircleHelp,
  DoorOpen,
  HeartHandshake,
  LogOut,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { HelpDialog } from "@/components/HelpDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { headerButtonClass } from "@/app/campaigns/[campaignId]/headerButton";
import { cn } from "@/lib/cn";
import { shellHost, type ShellHost } from "@/lib/shell-host";

// window.odmShell is set once before any page script runs and never changes.
const subscribeNever = () => () => {};

// The book tile and wordmark at the top of a page. In a browser it leads
// to this server's home; inside the desktop or Android app it leads to the
// app's own home screen, because that is what the same mark does on every
// screen of the app, and a mark that does one thing here and nothing there
// is the first thing a newcomer trips over.
export function AppBrand({
  children,
  className,
}: {
  // The tile and wordmark, laid out by the caller.
  children: ReactNode;
  className?: string;
}) {
  const shell = useSyncExternalStore<ShellHost | null>(subscribeNever, shellHost, () => null);
  const classes = cn(
    "flex min-w-0 items-center gap-2.5 rounded-md text-left outline-none transition-colors hover:text-amber-200 focus-visible:text-amber-200",
    className,
  );
  if (shell) {
    return (
      <Tooltip content="Back to the app's home screen" side="bottom">
        <button type="button" onClick={() => shell.showServers()} aria-label="App home" className={classes}>
          {children}
        </button>
      </Tooltip>
    );
  }
  return (
    <Link href="/" className={classes}>
      {children}
    </Link>
  );
}

// Inside the desktop or Android app, the one visible way back to the app's
// own home screen (its servers, device world and settings) from any page:
// the account menu offers the same door, but a door behind an avatar is
// not a door a newcomer finds. Renders nothing in a plain browser.
export function AppHomeButton({ className }: { className?: string }) {
  const shell = useSyncExternalStore<ShellHost | null>(subscribeNever, shellHost, () => null);
  if (!shell) return null;
  return (
    <Tooltip content="Back to the app's home screen" side="bottom">
      <button
        type="button"
        onClick={() => shell.showServers()}
        aria-label="App home"
        className={headerButtonClass(false, className)}
      >
        <AppWindow className="size-4" />
      </button>
    </Tooltip>
  );
}

// The one account menu, extracted from the home page so every top-level page
// offers the same doors. Only the fields the menu draws from, so any page's
// own user shape (SessionUser, a settings Me) can be passed as-is.
export type AccountMenuUser = {
  username: string;
  avatar?: { url: string } | null;
  isAdmin?: boolean;
  // Present while the account is scheduled for deletion (AppHeader's banner).
  deletionDueAt?: string | null;
};

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100";

export function AccountMenu({
  user,
  onLogout,
  onHelp,
}: {
  user: AccountMenuUser;
  // The home page swaps back to the login screen in place; every other page
  // just leaves. Omitting the prop gets the redirect.
  onLogout?: () => void;
  // A page with its own Help (the table, whose dialog also offers the
  // tours) opens that instead of the menu's plain copy.
  onHelp?: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const pathname = usePathname();
  // Inside the desktop or Android app the menu grows a door back to the
  // app's server list. The host object is a client-only global, so it is
  // read as an external store with a null server snapshot: server and
  // client markup agree, and the entry appears right after hydration.
  const shell = useSyncExternalStore<ShellHost | null>(subscribeNever, shellHost, () => null);
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    if (onLogout) {
      onLogout();
    } else {
      router.push("/");
    }
  }

  return (
    <>
      <DropdownMenu.Root>
        <Tooltip content="Account and app menu" side="bottom">
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="Account"
              className="rounded-full outline-none transition-shadow duration-150 hover:shadow-glow-gold focus-visible:shadow-glow-gold"
            >
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar.url}
                  alt=""
                  className="size-9 rounded-full border border-amber-500/40 object-cover"
                />
              ) : (
                <span className="flex size-9 items-center justify-center rounded-full border border-stone-600/70 bg-stone-900">
                  <UserRound className="size-4 text-stone-400" />
                </span>
              )}
            </button>
          </DropdownMenu.Trigger>
        </Tooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="min-w-44 rounded-lg border border-stone-600/60 bg-stone-950 p-1 shadow-elev-2"
          >
            {pathname !== "/" ? (
              <DropdownMenu.Item asChild>
                <Link href="/" className={itemClass}>
                  <DoorOpen className="size-4" /> All campaigns
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item asChild>
              <Link href="/characters" className={itemClass}>
                <Users className="size-4" /> Characters
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link href="/friends" className={itemClass}>
                <HeartHandshake className="size-4" /> Friends
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link href="/settings" className={itemClass}>
                <Settings className="size-4" /> Settings
              </Link>
            </DropdownMenu.Item>
            {user.isAdmin ? (
              <DropdownMenu.Item asChild>
                <Link href="/admin" className={itemClass}>
                  <ShieldCheck className="size-4" /> Admin panel
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item
              onSelect={() => (onHelp ? onHelp() : setHelpOpen(true))}
              className={itemClass}
            >
              <CircleHelp className="size-4" /> Help
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-stone-800" />
            {shell ? (
              <DropdownMenu.Item onSelect={() => shell.showServers()} className={itemClass}>
                <AppWindow className="size-4" /> App home
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item onSelect={logout} className={itemClass}>
              <LogOut className="size-4" /> Log out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {onHelp ? null : <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />}
    </>
  );
}
