// Ratings, in market language.
//
// Analyst ratings compare each topic's share of your study hours with its
// share of the exam (from the weight range, e.g. "15–20%" → 17.5%, then
// normalised so the level's topics add up to 100%):
//   share < 75% of target  → UNDERWEIGHT · BUY   (study it more)
//   share > 133% of target → OVERWEIGHT · TRIM   (you could ease off)
//   otherwise              → MARKET WEIGHT · HOLD
const MIN_HOURS_TO_RATE = 3;

export function weightMid(weight) {
  const nums = String(weight || '').match(/\d+(\.\d+)?/g);
  if (!nums) return null;
  const vals = nums.slice(0, 2).map(Number);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export const ANALYST = {
  BUY: { label: 'UNDERWEIGHT · BUY', short: 'BUY', cls: 'buy', icon: '▲' },
  HOLD: { label: 'MARKET WEIGHT · HOLD', short: 'HOLD', cls: 'hold', icon: '■' },
  TRIM: { label: 'OVERWEIGHT · TRIM', short: 'TRIM', cls: 'trim', icon: '▼' },
  NR: { label: 'NOT RATED', short: 'NR', cls: 'nr', icon: '·' },
};

// topics: the `stats().topics` rows. Returns Map(topicId → rating info).
export function analystRatings(topics) {
  const rated = topics.filter((t) => weightMid(t.topic.weight) !== null);
  const weightSum = rated.reduce((a, t) => a + weightMid(t.topic.weight), 0);
  const hoursSum = topics.reduce((a, t) => a + t.sec, 0);
  const out = new Map();
  for (const t of topics) {
    const mid = weightMid(t.topic.weight);
    const target = mid !== null && weightSum ? mid / weightSum : null;
    const share = hoursSum ? t.sec / hoursSum : 0;
    let key = 'NR';
    if (target !== null && hoursSum >= MIN_HOURS_TO_RATE * 3600) {
      const ratio = share / target;
      key = ratio < 0.75 ? 'BUY' : ratio > 1.33 ? 'TRIM' : 'HOLD';
    }
    out.set(t.topic.id, { key, ...ANALYST[key], share, target, gap: target === null ? 0 : target - share });
  }
  return out;
}

// The most underweight topic, if any is rated BUY.
export function topPick(topics, ratings) {
  return topics
    .filter((t) => ratings.get(t.topic.id)?.key === 'BUY')
    .sort((a, b) => ratings.get(b.topic.id).gap - ratings.get(a.topic.id).gap)[0] || null;
}

export const ratingMinHours = MIN_HOURS_TO_RATE;
