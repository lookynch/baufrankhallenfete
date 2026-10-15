import { z } from 'zod';

const MINUTE = 60_000;

export const MIN_VOTING_MINUTES = 17;

export const moodLevels = [1, 2, 3, 4, 5] as const;
export type MoodLevel = (typeof moodLevels)[number];
export const moodLevelSchema = z.number().int().min(1).max(5);

export const settingsSchemas = {
  event: z.object({
    name: z.string().min(1).max(80),
    startsAt: z.number().int(),
    endsAt: z.number().int(),
  }),
  voting: z.object({
    enabled: z.boolean(),
    startsAt: z.number().int(),
    endsAt: z.number().int().nullable(),
    firstRoundMinutes: z.number().int().min(MIN_VOTING_MINUTES).max(120),
    minRoundMinutes: z.number().int().min(MIN_VOTING_MINUTES).max(120),
    candidatesPerRound: z.number().int().min(4).max(30),
    maxMoodStep: z.number().int().min(1).max(4),
    allowExplicit: z.boolean(),
  }),
  preshow: z.object({
    playlistUri: z
      .string()
      .regex(/^spotify:playlist:[A-Za-z0-9]+$/)
      .nullable(),
    level: moodLevelSchema,
  }),
  nextRound: z.object({
    levelOverride: moodLevelSchema.nullable(),
  }),
  security: z.object({
    votesPerIpV4: z.number().int().min(1).max(50),
    votesPerIpV6: z.number().int().min(1).max(50),
    votesPerNetV6: z.number().int().min(1).max(200),
  }),
  ledger: z.object({
    cratePriceCents: z.number().int().min(1).max(100_000),
    budgetCents: z.number().int().min(0).max(100_000_000),
    inventoryAccount: z.string().min(1).max(10),
    expenseAccount: z.string().min(1).max(10),
    payableAccount: z.string().min(1).max(10),
  }),
  buzzer: z.object({
    reviewIntervalSeconds: z.number().int().min(0).max(120),
  }),
  polling: z.object({
    tvMs: z.number().int().min(2_000).max(60_000),
    playerMs: z.number().int().min(2_000).max(60_000),
    barMs: z.number().int().min(5_000).max(120_000),
    guestMs: z.number().int().min(5_000).max(120_000),
  }),
};

export type SettingsKey = keyof typeof settingsSchemas;
export type Settings = { [K in SettingsKey]: z.infer<(typeof settingsSchemas)[K]> };

export function defaultEventStart(now: number): number {
  const evening = new Date(now - 12 * 60 * MINUTE);
  evening.setUTCHours(17, 0, 0, 0);
  return evening.getTime();
}

export function defaultSettings(now: number): Settings {
  const start = defaultEventStart(now);
  return {
    event: { name: 'Baufrankhallen-Fete', startsAt: start, endsAt: start + 7 * 60 * MINUTE },
    voting: {
      enabled: true,
      startsAt: start + 60 * MINUTE,
      endsAt: null,
      firstRoundMinutes: MIN_VOTING_MINUTES,
      minRoundMinutes: MIN_VOTING_MINUTES,
      candidatesPerRound: 12,
      maxMoodStep: 1,
      allowExplicit: true,
    },
    preshow: { playlistUri: null, level: 2 },
    nextRound: { levelOverride: null },
    security: { votesPerIpV4: 3, votesPerIpV6: 1, votesPerNetV6: 5 },
    ledger: {
      cratePriceCents: 1_890,
      budgetCents: 150_000,
      inventoryAccount: '3980',
      expenseAccount: '4140',
      payableAccount: '1600',
    },
    buzzer: { reviewIntervalSeconds: 3 },
    polling: { tvMs: 5_000, playerMs: 10_000, barMs: 15_000, guestMs: 15_000 },
  };
}
