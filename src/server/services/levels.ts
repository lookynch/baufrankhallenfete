import type { SetRow } from './library.ts';
import { setActiveAt } from './library.ts';

export interface LevelPlanInput {
  previousLevel: number;
  maxStep: number;
  overrideTarget: number | null;
  sets: SetRow[];
  expectedPlayAt: number;
  roundMs: number;
  isAvailable: (level: number) => boolean;
}

export interface LevelPlan {
  level: number;
  target: number;
  constrained: boolean;
  matched: boolean;
}

const LEVELS = [1, 2, 3, 4, 5];
const clampLevel = (level: number) => Math.min(5, Math.max(1, level));

export function targetLevel(input: Omit<LevelPlanInput, 'isAvailable'>): number {
  if (input.overrideTarget !== null) return input.overrideTarget;
  const current = setActiveAt(input.sets, input.expectedPlayAt);
  let target = current?.default_level ?? input.previousLevel;
  const upcoming = input.sets
    .filter((s) => s.starts_at > input.expectedPlayAt)
    .sort((a, b) => a.starts_at - b.starts_at);
  for (const set of upcoming) {
    const roundsUntil = Math.max(0, Math.floor((set.starts_at - input.expectedPlayAt) / input.roundMs));
    const distance = Math.abs(set.default_level - input.previousLevel);
    if (distance > roundsUntil * input.maxStep) {
      target = set.default_level;
      break;
    }
  }
  return target;
}

export function planLevel(input: LevelPlanInput): LevelPlan {
  const target = targetLevel(input);
  const previous = clampLevel(input.previousLevel);
  const desired = clampLevel(previous + Math.max(-input.maxStep, Math.min(input.maxStep, target - previous)));
  const level = LEVELS.filter((l) => Math.abs(l - previous) <= input.maxStep)
    .sort(
      (a, b) =>
        Math.abs(a - desired) - Math.abs(b - desired) ||
        Math.abs(a - target) - Math.abs(b - target) ||
        Math.abs(a - previous) - Math.abs(b - previous),
    )
    .find((l) => input.isAvailable(l));
  if (level === undefined) return { level: previous, target, constrained: true, matched: false };
  return { level, target, constrained: level !== desired, matched: true };
}

export function nearestLevel(previousLevel: number, target: number, isAvailable: (level: number) => boolean) {
  const previous = clampLevel(previousLevel);
  return LEVELS.filter(isAvailable).sort(
    (a, b) => Math.abs(a - previous) - Math.abs(b - previous) || Math.abs(a - target) - Math.abs(b - target),
  )[0];
}
