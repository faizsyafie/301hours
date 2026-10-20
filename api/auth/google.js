// POST /api/auth/google { credential } -> verifies a Google ID token and starts a session.
import { authMode, verifyGoogleToken, emailAllowed, sessionCookie } from '../../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (authMode !== 'google') return res.status(501).json({ error: 'Google sign-in is not configured.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const p = await verifyGoogleToken(body.credential);
    if (!emailAllowed(p.email)) return res.status(403).json({ error: `${p.email} isn't on this site's allowed list.` });
    const user = { sub: p.sub, email: p.email, name: p.name || '' };
    res.setHeader('Set-Cookie', sessionCookie(user, req));
    return res.status(200).json({ user });
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
}
