import crypto from 'node:crypto';
import { getOwnerPassword } from './config.js';

const COOKIE_NAME = 'tm_owner_session';
const SESSION_SECONDS = 60 * 60 * 12;

function signingSecret() {
  return process.env.SESSION_SECRET || getOwnerPassword();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signature(payload) {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=');
        return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function authConfigured() {
  return Boolean(getOwnerPassword());
}

export function validPassword(candidate) {
  const expected = getOwnerPassword();
  return Boolean(expected) && safeEqual(candidate || '', expected);
}

export function createSessionCookie() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `owner.${expires}`;
  const token = `${payload}.${signature(payload)}`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function isAuthenticated(req) {
  if (!authConfigured()) return false;
  const token = parseCookies(req)[COOKIE_NAME] || '';
  const [role, expiryText, suppliedSignature] = token.split('.');
  const payload = `${role}.${expiryText}`;
  const expiry = Number(expiryText);
  return role === 'owner' && Number.isFinite(expiry) && expiry > Date.now() / 1000 && safeEqual(suppliedSignature || '', signature(payload));
}

export function requireAuth(req, res) {
  if (!authConfigured()) {
    res.status(503).json({ ok: false, code: 'OWNER_PASSWORD_REQUIRED', error: 'Falta configurar OWNER_PASSWORD en Vercel.' });
    return false;
  }
  if (!isAuthenticated(req)) {
    res.status(401).json({ ok: false, code: 'AUTH_REQUIRED', error: 'Inicia sesión como propietario.' });
    return false;
  }
  return true;
}
