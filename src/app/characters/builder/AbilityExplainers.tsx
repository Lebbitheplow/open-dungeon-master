"use client";

import { useState, type CSSProperties } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Ribbon } from "@/components/ui/Ribbon";
import { cn } from "@/lib/cn";
import { formatModifier } from "@/lib/srd";
import { ui } from "@/lib/ui";
import type { BuilderHp } from "./builderHp";

const stagger = (index: number, ms: number) => ({ "--i": index, "--stagger": `${ms}ms` }) as CSSProperties;

// The two gold corners an explainer draws out after its panel lands.
const Brackets = () => (
  <>
    <span className="creator-bracket" data-corner="tl" aria-hidden="true" />
    <span className="creator-bracket" data-corner="br" aria-hidden="true" />
  </>
);

// The small round "?" that opens an explainer, sized for a thumb.
export function HelpDot({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "group inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-transform duration-200 ease-[var(--ease-spring)] active:scale-90",
        className,
      )}
    >
      <span className="flex size-[1.375rem] items-center justify-center rounded-full border border-amber-500/45 font-mono text-[0.875rem] leading-none text-amber-300 transition-[border-color,box-shadow,color] duration-[var(--dur-quick)] group-hover:border-amber-500/90 group-hover:text-amber-100 group-hover:shadow-glow-gold group-focus-visible:border-amber-500/90">
        ?
      </span>
    </button>
  );
}

