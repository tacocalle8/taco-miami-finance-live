import { requireAuth } from '../../lib/auth.js';
import { sendError } from '../../lib/config.js';
import { listAccounts, listTransactions } from '../../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const [accounts, transactions] = await Promise.all([listAccounts(), listTransactions(req.query?.limit)]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, accounts, transactions });
  } catch (error) {
    return sendError(res, error);
  }
}
