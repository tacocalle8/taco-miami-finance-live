import assert from 'node:assert/strict';
import test from 'node:test';
import { salesWeekPeriods, shiftDate } from '../lib/sales-periods.js';

test('shifts dates across month and year boundaries', () => {
  assert.equal(shiftDate('2026-09-01', -1), '2026-08-31');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
});

test('splits a sales week into Monday-Thursday and Friday-Sunday', () => {
  assert.deepEqual(salesWeekPeriods('2026-09-07'), {
    startDate: '2026-09-07',
    endDate: '2026-09-13',
    mondayToThursday: {
      startDate: '2026-09-07',
      endDate: '2026-09-10',
      endExclusiveDate: '2026-09-11'
    },
    fridayToSunday: {
      startDate: '2026-09-11',
      endDate: '2026-09-13',
      endExclusiveDate: '2026-09-14'
    }
  });
});

test('keeps Sunday in the week that began six days earlier', () => {
  const periods = salesWeekPeriods('2027-01-03');
  assert.equal(periods.startDate, '2026-12-28');
  assert.equal(periods.endDate, '2027-01-03');
  assert.equal(periods.fridayToSunday.startDate, '2027-01-01');
});
