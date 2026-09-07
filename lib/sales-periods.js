const DAY_MS = 24 * 60 * 60 * 1000;

function assertDateString(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new TypeError('La fecha debe usar el formato YYYY-MM-DD.');
  }
}

export function shiftDate(date, days) {
  assertDateString(date);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day) + Number(days) * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function salesWeekPeriods(date) {
  assertDateString(date);
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = shiftDate(date, -daysSinceMonday);

  return {
    startDate: monday,
    endDate: shiftDate(monday, 6),
    mondayToThursday: {
      startDate: monday,
      endDate: shiftDate(monday, 3),
      endExclusiveDate: shiftDate(monday, 4)
    },
    fridayToSunday: {
      startDate: shiftDate(monday, 4),
      endDate: shiftDate(monday, 6),
      endExclusiveDate: shiftDate(monday, 7)
    }
  };
}
