import { requireAuth } from '../../lib/auth.js';
import { ensureCloverSchema } from '../../lib/clover-db.js';
import { sendError } from '../../lib/config.js';
import { getSql } from '../../lib/db.js';
import { combineQuarterTax } from '../../lib/sales-tax.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const currentYear = new Date().getUTCFullYear();
    const year = Math.min(Math.max(Number(req.query?.year) || currentYear, 2026), 2030);
    await ensureCloverSchema();
    const sql = getSql();
    const startMs = Date.UTC(year, 0, 1, 5);
    const endMs = Date.UTC(year + 1, 0, 1, 5);
    const [paymentRows, refundRows, coverageRows] = await Promise.all([
      sql`
        SELECT
          EXTRACT(QUARTER FROM TO_TIMESTAMP(created_time / 1000.0) AT TIME ZONE 'America/New_York')::int AS quarter,
          COALESCE(SUM(tax_cents), 0) AS tax_cents
        FROM clover_payments
        WHERE created_time >= ${startMs}
          AND created_time < ${endMs}
          AND (result IS NULL OR result = 'SUCCESS')
        GROUP BY quarter
      `,
      sql`
        SELECT
          EXTRACT(QUARTER FROM TO_TIMESTAMP(created_time / 1000.0) AT TIME ZONE 'America/New_York')::int AS quarter,
          COALESCE(SUM(tax_cents), 0) AS tax_cents
        FROM clover_refunds
        WHERE created_time >= ${startMs}
          AND created_time < ${endMs}
          AND (result IS NULL OR result = 'SUCCESS')
        GROUP BY quarter
      `,
      sql`
        SELECT MIN(created_time) AS earliest_time
        FROM (
          SELECT created_time FROM clover_payments
          UNION ALL
          SELECT created_time FROM clover_refunds
        ) AS clover_activity
      `
    ]);
    const coverageStartMs = Number(coverageRows[0]?.earliest_time) || null;
    const quarters = combineQuarterTax(year, paymentRows, refundRows).map(quarter => {
      const quarterStartMs = Date.UTC(year, (quarter.quarter - 1) * 3, 1, 5);
      const quarterEndMs = Date.UTC(year, quarter.quarter * 3, 1, 5);
      const coverage = !coverageStartMs || coverageStartMs >= quarterEndMs
        ? 'unavailable'
        : coverageStartMs > quarterStartMs ? 'partial' : 'full';
      return { ...quarter, coverage, taxCents: coverage === 'unavailable' ? null : quarter.taxCents };
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      year,
      cadence: 'quarterly',
      coverageStartMs,
      quarters
    });
  } catch (error) {
    return sendError(res, error);
  }
}
