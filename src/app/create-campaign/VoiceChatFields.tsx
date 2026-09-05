"use client";

import type { GameSettings } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";

type VoiceSettings = GameSettings["voice"];

// Live voice for a multiplayer table: the master switch, then the turn
// floor and the proximity rules that only mean something once it is on.
// A solo table never mounts this block; there is nobody to talk to.
export function VoiceChatFields({
  value,
  onChange,
}: {
  value: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
}) {
  const setRule = (rules: Partial<VoiceSettings["rules"]>) =>
    onChange({ ...value, rules: { ...value.rules, ...rules } });
  return (
    <div>
      <FieldLabel className="mb-1.5">Voice chat</FieldLabel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ToggleCard
          active={value.enabled}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          label="Voice chat"
          hint="Talk live in the lobby and at the table"
        />
        {value.enabled ? (
          <>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">Turn floor</span>
              <select
                value={value.turnEnforcement}
                onChange={(event) =>
                  onChange({
                    ...value,
                    turnEnforcement: event.target.value as VoiceSettings["turnEnforcement"],
                  })
                }
                className={inputClass}
              >
                <option value="off">Turns: ignored</option>
                <option value="soft">Turns: shown</option>
                <option value="strict">Turns: enforced</option>
              </select>
            </label>
            <ToggleCard
              active={value.rules.proximity}
              onClick={() => setRule({ proximity: !value.rules.proximity })}
              label="Proximity"
              hint="The battle map decides who hears whom"
            />
            {value.rules.proximity ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-500">Hearing range</span>
                  <select
                    value={value.rules.hearingRangeFeet}
                    onChange={(event) =>
                      setRule({ hearingRangeFeet: Number(event.target.value) })
                    }
                    className={inputClass}
                  >
                    {[15, 30, 60, 120].map((feet) => (
                      <option key={feet} value={feet}>
                        {feet} ft
                      </option>
                    ))}
                  </select>
                </label>
                <ToggleCard
                  active={value.rules.sayRange}
                  onClick={() => setRule({ sayRange: !value.rules.sayRange })}
                  label="Whisper and shout"
                  hint="Speakers pick how far their words carry"
                />
                <ToggleCard
                  active={value.rules.wallsAttenuate}
                  onClick={() => setRule({ wallsAttenuate: !value.rules.wallsAttenuate })}
                  label="Walls muffle"
                  hint="A wall muffles a voice instead of cutting it"
                />
              </>
            ) : null}
            <ToggleCard
              active={value.rules.downedGoDeaf}
              onClick={() => setRule({ downedGoDeaf: !value.rules.downedGoDeaf })}
              label="Downed go deaf"
              hint="At 0 hit points a character stops hearing the table"
            />
          </>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">
        The server has its own switch for live audio too; if the owner keeps it off, these
        settings wait until it is on.
      </p>
    </div>
  );
}
