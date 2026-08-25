import { createSessionCookie, validPassword } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  if (!validPassword(req.body?.password)) {
    await new Promise(resolve => setTimeout(resolve, 350));
    return res.status(401).json({ ok: false, code: 'INVALID_PASSWORD', error: 'Contraseña incorrecta.' });
  }
  res.setHeader('Set-Cookie', createSessionCookie());
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true });
}
