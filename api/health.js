// GET /api/health - sync setup check for the Setup page. Reports which pieces
// are configured (env var names only, never values) and whether the database
// answers. Needs no passcode and reveals no data.
import * as db from '../lib/db.js';
import { authMode, config, currentUser } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = {
    database: db.backend,
    envFound: db.envFound,
    passcodeSet: config.passcodeSet,
    authMode,
    googleClientIdSet: config.googleClientIdSet,
    sessionSecretSet: config.sessionSecretSet,
    allowList: config.allowList,
    signedIn: Boolean(currentUser(req)),
    databaseReachable: null,
    error: '',
    vercelEnv: process.env.VERCEL_ENV || 'local',
  };
  if (db.backend) {
    try {
      await db.ping();
      out.databaseReachable = true;
    } catch (err) {
      out.databaseReachable = false;
      out.error = err.message;
    }
  }
  res.status(200).json(out);
}