// Which of the three ways to use is the question a first character actually
// gets stuck on, so all three answers sit side by side with the chosen one lit.
export function MethodInfoDialog({
  open,
  onOpenChange,
  methods,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  methods: Array<{ id: string; label: string; info: string }>;
  current: string;
}) {
  const chosen = methods.find((entry) => entry.id === current) ?? methods[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={chosen.label} width="w-[min(94vw,26rem)]">
      <Brackets />
      <Ribbon className="mb-3">Three ways</Ribbon>
      <div className="flex flex-col gap-2">
        {methods.map((entry, index) => {
          const isCurrent = entry.id === current;
          return (
            <div
              key={entry.id}
              style={stagger(index, 120)}
              className={cn(
                "creator-cascade rounded-[10px] border px-3 py-2.5",
                isCurrent ? "border-amber-500/50 bg-amber-950/35" : "border-stone-700/50 bg-stone-950/60",
              )}
            >
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className={cn("font-display text-base font-semibold", isCurrent ? "text-amber-100" : "text-stone-200")}>
                  {entry.label}
                </span>
                {isCurrent ? (
                  <span className="shrink-0 font-mono text-[0.875rem] uppercase tracking-[0.08em] text-amber-300">chosen</span>
                ) : null}
              </div>
              <p className="font-serif text-base leading-normal text-stone-300">{entry.info}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => onOpenChange(false)} className={ui.btnPrimary}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

// What the health explainer needs to show its working: the builder's own
// hit points (builderHp.ts), the same figure the last step shows and the
// server saves.
export type HpExplainerInput = {
  className: string;
  con: number;
  level: number;
  hp: BuilderHp;
};

function FormulaChip({
  label,
  value,
  note,
  tone = "plain",
  index,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "plain" | "result";
  index: number;
}) {
  return (
    <span
      style={stagger(index, 70)}
      className={cn(
        "creator-chip-in flex min-w-[82px] flex-col items-center gap-0.5 rounded-[9px] border px-3 py-2",
        tone === "result" ? "border-ember-600/50 bg-ember-600/10" : "border-stone-600/45 bg-stone-950/70",
      )}
    >
      <span
        className={cn(
          "text-center font-display text-[0.875rem] font-semibold uppercase tracking-[0.16em]",
          tone === "result" ? "text-ember-300" : "text-stone-500",
        )}
      >
        {label}
      </span>
      <span className={cn("font-display text-xl font-bold leading-tight", tone === "result" ? "text-ember-300" : "text-amber-100")}>
        {value}
      </span>
      <span className="text-center font-mono text-[0.875rem] text-stone-500">{note}</span>
    </span>
  );
}

const Op = ({ children }: { children: string }) => (
  <span className="font-display text-lg font-bold text-stone-500" aria-hidden="true">
    {children}
  </span>
);

export function HpExplainerDialog({
  open,
  onOpenChange,
  hp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hp: HpExplainerInput;
}) {
  const { parts, method, kept, maxHp } = hp.hp;
  const klass = hp.className.toLowerCase();
  const later = hp.level > 1;
  const signed = (value: number) => `${value >= 0 ? "+" : "-"} ${Math.abs(value)}`;
  const extra = parts.featureHp ? ` + ${parts.featureHp}` : "";
  // A class list (backlog F9): each class's later levels on its own die.
  const split = hp.hp.split?.filter((entry) => entry.levels > 0) ?? null;
  const laterTerms = split ? split.map((entry) => `${entry.levels} x ${entry.perLevel}`).join(" + ") : `${hp.level - 1} x ${parts.perLevel}`;
  const laterTotal = split ? split.reduce((total, entry) => total + entry.levels * entry.perLevel, 0) : parts.laterLevels;
  const sum = later
    ? `${parts.firstLevel} + ${laterTerms}${extra} = ${parts.total}`
    : `${parts.hitDie} ${signed(parts.conMod)}${parts.bonusPerLevel ? ` + ${parts.bonusPerLevel}` : ""}${extra} = ${parts.total}`;
  const laterDie =
    method === "max"
      ? `the die's highest face (${parts.face})`
      : method === "rolled"
        ? `a roll of the die when you save; until then it counts the average (${parts.face})`
        : `the die's average (${parts.face})`;
  const steps = [
    `A ${klass} rolls a d${parts.hitDie} for health. At first level you do not roll it: you take the best it can give.`,
    `Your Constitution of ${hp.con} is worth ${formatModifier(parts.conMod)}, and that applies to every level you gain.`,
    later && split
      ? `Each level after the first adds its own class's die (${split.map((entry) => `d${entry.hitDie}`).join(", ")}), ${method === "max" ? "at its highest face" : method === "rolled" ? "rolled when you save, counted at its average until then" : "at its average"}, plus that modifier, so ${hp.level - 1} more levels add ${laterTotal}. You begin on ${parts.total}.`
      : later
      ? `Each level after the first adds ${laterDie} plus that modifier, so ${hp.level - 1} more ${hp.level === 2 ? "level adds" : "levels add"} ${parts.laterLevels}. You begin on ${parts.total}.`
      : `So you begin on ${parts.total}. Rest fully and you are back to it.`,
    ...(kept
      ? [`This character was saved with ${maxHp}, and keeps that number while its level and Constitution stay as they were.`]
      : []),
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="How your health is worked out" width="w-[min(94vw,26rem)]">
      <Brackets />
      <p className="mb-4 font-serif text-base leading-normal text-stone-300">
        At first level you take the best your hit die can give, then add your Constitution modifier.
      </p>
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        <FormulaChip index={0} label="Hit die max" value={`d${parts.hitDie}`} note={hp.className} />
        <Op>+</Op>
        <FormulaChip index={1} label="Con mod" value={formatModifier(parts.conMod)} note={`(${hp.con})`} />
        {later ? (
          <>
            <Op>+</Op>
            <FormulaChip
              index={2}
              label={`Levels 2 to ${hp.level}`}
              value={String(laterTotal)}
              note={laterTerms}
            />
          </>
        ) : null}
        <Op>=</Op>
        <FormulaChip
          index={later ? 3 : 2}
          tone="result"
          label={later ? "Max hp" : "Starting hp"}
          value={String(maxHp)}
          note={kept ? "as saved" : "full health"}
        />
      </div>
      <p className="mb-3.5 text-center font-mono text-base text-amber-300">{sum}</p>
      {parts.bonusPerLevel ? (
        <p className="mb-3 text-center font-mono text-sm text-stone-500">
          Includes +{parts.bonusPerLevel} per level from your lineage and feats.
        </p>
      ) : null}
      {parts.featureHp ? (
        <p className="mb-3 text-center font-mono text-sm text-stone-500">
          Includes +{parts.featureHp} from Draconic Resilience.
        </p>
      ) : null}
      <ol className="flex flex-col gap-[7px]">
        {steps.map((text, index) => (
          <li
            key={index}
            style={stagger(index, 80)}
            className="creator-cascade flex items-start gap-2.5 rounded-[9px] border border-stone-700/50 bg-stone-950/60 px-2.5 py-2"
          >
            <span className="flex size-[1.375rem] shrink-0 items-center justify-center rounded-full border border-amber-500/40 font-mono text-[0.875rem] text-amber-300">
              {index + 1}
            </span>
            <span className="font-serif text-base leading-snug text-stone-300">{text}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => onOpenChange(false)} className={ui.btnPrimary}>
          Got it
        </button>
      </div>
    </Dialog>
  );
}

// The labelled button under the abilities summary, and the bare "?" beside
// the Max HP line on the last step: two doors to the same explainer.
export function HpExplainerButton({ hp, compact = false }: { hp: HpExplainerInput; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <HelpDot label="How your health is worked out" onClick={() => setOpen(true)} className="-my-2" />
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={cn(ui.btnSmall, "text-xs")}>
          <span className="flex size-[1.25rem] items-center justify-center rounded-full border border-amber-500/50 font-mono text-[0.875rem] text-amber-300">
            ?
          </span>
          How is my health worked out?
        </button>
      )}
      <HpExplainerDialog open={open} onOpenChange={setOpen} hp={hp} />
    </>
  );
}
