// POST /api/auth/logout -> ends the session.
import { clearCookie } from '../../lib/auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', clearCookie());
  res.status(200).json({ ok: true });
}
