// Tiny key-value layer over whichever Redis the Vercel project has connected:
//  - Upstash (REST): KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + _TOKEN
//  - Any other Redis (Vercel Marketplace "Redis", Redis Cloud, old Vercel KV): REDIS_URL or KV_URL
const env = process.env;
const REST_URL = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
const TCP_URL = env.REDIS_URL || env.KV_URL;

export const backend = REST_URL && REST_TOKEN ? 'upstash-rest' : TCP_URL ? 'redis-url' : null;

// Names only, never values - used by the health check.
export const envFound = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL', 'KV_URL']
  .filter((k) => env[k]);

async function rest(command) {
  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `Redis HTTP ${res.status}`);
  return body.result;
}

// Reused across invocations while the function instance stays warm.
let connecting = null;
function tcp() {
  connecting ||= import('redis').then(async ({ createClient }) => {
    const c = createClient({
      url: TCP_URL,
      // Give up after a few tries instead of retrying forever, so errors surface.
      socket: { connectTimeout: 5000, reconnectStrategy: (retries) => (retries > 2 ? new Error('Could not connect to Redis') : 300) },
    });
    c.on('error', () => {});
    await c.connect();
    return c;
  }).catch((err) => {
    connecting = null;
    throw err;
  });
  return connecting;
}

export async function get(key) {
  if (backend === 'upstash-rest') return rest(['GET', key]);
  return (await tcp()).get(key);
}

export async function set(key, value) {
  if (backend === 'upstash-rest') return rest(['SET', key, value]);
  return (await tcp()).set(key, value);
}

export async function ping() {
  if (backend === 'upstash-rest') return rest(['PING']);
  return (await tcp()).ping();
}

export async function del(key) {
  if (backend === 'upstash-rest') return rest(['DEL', key]);
  return (await tcp()).del(key);
}
