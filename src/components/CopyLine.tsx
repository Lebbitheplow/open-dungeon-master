"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

// One line of text to copy: a command to run, a token shown once, a setup
// line. The tick draws itself in when the copy lands.
export function CopyLine({ text, label, block = false }: { text: string; label: string; block?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={block ? "hx-code items-start whitespace-pre" : "hx-code"}>
      <code className="select-all">{text}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        className="motion-press shrink-0 rounded p-1 text-stone-400 hover:text-amber-200"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            })
            .catch(() => undefined);
        }}
      >
        {copied ? <Check key="done" className="tick-in size-4 text-emerald-400" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
