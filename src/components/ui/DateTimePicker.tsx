"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { cn } from "@/lib/cn";

// The kit's date and time picker (docs/visual-overhaul-plan.md 8c.4), a
// drop-in for <input type="datetime-local">: it takes and gives the same
// "YYYY-MM-DDTHH:mm" string in local time. A plated field opens a calendar
// month (arrows step the month, today is ringed, the chosen day wears the
// gold foil) over an hour and minute pair. With `dateOnly` it is a date
// picker and the string is "YYYY-MM-DD".
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const pad = (value: number) => String(value).padStart(2, "0");

function parse(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function format(date: Date, dateOnly: boolean): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return dateOnly ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DateTimePicker({
  value,
  onChange,
  label,
  dateOnly = false,
  min,
  disabled = false,
  placeholder = "Pick a date",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  dateOnly?: boolean;
  // Earliest day that can be picked, same string format.
  min?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const chosen = parse(value);
  const earliest = min ? parse(min) : null;
  const [shown, setShown] = useState(() => {
    const base = chosen ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  // Which way the month last turned, so the grid slides in from that side.
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);

  const today = new Date();
  const first = new Date(shown.getFullYear(), shown.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate();
  const cells: Array<number | null> = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];

  const pick = (day: number) => {
    const base = chosen ?? new Date(shown.getFullYear(), shown.getMonth(), day, 19, 0);
    onChange(format(new Date(shown.getFullYear(), shown.getMonth(), day, base.getHours(), base.getMinutes()), dateOnly));
  };
  const setTime = (hours: number, minutes: number) => {
    const base = chosen ?? new Date();
    onChange(format(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes), dateOnly));
  };
  const same = (a: Date | null, year: number, month: number, day: number) =>
    !!a && a.getFullYear() === year && a.getMonth() === month && a.getDate() === day;

  const reads = chosen
    ? chosen.toLocaleString(undefined, dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" })
    : placeholder;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild disabled={disabled}>
        <button type="button" aria-label={label} disabled={disabled} className={cn("kit-select", className)}>
          <CalendarDays className="size-4 shrink-0 text-amber-300/80" aria-hidden="true" />
          <span className={cn("min-w-0 grow truncate text-left", !chosen && "text-stone-500")}>{reads}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} collisionPadding={10} className="panel kit-date z-[75]">
          <div className="kit-date-head">
            <button
              type="button"
              aria-label="Earlier month"
              className="kit-date-nav"
              onClick={() => {
                setTurn("prev");
                setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1));
              }}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <span className="kit-date-month">{shown.toLocaleString(undefined, { month: "long", year: "numeric" })}</span>
            <button
              type="button"
              aria-label="Later month"
              className="kit-date-nav"
              onClick={() => {
                setTurn("next");
                setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1));
              }}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="kit-date-week" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div key={`${shown.getFullYear()}-${shown.getMonth()}`} className="kit-date-grid" data-turn={turn ?? undefined}>
            {cells.map((day, index) =>
              day === null ? (
                <span key={`gap-${index}`} />
              ) : (
                <button
                  key={day}
                  type="button"
                  disabled={!!earliest && new Date(shown.getFullYear(), shown.getMonth(), day, 23, 59) < earliest}
                  data-on={same(chosen, shown.getFullYear(), shown.getMonth(), day) ? "" : undefined}
                  data-today={same(today, shown.getFullYear(), shown.getMonth(), day) ? "" : undefined}
                  onClick={() => pick(day)}
                  className="kit-date-day"
                >
                  {day}
                </button>
              ),
            )}
          </div>
          {dateOnly ? null : (
            <div className="kit-date-time">
              <NumberStepper label="Hour" size="sm" min={0} max={23} value={chosen?.getHours() ?? 19} onChange={(hours) => setTime(hours, chosen?.getMinutes() ?? 0)} />
              <span className="text-stone-500">:</span>
              <NumberStepper label="Minute" size="sm" min={0} max={55} step={5} value={chosen?.getMinutes() ?? 0} onChange={(minutes) => setTime(chosen?.getHours() ?? 19, minutes)} />
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
