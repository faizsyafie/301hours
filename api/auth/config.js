// GET /api/auth/config -> which sign-in mode is on, and the signed-in user (if any).
import { authMode, GOOGLE_CLIENT_ID, currentUser } from '../../lib/auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const user = currentUser(req);
  res.status(200).json({
    mode: authMode,
    googleClientId: authMode === 'google' ? GOOGLE_CLIENT_ID : '',
    user: user ? { sub: user.sub, email: user.email, name: user.name } : null,
  });
}
