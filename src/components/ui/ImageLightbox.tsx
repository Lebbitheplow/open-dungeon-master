"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Download, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

// Build a friendly download filename: slugified caption/alt plus the file
// extension parsed from the URL, so saved portraits read "my-hero.png" rather
// than a bare UUID. Falls back to "image" and drops the extension if unknown.
function downloadName(src: string, label: string) {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "image";
  const match = /\.(png|jpe?g|webp|gif)(?:[?#]|$)/i.exec(src);
  return match ? `${slug}.${match[1].toLowerCase()}` : slug;
}

// Click-to-enlarge wrapper for any stored image (DM scene art, area maps,
// character portraits). The thumbnail is the trigger, the dialog shows the
// image at full size. Esc and the overlay close it, both free from Radix.
// State lives here so opening one image never re-renders the caller.
export function ImageLightbox({
  src,
  alt,
  caption,
  className,
}: {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = caption || alt;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Enlarge image: ${label}`}
          className="block cursor-zoom-in transition-opacity hover:opacity-90"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className={className} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/85" />
        <Dialog.Content className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 p-4 outline-none sm:p-8">
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className="max-h-[88vh] max-w-full rounded-lg object-contain shadow-elev-1"
          />
          {caption ? (
            <p className="max-w-2xl text-center text-sm text-stone-400">{caption}</p>
          ) : null}
          <div className="absolute right-3 top-3 flex items-center gap-2 sm:right-6 sm:top-6">
            <a
              href={src}
              download={downloadName(src, label)}
              aria-label="Download image"
              className={cn(
                "rounded-md border border-stone-700 bg-stone-950/80 p-2",
                "text-stone-400 hover:text-stone-100",
              )}
            >
              <Download className="size-4" />
            </a>
            <Dialog.Close
              aria-label="Close image"
              className={cn(
                "rounded-md border border-stone-700 bg-stone-950/80 p-2",
                "text-stone-400 hover:text-stone-100",
              )}
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
