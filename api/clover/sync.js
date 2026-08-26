import { requireAuth } from '../../lib/auth.js';
import { fetchRecentCloverData } from '../../lib/clover.js';
import {
  listCloverMerchants,
  markCloverSynced,
  upsertCloverPayments,
  upsertCloverRefunds
} from '../../lib/clover-db.js';
import { sendError } from '../../lib/config.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const merchants = await listCloverMerchants({ includeTokens: true });
    let payments = 0;
    let refunds = 0;
    for (const merchant of merchants) {
      const now = Date.now();
      const maximumHistory = now - 89 * 24 * 60 * 60 * 1000;
      const overlapStart = merchant.last_synced_at
        ? new Date(merchant.last_synced_at).getTime() - 24 * 60 * 60 * 1000
        : maximumHistory;
      const data = await fetchRecentCloverData(merchant, {
        startMs: Math.max(maximumHistory, overlapStart),
        endMs: now
      });
      await upsertCloverPayments(data.payments);
      await upsertCloverRefunds(data.refunds);
      await markCloverSynced(merchant.store_key);
      payments += data.payments.length;
      refunds += data.refunds.length;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, stores: merchants.length, payments, refunds });
  } catch (error) {
    return sendError(res, error);
  }
}
