"use client";

import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select, type SelectOption } from "@/components/ui/Select";

// The shapes and the field furniture the admin settings sections share.

export type MaskedConfig = {
  signupsEnabled: boolean;
  signupMode: "open" | "invite" | "closed";
  serverName: string;
  accountDeletionGraceDays: number;
  publicUrl: string;
  text: {
    provider: "" | "local" | "custom";
    localTextModel: string;
    customBaseUrl: string;
    customModel: string;
    hasCustomApiKey: boolean;
    utilityProvider: "" | "local" | "custom";
    utilityModel: string;
    utilityBaseUrl: string;
    hasUtilityApiKey: boolean;
  };
  images: {
    defaultBackend: "" | "comfyui" | "openai" | "mflux-hs" | "sdnq-hs";
    comfyUrl: string;
    comfyCheckpoint: string;
    fluxWorkerUrl: string;
    openaiBaseUrl: string;
    openaiModel: string;
    hasOpenaiApiKey: boolean;
  };
  speech: { kokoroUrl: string; sttUrl: string };
  voiceChat: {
    enabled: "" | "on" | "off";
    mode: "" | "sfu" | "mesh";
    announcedIp: string;
    domain: string;
    rtcPort: string;
  };
  discord: { clientId: string; hasClientSecret: boolean };
};

export type EnvDefaults = {
  customBaseUrl: string;
  customModel: string;
  hasCustomApiKey: boolean;
  comfyUrl: string;
  fluxWorkerUrl: string;
  imageBackend: string;
  hasOpenaiImageApiKey: boolean;
  kokoroUrl: string;
  sttUrl: string;
  discordClientId: string;
  hasDiscordClientSecret: boolean;
  publicUrl: string;
  voiceEnabled: boolean;
  voiceAnnouncedIp: string;
  voiceDomain: string;
  voiceRtcPort: string;
};

// A secret field never receives its stored value; SECRET_KEPT means "leave it
// as is" and is stripped from the patch before sending.
export const SECRET_KEPT = "\u0000keep";

export function Field({
  label,
  hint,
  group = false,
  children,
}: {
  label: string;
  hint?: string;
  // A kit control (Select, NumberStepper) names itself and is not an input a
  // <label> can wrap, so its field is a labelled group instead.
  group?: boolean;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span className="mb-1 block text-xs font-medium text-stone-400">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-stone-500">{hint}</span> : null}
    </>
  );
  return group ? (
    <div role="group" aria-label={label} className="block">
      {body}
    </div>
  ) : (
    <label className="block">{body}</label>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
}) {
  return (
    <Field label={label} hint={hint} group>
      <Select value={value} onChange={onChange} options={options} label={label} className="w-full" />
    </Field>
  );
}

export function SecretField({
  label,
  isSet,
  value,
  onChange,
  hint,
}: {
  label: string;
  isSet: boolean;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const kept = value === SECRET_KEPT;
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        <input
          type="password"
          className={ui.input}
          placeholder={isSet && kept ? "•••••••• (set)" : "Not set"}
          value={kept ? "" : value}
          onChange={(event) => onChange(event.target.value)}
        />
        {isSet && kept ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className={cn(ui.btnSmall, "shrink-0 hover:text-red-400")}
          >
            Clear
          </button>
        ) : null}
      </div>
    </Field>
  );
}

