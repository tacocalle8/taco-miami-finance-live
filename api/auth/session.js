import { authConfigured, isAuthenticated } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, configured: authConfigured(), authenticated: isAuthenticated(req) });
}
