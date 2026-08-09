// Per-role sampling: the story model and the utility model want different
// settings, and today both get one hardcoded default.
//
// The profile idea and the cloud-safe/local-only split come from
// NarrativeEngine-P's SamplingPanel and samplingProfiles
// (src/components/SamplingPanel.tsx, src/utils/samplingProfiles.ts, MIT,
// Copyright (c) 2026 Sagesheep). Most operators want a starting point rather
// than eight sliders, and sending a local-only parameter to a strict endpoint
// is an error rather than a no-op.
//
// One deliberate omission, and it is the important one. presence_penalty is
// NOT configurable here. model-client.ts pins it to 0 with a measured reason:
// a positive presence penalty over the long DM prompt suppresses the
// tool-call token sequence (2/5 versus 4/5 request_roll on llama-server with
// a preset of 1.5). Exposing it would let an operator silently break dice
// rolling while the prompt still looks fine, so the pin stays and this module
// does not offer it at any profile.
//
// Dependency-free so scripts/test-sampling.mjs can import it directly.

export type SamplingRole = "story" | "utility";

// Parameters every OpenAI-compatible endpoint accepts.
export const CLOUD_SAFE_PARAMS = ["temperature", "top_p"] as const;
// Parameters local inference servers understand and strict cloud APIs reject.
export const LOCAL_ONLY_PARAMS = ["top_k", "min_p", "repeat_penalty"] as const;

export type SamplingConfig = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repeat_penalty?: number;
};

// ODM's current behaviour, reproduced exactly so an unconfigured install
// changes nothing: model-client.ts uses 0.7 when thinking is on and 0.9 when
// it is off, per Qwen's guidance that thinking runs cooler.
export const STORY_TEMP_THINKING = 0.7;
export const STORY_TEMP_DEFAULT = 0.9;

export type ProfileId = "default" | "balanced" | "creative" | "precise";

export type Profile = {
  id: ProfileId;
  label: string;
  description: string;
  // Absent means "leave ODM's built-in behaviour alone", which is what keeps
  // the default a genuine no-op rather than a re-statement of the defaults.
  story?: SamplingConfig;
  utility?: SamplingConfig;
};

export const PROFILES: readonly Profile[] = [
  {
    id: "default",
    label: "ODM default",
    description:
      "Whatever the build ships with: 0.9 for narration, 0.7 when the model is thinking. Nothing is sent that is not already sent.",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Slightly tighter narration, near-deterministic mechanical work.",
    story: { temperature: 0.85, top_p: 0.95 },
    utility: { temperature: 0.3, top_p: 0.9 },
  },
  {
    id: "creative",
    label: "Creative",
    description:
      "Looser, more surprising narration. Mechanical work stays tight, because JSON extraction does not benefit from imagination.",
    story: { temperature: 1.0, top_p: 0.98 },
    utility: { temperature: 0.3, top_p: 0.9 },
  },
  {
    id: "precise",
    label: "Precise",
    description:
      "Consistent, low-variance prose. Useful when a model wanders or repeats itself between turns.",
    story: { temperature: 0.6, top_p: 0.9 },
    utility: { temperature: 0.1, top_p: 0.85 },
  },
] as const;

export function profileById(id: string): Profile | undefined {
  return PROFILES.find((profile) => profile.id === id);
}

// Ranges are enforced here rather than at the boundary alone, so a value that
// slipped through an older config cannot reach a backend that would reject
// the whole request over it.
const LIMITS: Record<keyof SamplingConfig, { min: number; max: number }> = {
  temperature: { min: 0, max: 2 },
  top_p: { min: 0, max: 1 },
  top_k: { min: 0, max: 200 },
  min_p: { min: 0, max: 1 },
  repeat_penalty: { min: 0, max: 2 },
};

export function clampSampling(config: SamplingConfig): SamplingConfig {
  const out: SamplingConfig = {};
  for (const [key, value] of Object.entries(config) as Array<
    [keyof SamplingConfig, number | undefined]
  >) {
    const limit = LIMITS[key];
    // An unrecognised key is dropped rather than forwarded or thrown on. This
    // is the path presence_penalty takes when a stale config or a crafted
    // request tries to set it: it simply never reaches the payload.
    if (!limit || typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    out[key] = Math.max(limit.min, Math.min(limit.max, value));
  }
  return out;
}

// Strict endpoints reject unknown fields outright, so a local-only parameter
// must never be spread into a cloud request. `local` covers ODM's own local
// provider and any self-hosted OpenAI-compatible server the operator marks as
// such; everything else gets the cloud-safe set only.
export function filterForProvider(
  config: SamplingConfig,
  allowLocalOnly: boolean,
): SamplingConfig {
  const allowed = new Set<string>([
    ...CLOUD_SAFE_PARAMS,
    ...(allowLocalOnly ? LOCAL_ONLY_PARAMS : []),
  ]);
  const out: SamplingConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (allowed.has(key) && typeof value === "number") {
      out[key as keyof SamplingConfig] = value;
    }
  }
  return out;
}

export type ResolveInput = {
  role: SamplingRole;
  // The operator's saved per-role overrides, if any.
  configured?: SamplingConfig;
  // A named profile's contribution, applied under the overrides.
  profile?: Profile;
  allowLocalOnly: boolean;
  // Only meaningful for the story role: ODM runs thinking calls cooler.
  thinking?: boolean;
};

// Resolution order, narrowest first: an explicit per-role override beats the
// profile, which beats ODM's built-in default. The built-in default is only
// materialised for the story role, because that is the only one model-client
// currently special-cases.
export function resolveSampling(input: ResolveInput): SamplingConfig {
  const fromProfile = input.profile?.[input.role] ?? {};
  const merged: SamplingConfig = { ...fromProfile, ...(input.configured ?? {}) };
  const clamped = clampSampling(merged);

  if (clamped.temperature === undefined && input.role === "story") {
    clamped.temperature = input.thinking ? STORY_TEMP_THINKING : STORY_TEMP_DEFAULT;
  }
  return filterForProvider(clamped, input.allowLocalOnly);
}

// True when resolving would send exactly what ODM sends today, so callers can
// prove an unconfigured install is untouched.
export function isDefaultOnly(config: SamplingConfig | undefined): boolean {
  return !config || Object.keys(clampSampling(config)).length === 0;
}
