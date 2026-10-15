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
}

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
  const delta = Math.max(-input.maxStep, Math.min(input.maxStep, target - previous));
  const desired = clampLevel(previous + delta);
  const direction = Math.sign(target - previous);
  const preferences: number[] = [desired];
  for (let step = Math.abs(delta) - 1; step >= 0; step--) preferences.push(clampLevel(previous + direction * step));
  for (let step = 1; step <= input.maxStep; step++) preferences.push(clampLevel(previous - direction * step));
  if (direction === 0) for (let step = 1; step <= input.maxStep; step++) preferences.push(clampLevel(previous + step));
  for (const level of [...new Set(preferences)]) {
    if (input.isAvailable(level)) return { level, target, constrained: level !== desired };
  }
  return { level: previous, target, constrained: true };
}
