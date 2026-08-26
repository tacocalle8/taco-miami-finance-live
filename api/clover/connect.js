import { requireAuth } from '../../lib/auth.js';
import { cloverRequest } from '../../lib/clover.js';
import { saveCloverMerchant } from '../../lib/clover-db.js';
import { sendError } from '../../lib/config.js';

const STORES = {
  shell: 'Shell',
  original: 'Food Truck Original'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!requireAuth(req, res)) return;
  try {
    const storeKey = String(req.body?.storeKey || '').trim().toLowerCase();
    const merchantId = String(req.body?.merchantId || '').trim();
    const accessToken = String(req.body?.accessToken || '').trim();
    if (!STORES[storeKey]) {
      const error = new Error('Selecciona Shell o Food Truck Original.');
      error.statusCode = 400;
      throw error;
    }
    if (!/^[A-Za-z0-9]{8,32}$/.test(merchantId)) {
      const error = new Error('El Merchant ID de Clover no tiene el formato correcto.');
      error.statusCode = 400;
      throw error;
    }
    if (accessToken.length < 10) {
      const error = new Error('Pega el API token completo de Clover.');
      error.statusCode = 400;
      throw error;
    }

    const merchant = await cloverRequest(`/v3/merchants/${encodeURIComponent(merchantId)}`, accessToken);
    await saveCloverMerchant({
      storeKey,
      storeName: STORES[storeKey],
      merchantId,
      merchantName: merchant.name || STORES[storeKey],
      accessToken,
      currency: merchant.currency || 'USD',
      timezone: merchant.timeZone || merchant.timezone || 'America/New_York'
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      ok: true,
      storeKey,
      storeName: STORES[storeKey],
      merchantName: merchant.name || STORES[storeKey]
    });
  } catch (error) {
    return sendError(res, error);
  }
}
