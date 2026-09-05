"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { ui } from "@/lib/ui";

// One line of text asked for in the app's own dialog. window.prompt was
// the previous answer, and Electron does not implement it: the desktop
// shell threw where the browser asked. This asks the same question
// everywhere, and reads on a phone.

type PromptProps = {
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
  submitLabel?: string;
  // A pin with no label is a plain marker, so some prompts accept nothing.
  allowEmpty?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
};

// The form mounts with the dialog's content and unmounts with it, so its
// state starts from defaultValue on every opening without an effect
// having to reset it.
function PromptForm({
  label,
  defaultValue = "",
  placeholder,
  maxLength = 80,
  submitLabel = "Save",
  allowEmpty = false,
  onSubmit,
  onClose,
}: PromptProps) {
  const [value, setValue] = useState(defaultValue);
  const trimmed = value.trim();
  const canSubmit = allowEmpty || trimmed.length > 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) {
          return;
        }
        onSubmit(trimmed.slice(0, maxLength));
        onClose();
      }}
      className="space-y-3"
    >
      <label className="block">
        {label ? <span className="text-xs text-stone-400">{label}</span> : null}
        <input
          autoFocus
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          className={`${ui.input} mt-1 w-full`}
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className={ui.btnSecondary}>
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit} className={ui.btnPrimary}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  ...prompt
}: Omit<PromptProps, "onClose"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      {open ? <PromptForm {...prompt} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}
