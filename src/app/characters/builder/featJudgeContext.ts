"use client";

import { createContext, useContext } from "react";
import type { FeatJudge } from "./featPrereqs";

// The builder's feat judge (featPrereqs.ts builderFeatJudge), handed to the
// feat pickers below CharacterBuilder. A client module of its own so that
// featPrereqs.ts, which the save check reads, carries no React context.
export const FeatJudgeContext = createContext<FeatJudge | null>(null);

export function useFeatJudge(): FeatJudge | null {
  return useContext(FeatJudgeContext);
}
