"use client";

import CatalogBrowser from "@/app/characters/builder/CatalogBrowser";
import ContentPicker from "@/app/characters/builder/ContentPicker";
import type { RaceOption } from "@/app/characters/builder/useBuilderOptions";
import { GameTerm } from "@/components/ui/GameTerm";
import { contentSlug } from "@/lib/help";
import { textKey } from "@/lib/language/text-logic";
import { racialCantripsOf } from "@/lib/srd/racial-cantrips";
import { countWord } from "./lineage";
import { Chip } from "./steps/shared";

// The cantrips a race lets the player choose: a high elf's one wizard
// cantrip, or as many as a homebrew species offers (up to three). Each pick
// is a chip with its ⓘ and a remove; the list stays open until every one is
// picked, as the variant human's feat does beside it. Shown on the ancestry
// step (RacialChoicesSection.tsx) and, for a character stored before the
// picks were kept, on the library's level-up sheet (LevelUpSheet.tsx).
export function RacialCantripPicker({
  race,
  cantrips,
  onChange,
}: {
  race: Pick<RaceOption, "name" | "cantripChoice">;
  cantrips: string[];
  onChange: (cantrips: string[]) => void;
}) {
  const choice = race.cantripChoice;
  if (!choice) {
    return null;
  }
  const { list, count } = choice;
  const picked = racialCantripsOf({ cantrips }).slice(0, count);
  const word = countWord(count).toLowerCase();
  // A repeat, or a pick past the race's count, is not taken.
  const pick = (name: string) => {
    if (picked.length >= count || picked.some((entry) => textKey(entry) === textKey(name))) {
      return;
    }
    onChange([...picked, name]);
  };
  const unpick = (name: string) => onChange(picked.filter((entry) => textKey(entry) !== textKey(name)));
  return (
    <div data-builder-target="racialCantrip">
      <span className="mb-1 flex flex-wrap items-center gap-1 text-stone-400">
        {count === 1 ? (
          <>
            Bonus <GameTerm id="cantrip">cantrip</GameTerm> (one {list} cantrip)
          </>
        ) : (
          <>
            Bonus <GameTerm id="cantrip">cantrips</GameTerm> ({word} {list} cantrips, {picked.length} of {count} picked)
          </>
        )}
      </span>
      <p className="mb-1.5 text-xs text-stone-500">
        {count === 1
          ? "A cantrip is a small spell you can cast as often as you like, forever. Pick one from the list below (tap ⓘ to read what each does), or search by name if you already have one in mind."
          : `A cantrip is a small spell you can cast as often as you like, forever. Pick ${word} different ones from the list below (tap ⓘ to read what each does), or search by name if you already have some in mind.`}
      </p>
      {picked.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {picked.map((name) => (
            <Chip
              key={name}
              label={name}
              info={{ reference: { kind: "spells", slug: contentSlug(name), name } }}
              onRemove={() => unpick(name)}
            />
          ))}
        </div>
      ) : null}
      {picked.length < count ? (
        <>
          {/* Nobody can search for a cantrip they have never heard of.
              Every one this race may take is listed from the start, each
              with the ⓘ that says what it does; the search is second. */}
          <CatalogBrowser
            kind="spells"
            buttonLabel={`Every ${list} cantrip`}
            defaultOpen
            openSections={[`cantrips:${list}`]}
            selectedNames={picked}
            onPick={(entry) => pick(entry.name)}
            onUnpick={unpick}
            sections={[
              {
                key: `cantrips:${list}`,
                label: `Every ${list} cantrip`,
                params: { class: list, level: "0" },
              },
            ]}
            metaOf={(entry) => entry.school ?? ""}
          />
          <p className="mt-2 mb-1 text-xs text-stone-500">Or search by name:</p>
          <ContentPicker
            kind="spells"
            extraParams={{ class: list, level: "0" }}
            placeholder="Search cantrips (e.g. fire bolt)"
            onPick={(entry) => pick(entry.name)}
          />
        </>
      ) : null}
    </div>
  );
}
