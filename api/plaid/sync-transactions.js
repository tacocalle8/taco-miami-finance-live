import { requireAuth } from '../../lib/auth.js';
import { plaidRequest, sendError } from '../../lib/config.js';
import { decryptToken, listItems, saveCursor, upsertTransactions } from '../../lib/db.js';

async function syncItem(item) {
  const accessToken = decryptToken(item.access_token_encrypted);
  let cursor = item.cursor || undefined;
  let hasMore = true;
  let pageCount = 0;
  let changed = 0;

  while (hasMore && pageCount < 50) {
    const data = await plaidRequest('/transactions/sync', {
      access_token: accessToken,
      cursor,
      count: 500
    });
    const added = data.added || [];
    const modified = data.modified || [];
    const removed = (data.removed || []).map(entry => entry.transaction_id);
    await upsertTransactions(item.item_id, [...added, ...modified], removed);
    changed += added.length + modified.length + removed.length;
    cursor = data.next_cursor;
    hasMore = Boolean(data.has_more);
    pageCount += 1;
  }
  await saveCursor(item.item_id, cursor || null);
  return changed;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const items = await listItems();
    let changed = 0;
    for (const item of items) changed += await syncItem(item);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, items: items.length, changed });
  } catch (error) {
    return sendError(res, error);
  }
}
