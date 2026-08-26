import { requireAuth } from '../../lib/auth.js';
import { ensureCloverSchema } from '../../lib/clover-db.js';
import { sendError } from '../../lib/config.js';
import { getSql } from '../../lib/db.js';
import {
  combineVisitSales,
  listPropertyVisits,
  summarizeVisitsByProperty
} from '../../lib/property-visits.js';

function newYorkMidnight(date) {
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const year = Math.min(Math.max(Number(req.query?.year) || 2026, 2026), 2030);
    const scheduledVisits = listPropertyVisits(year);
    if (!scheduledVisits.length) {
      return res.status(200).json({ ok: true, year, visits: [], properties: [] });
    }

    await ensureCloverSchema();
    const sql = getSql();
    const startMs = newYorkMidnight(scheduledVisits[0].date);
    const endMs = newYorkMidnight(nextDate(scheduledVisits.at(-1).date));
    const [paymentRows, refundRows] = await Promise.all([
      sql`
        SELECT
          TO_CHAR(TO_TIMESTAMP(created_time / 1000.0) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS visit_date,
          COALESCE(SUM(amount_cents), 0) AS payment_amount_cents,
          COALESCE(SUM(tip_cents), 0) AS payment_tip_cents,
          COALESCE(SUM(tax_cents), 0) AS payment_tax_cents,
          COALESCE(SUM(surcharge_cents + convenience_fee_cents + other_charge_cents), 0) AS payment_fee_cents,
          COUNT(*) AS transactions
        FROM clover_payments
        WHERE store_key = 'original'
          AND created_time >= ${startMs}
          AND created_time < ${endMs}
          AND (result IS NULL OR result = 'SUCCESS')
        GROUP BY visit_date
      `,
      sql`
        SELECT
          TO_CHAR(TO_TIMESTAMP(created_time / 1000.0) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS visit_date,
          COALESCE(SUM(amount_cents), 0) AS refund_amount_cents,
          COALESCE(SUM(tip_cents), 0) AS refund_tip_cents,
          COALESCE(SUM(tax_cents), 0) AS refund_tax_cents,
          COALESCE(SUM(surcharge_cents + convenience_fee_cents + other_charge_cents), 0) AS refund_fee_cents,
          COUNT(*) AS refunds
        FROM clover_refunds
        WHERE store_key = 'original'
          AND created_time >= ${startMs}
          AND created_time < ${endMs}
          AND (result IS NULL OR result = 'SUCCESS')
        GROUP BY visit_date
      `
    ]);
    const visits = combineVisitSales(scheduledVisits, paymentRows, refundRows);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      year,
      attribution: 'Todas las ventas de Food Truck Original del día se asignan a la propiedad programada.',
      visits,
      properties: summarizeVisitsByProperty(visits)
    });
  } catch (error) {
    return sendError(res, error);
  }
}
