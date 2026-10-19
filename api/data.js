// GET    /api/data  -> { doc }   this account's study data (or null if none yet)
// PUT    /api/data  -> { doc }   merge the sent copy into the stored one
// DELETE /api/data  -> { ok }    delete this account's stored data
// Who you are decides where the data lives (see lib/auth.js): a Google account
// in accounts mode, or the single shared slot in passcode mode.
import { mergeDocs } from '../lib/merge.js';
import * as db from '../lib/db.js';
import { dataSlot } from '../lib/auth.js';

const MAX_BYTES = 2_000_000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!db.backend) {
    return res.status(501).json({ error: 'No database connected. Add a Redis database (e.g. Upstash) to the Vercel project, then redeploy.' });
  }
  const slot = dataSlot(req);
  if (slot.error) return res.status(slot.status).json({ error: slot.error, code: slot.code });

  try {
    if (req.method === 'GET') {
      const raw = await db.get(slot.key);
      return res.status(200).json({ doc: raw ? JSON.parse(raw) : null });
    }

    if (req.method === 'PUT') {
      const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!incoming || !Array.isArray(incoming.topics) || !Array.isArray(incoming.sessions)) {
        return res.status(400).json({ error: 'Invalid data' });
      }
      const raw = await db.get(slot.key);
      const merged = mergeDocs(raw ? JSON.parse(raw) : null, incoming);
      const out = JSON.stringify(merged);
      if (out.length > MAX_BYTES) return res.status(413).json({ error: 'Your data is over the 2 MB storage limit. Download a backup and reset old levels.' });
      await db.set(slot.key, out);
      return res.status(200).json({ doc: merged });
    }

    if (req.method === 'DELETE') {
      await db.del(slot.key);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: `Database error: ${err.message}` });
  }
}
