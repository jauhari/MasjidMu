/**
 * Generate occurrence start dates for recurring mosque events.
 *
 * - weekly: every 7 days from anchor
 * - interval_days: every N days (selapanan = 35)
 * - monthly: same calendar day each month
 */

export const RECURRENCE_TYPES = ['none', 'weekly', 'interval_days', 'monthly'] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];

export const DEFAULT_RECURRENCE_HORIZON_MONTHS = 6;
export const MAX_RECURRENCE_OCCURRENCES = 52;

export interface RecurrenceInput {
  type: RecurrenceType;
  startsAt: Date;
  intervalDays?: number;
  /** Explicit end date for the series. Ignored when openEnded is true. */
  recurrenceUntil?: Date | null;
  /** No end date — generate up to MAX_RECURRENCE_OCCURRENCES ahead. */
  openEnded?: boolean;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCMonth(r.getUTCMonth() + months);
  if (r.getUTCDate() < day) {
    r.setUTCDate(0);
  }
  return r;
}

function defaultUntil(startsAt: Date): Date {
  return addMonths(startsAt, DEFAULT_RECURRENCE_HORIZON_MONTHS);
}

export function generateOccurrenceStarts(input: RecurrenceInput): Date[] {
  if (input.type === 'none') return [input.startsAt];

  const openEnded = input.openEnded === true;
  const until = openEnded ? null : (input.recurrenceUntil ?? defaultUntil(input.startsAt));
  const starts: Date[] = [new Date(input.startsAt)];
  let current = new Date(input.startsAt);

  while (starts.length < MAX_RECURRENCE_OCCURRENCES) {
    if (input.type === 'weekly') {
      current = addDays(current, 7);
    } else if (input.type === 'interval_days') {
      const days = input.intervalDays ?? 7;
      if (days < 1) break;
      current = addDays(current, days);
    } else if (input.type === 'monthly') {
      current = addMonths(current, 1);
    } else {
      break;
    }

    if (until && current.getTime() > until.getTime()) break;
    starts.push(new Date(current));
  }

  return starts;
}

export function shiftEndsAt(
  occurrenceStart: Date,
  anchorStart: Date,
  anchorEnd: Date | null,
): Date | null {
  if (!anchorEnd) return null;
  const durationMs = anchorEnd.getTime() - anchorStart.getTime();
  return new Date(occurrenceStart.getTime() + durationMs);
}

export type EventOccurrenceRow = {
  id: string;
  seriesId: string | null;
  occurrenceIndex: number;
  startsAt: Date;
  [key: string]: unknown;
};

export function groupEventsBySeries<T extends EventOccurrenceRow>(
  rows: T[],
): Array<T & { seriesCount: number; seriesFirstStartsAt: Date; seriesLastStartsAt: Date }> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.seriesId ?? row.id;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const grouped = [...groups.values()].map((evs) => {
    const sorted = [...evs].sort(
      (a, b) =>
        a.occurrenceIndex - b.occurrenceIndex ||
        a.startsAt.getTime() - b.startsAt.getTime(),
    );
    const rep = sorted[0]!;
    const startMs = sorted.map((e) => e.startsAt.getTime());
    return {
      ...rep,
      seriesCount: sorted.length,
      seriesFirstStartsAt: new Date(Math.min(...startMs)),
      seriesLastStartsAt: new Date(Math.max(...startMs)),
    };
  });

  return grouped.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
}

export function recurrenceLabel(
  type: RecurrenceType,
  intervalDays: number | null | undefined,
): string | null {
  if (type === 'none') return null;
  if (type === 'weekly') return 'Mingguan';
  if (type === 'monthly') return 'Bulanan';
  if (type === 'interval_days') {
    if (intervalDays === 35) return 'Selapanan (35 hari)';
    if (intervalDays != null) return `Setiap ${intervalDays} hari`;
    return 'Interval hari';
  }
  return null;
}