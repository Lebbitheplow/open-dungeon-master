"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CircleHelp, LogOut, Settings, ShieldCheck, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { HelpDialog } from "@/components/HelpDialog";
import { Tooltip } from "@/components/ui/Tooltip";

// The one account menu, extracted from the home page so every top-level page
// offers the same doors. Only the fields the menu draws from, so any page's
// own user shape (SessionUser, a settings Me) can be passed as-is.
export type AccountMenuUser = {
  username: string;
  avatar?: { url: string } | null;
  isAdmin?: boolean;
};

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100";

export function AccountMenu({
  user,
  onLogout,
}: {
  user: AccountMenuUser;
  // The home page swaps back to the login screen in place; every other page
  // just leaves. Omitting the prop gets the redirect.
  onLogout?: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
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
            className="min-w-44 rounded-lg border border-stone-600/60 bg-stone-950 p-1 shadow-elev-2"
          >
            <DropdownMenu.Item asChild>
              <Link href="/characters" className={itemClass}>
                <Users className="size-4" /> Characters
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
            <DropdownMenu.Item onSelect={() => setHelpOpen(true)} className={itemClass}>
              <CircleHelp className="size-4" /> Help
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-stone-800" />
            <DropdownMenu.Item onSelect={logout} className={itemClass}>
              <LogOut className="size-4" /> Log out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}
