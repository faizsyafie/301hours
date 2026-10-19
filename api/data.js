// GET  /api/data  -> { doc }        current study data (or null if none yet)
// PUT  /api/data  -> { doc }        merge the sent copy into the stored one
// Requires the `x-passcode` header to match APP_PASSCODE.
// Storage is whichever Redis is connected to the Vercel project (see lib/db.js).
import { createHash, timingSafeEqual } from 'node:crypto';
import { mergeDocs } from '../lib/merge.js';
import * as db from '../lib/db.js';

const KEY = '301hours:data';
const PASSCODE = process.env.APP_PASSCODE;

// Ignores the usual copy-paste accidents: surrounding spaces/newlines and
// quotes around the value in the Vercel dashboard.
function normalize(code) {
  let s = String(code ?? '').normalize('NFC').trim();
  if (s.length > 1 && /^(['"]).*\1$/.test(s)) s = s.slice(1, -1).trim();
  return s;
}

function passcodeMatches(given) {
  let decoded = given;
  try { decoded = decodeURIComponent(given); } catch { /* sent unencoded */ }
  const hash = (s) => createHash('sha256').update(normalize(s)).digest();
  return timingSafeEqual(hash(decoded), hash(PASSCODE));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!db.backend) {
    return res.status(501).json({ error: 'No database connected. Add a Redis database (e.g. Upstash) to the Vercel project, then redeploy.' });
  }
  if (!normalize(PASSCODE)) {
    return res.status(501).json({ error: 'APP_PASSCODE environment variable is not set.' });
  }
  if (!passcodeMatches(req.headers['x-passcode'] || '')) {
    return res.status(401).json({ error: 'Wrong passcode', code: 'bad_passcode' });
  }

  try {
    if (req.method === 'GET') {
      const raw = await db.get(KEY);
      return res.status(200).json({ doc: raw ? JSON.parse(raw) : null });
    }

    if (req.method === 'PUT') {
      const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!incoming || !Array.isArray(incoming.topics) || !Array.isArray(incoming.sessions)) {
        return res.status(400).json({ error: 'Invalid data' });
      }
      const raw = await db.get(KEY);
      const merged = mergeDocs(raw ? JSON.parse(raw) : null, incoming);
      await db.set(KEY, JSON.stringify(merged));
      return res.status(200).json({ doc: merged });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: `Database error: ${err.message}` });
  }
}
