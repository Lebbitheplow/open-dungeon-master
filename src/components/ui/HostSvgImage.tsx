"use client";

import { useEffect, useState, type SVGProps } from "react";
import { shellHost } from "@/lib/shell-host";

// An SVG <image> of the host's own pictures (a token's portrait, the board's
// backdrop). Inside the desktop and Android apps the page's origin is the
// app's own: an <image> given a root-relative href asks the app's origin for
// it the moment the attribute is set (a stray 404 on every table load),
// before the app's watcher can point it at the host. So in the app the
// picture is fetched first, through the page's fetch, which the app sends to
// the host with the player's session, and the <image> is drawn from the
// copy. In a browser, and during server rendering, it is an ordinary
// <image>. A picture that cannot be had draws nothing (the token's initial
// stays underneath).
const copies = new Map<string, Promise<string>>();

function hostCopy(path: string): Promise<string> {
  let copy = copies.get(path);
  if (!copy) {
    copy = fetch(path)
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => (blob ? URL.createObjectURL(blob) : ""))
      .catch(() => "");
    copies.set(path, copy);
  }
  return copy;
}

const rootRelative = (path: string) => path.startsWith("/") && !path.startsWith("//");

export function HostSvgImage({ href, ...rest }: Omit<SVGProps<SVGImageElement>, "ref"> & { href: string }) {
  const inApp = typeof window !== "undefined" && Boolean(shellHost()?.navigation) && rootRelative(href);
  const [copy, setCopy] = useState<{ for: string; url: string } | null>(null);
  useEffect(() => {
    if (!inApp) return;
    let live = true;
    void hostCopy(href).then((url) => {
      if (live) setCopy({ for: href, url });
    });
    return () => {
      live = false;
    };
  }, [inApp, href]);
  const shown = inApp ? (copy?.for === href && copy.url ? copy.url : undefined) : href;
  return <image {...rest} href={shown} />;
}
