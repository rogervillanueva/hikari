import type { SrsData } from './types';

export function updateSrsItem(data: SrsData, grade: 0 | 1 | 2 | 3 | 4 | 5): SrsData {
  const now = Date.now();
  const next: SrsData = { ...data };
  if (grade < 2) {
    next.reps = 0;
    next.interval = 1;
  } else {
    next.EF = Math.max(1.3, next.EF + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
    next.reps += 1;
    if (next.reps === 1) {
      next.interval = 1;
    } else if (next.reps === 2) {
      next.interval = 6;
    } else {
      next.interval = Math.round(next.interval * next.EF);
    }
  }
  next.last = now;
  next.due = now + next.interval * 86400000;
  return next;
}
