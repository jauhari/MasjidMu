import { describe, expect, it } from 'vitest';
import { generateOccurrenceStarts, groupEventsBySeries } from './event-recurrence.js';

describe('generateOccurrenceStarts', () => {
  it('returns single date for none', () => {
    const start = new Date('2026-06-01T19:00:00.000Z');
    expect(generateOccurrenceStarts({ type: 'none', startsAt: start })).toEqual([start]);
  });

  it('generates weekly occurrences until limit', () => {
    const start = new Date('2026-06-01T19:00:00.000Z');
    const until = new Date('2026-06-22T19:00:00.000Z');
    const dates = generateOccurrenceStarts({
      type: 'weekly',
      startsAt: start,
      recurrenceUntil: until,
    });
    expect(dates.map((d) => d.toISOString())).toEqual([
      '2026-06-01T19:00:00.000Z',
      '2026-06-08T19:00:00.000Z',
      '2026-06-15T19:00:00.000Z',
      '2026-06-22T19:00:00.000Z',
    ]);
  });

  it('generates open-ended weekly up to max cap', () => {
    const start = new Date('2026-06-01T19:00:00.000Z');
    const dates = generateOccurrenceStarts({
      type: 'weekly',
      startsAt: start,
      openEnded: true,
    });
    expect(dates).toHaveLength(52);
    expect(dates[51].toISOString()).toBe('2027-05-24T19:00:00.000Z');
  });

  it('groups recurring rows into one series entry', () => {
    const seriesId = '11111111-1111-1111-1111-111111111111';
    const grouped = groupEventsBySeries([
      {
        id: 'a',
        seriesId,
        occurrenceIndex: 0,
        startsAt: new Date('2026-06-01T19:00:00.000Z'),
      },
      {
        id: 'b',
        seriesId,
        occurrenceIndex: 1,
        startsAt: new Date('2026-06-08T19:00:00.000Z'),
      },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.seriesCount).toBe(2);
    expect(grouped[0]?.id).toBe('a');
  });

  it('generates selapanan (35-day) intervals', () => {
    const start = new Date('2026-01-01T10:00:00.000Z');
    const until = new Date('2026-03-15T10:00:00.000Z');
    const dates = generateOccurrenceStarts({
      type: 'interval_days',
      startsAt: start,
      intervalDays: 35,
      recurrenceUntil: until,
    });
    expect(dates.length).toBe(3);
    expect(dates[1].toISOString()).toBe('2026-02-05T10:00:00.000Z');
    expect(dates[2].toISOString()).toBe('2026-03-12T10:00:00.000Z');
  });
});