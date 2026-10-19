// GET  /api/data  -> { doc }        current study data (or null if none yet)
// PUT  /api/data  -> { doc }        merge the sent copy into the stored one
// Requires the `x-passcode` header to match APP_PASSCODE.
// Storage is Upstash Redis via its REST API (env vars are added automatically
// when you connect an Upstash database to the project in the Vercel dashboard).
import { createHash, timingSafeEqual } from 'node:crypto';
import { mergeDocs } from '../lib/merge.js';

const KEY = '301hours:data';
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PASSCODE = process.env.APP_PASSCODE;

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `Redis HTTP ${res.status}`);
  return body.result;
}

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

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(501).json({ error: 'No database connected. Add Upstash Redis to the Vercel project.' });
  }
  if (!normalize(PASSCODE)) {
    return res.status(501).json({ error: 'APP_PASSCODE environment variable is not set.' });
  }
  if (!passcodeMatches(req.headers['x-passcode'] || '')) {
    return res.status(401).json({ error: 'Wrong passcode', code: 'bad_passcode' });
  }

  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', KEY]);
      return res.status(200).json({ doc: raw ? JSON.parse(raw) : null });
    }

    if (req.method === 'PUT') {
      const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!incoming || !Array.isArray(incoming.topics) || !Array.isArray(incoming.sessions)) {
        return res.status(400).json({ error: 'Invalid data' });
      }
      const raw = await redis(['GET', KEY]);
      const merged = mergeDocs(raw ? JSON.parse(raw) : null, incoming);
      await redis(['SET', KEY, JSON.stringify(merged)]);
      return res.status(200).json({ doc: merged });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
