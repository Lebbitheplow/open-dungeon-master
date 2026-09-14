import { z } from "zod";

// The shape of a calendar a table or a world pack writes by hand
// (docs/vtt-parity-implementation-plan.md section 7.1). Shared by the clock
// route and the world pack schema so the two cannot drift.

export const calendarMoonSchema = z.object({
  name: z.string().trim().min(1).max(40),
  cycleDays: z.number().int().min(2).max(400),
  // Days into the cycle on day zero, so a pack can say the moon was full
  // on the night the campaign starts.
  offset: z.number().int().min(0).max(400).default(0),
});

export const calendarFestivalSchema = z.object({
  month: z.number().int().min(1).max(24),
  day: z.number().int().min(1).max(400),
  name: z.string().trim().min(1).max(60),
});

export const calendarDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(40).default("custom"),
  name: z.string().trim().min(1).max(60),
  months: z
    .array(z.object({ name: z.string().trim().min(1).max(40), days: z.number().int().min(1).max(400) }))
    .min(1)
    .max(24),
  weekdays: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  yearSuffix: z.string().trim().max(20).default(""),
  epochYear: z.number().int().default(1),
  moons: z.array(calendarMoonSchema).max(6).default([]),
  festivals: z.array(calendarFestivalSchema).max(40).default([]),
});

export type CalendarDefinitionInput = z.infer<typeof calendarDefinitionSchema>;
