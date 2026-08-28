import { requireAuth } from '../../lib/auth.js';
import { buildCloverSummary } from '../../lib/clover.js';
import { aggregateCloverActivity, listCloverActivity, listCloverMerchants } from '../../lib/clover-db.js';
import { sendError } from '../../lib/config.js';

function newYorkMidnight(year, monthIndex) {
  const utcNoon = new Date(Date.UTC(year, monthIndex, 1, 12));
  const zoneName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset'
  }).formatToParts(utcNoon).find(part => part.type === 'timeZoneName')?.value || 'GMT-05:00';
  const match = zoneName.match(/GMT([+-])(\d{2}):(\d{2})/);
  const direction = match?.[1] === '+' ? 1 : -1;
  const offsetMinutes = match ? direction * (Number(match[2]) * 60 + Number(match[3])) : -300;
  return Date.UTC(year, monthIndex, 1) - offsetMinutes * 60 * 1000;
}

function monthBounds(month) {
  const valid = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = valid.split('-').map(Number);
  return {
    month: valid,
    startMs: newYorkMidnight(year, monthNumber - 1),
    endMs: newYorkMidnight(year, monthNumber)
  };
}

function newYorkDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function newYorkDayMidnight(date) {
  const [year, month, day] = date.split('-').map(Number);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const zoneName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset'
  }).formatToParts(utcNoon).find(part => part.type === 'timeZoneName')?.value || 'GMT-05:00';
  const match = zoneName.match(/GMT([+-])(\d{2}):(\d{2})/);
  const direction = match?.[1] === '+' ? 1 : -1;
  const offsetMinutes = match ? direction * (Number(match[2]) * 60 + Number(match[3])) : -300;
  return Date.UTC(year, month - 1, day) - offsetMinutes * 60 * 1000;
}

function nextDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function previousDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const bounds = monthBounds(req.query?.month);
    const todayDate = newYorkDateString();
    const todayStartMs = newYorkDayMidnight(todayDate);
    const todayEndMs = newYorkDayMidnight(nextDate(todayDate));
    const yesterdayDate = previousDate(todayDate);
    const yesterdayStartMs = newYorkDayMidnight(yesterdayDate);
    const yesterdayEndMs = todayStartMs;
    const merchants = await listCloverMerchants();
    const [activity, aggregate, todayAggregate, yesterdayAggregate] = await Promise.all([
      listCloverActivity(bounds.startMs, bounds.endMs, req.query?.limit),
      aggregateCloverActivity(bounds.startMs, bounds.endMs),
      aggregateCloverActivity(todayStartMs, todayEndMs),
      aggregateCloverActivity(yesterdayStartMs, yesterdayEndMs)
    ]);
    const summary = buildCloverSummary(merchants, aggregate.payments, aggregate.refunds);
    const todaySummary = buildCloverSummary(merchants, todayAggregate.payments, todayAggregate.refunds);
    const yesterdaySummary = buildCloverSummary(merchants, yesterdayAggregate.payments, yesterdayAggregate.refunds);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      month: bounds.month,
      merchants,
      payments: activity.payments,
      refunds: activity.refunds,
      summary,
      today: { date: todayDate, summary: todaySummary },
      yesterday: { date: yesterdayDate, summary: yesterdaySummary }
    });
  } catch (error) {
    return sendError(res, error);
  }
}
