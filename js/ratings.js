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

// ---------- Credit rating ----------
// A consistency score out of 100 over the last 14 days, mapped to AAA…CCC:
//   40  days you studied
//   30  days you hit your daily target
//   15  share of time verified by the desk cam
//   15  current streak (capped at 14 days)
// Outlook compares the last 7 days with the 7 before.
const GRADES = [[90, 'AAA'], [80, 'AA'], [70, 'A'], [60, 'BBB'], [50, 'BB'], [40, 'B'], [0, 'CCC']];
const DAY_MS = 86400000;
const WINDOW = 14;
const MIN_STUDY_DAYS = 3;

const gradeOf = (score) => GRADES.find(([min]) => score >= min)[1];
export const gradeRank = (g) => GRADES.findIndex(([, x]) => x === g);

function dayKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function windowScore(sessions, endDay, days, dailyGoalSec, streak) {
  const byDay = new Map();
  let total = 0, verified = 0;
  const start = endDay - (days - 1) * DAY_MS;
  for (const s of sessions) {
    if (s.start < start || s.start >= endDay + DAY_MS) continue;
    const k = dayKeyOf(s.start);
    byDay.set(k, (byDay.get(k) || 0) + s.sec);
    total += s.sec;
    if (s.verified) verified += s.sec;
  }
  let studied = 0, hit = 0;
  for (let i = 0; i < days; i++) {
    const sec = byDay.get(dayKeyOf(endDay - i * DAY_MS)) || 0;
    if (sec > 0) studied++;
    if (dailyGoalSec ? sec >= dailyGoalSec : sec > 0) hit++;
  }
  const parts = {
    consistency: (studied / days) * 40,
    target: (hit / days) * 30,
    camera: total ? (verified / total) * 15 : 0,
    streak: (Math.min(streak, days) / days) * 15,
  };
  return { score: Object.values(parts).reduce((a, b) => a + b, 0), parts, studied, hit, days };
}

// st: stats() for the level; dailyGoalHours from settings.
export function creditRating(st, dailyGoalHours) {
  const studyDays = st.byDay ? [...st.byDay.values()].filter((v) => v > 0).length : 0;
  if (studyDays < MIN_STUDY_DAYS) {
    return { grade: 'NR', score: null, outlook: '', parts: null, needDays: MIN_STUDY_DAYS - studyDays };
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  // Don't penalise today before you've had a chance to study.
  const end = (st.byDay.get(dayKeyFromStats(t0)) || 0) > 0 ? t0 : t0 - DAY_MS;
  const goal = (dailyGoalHours || 0) * 3600;
  const main = windowScore(st.sessions, end, WINDOW, goal, st.streak);
  const recent = windowScore(st.sessions, end, 7, goal, st.streak).score;
  const prior = windowScore(st.sessions, end - 7 * DAY_MS, 7, goal, st.streak).score;
  const outlook = recent - prior > 8 ? 'POSITIVE' : recent - prior < -8 ? 'NEGATIVE' : 'STABLE';
  return { grade: gradeOf(main.score), score: main.score, outlook, parts: main.parts, studied: main.studied, hit: main.hit, days: WINDOW };
}

// stats().byDay uses util.dayKey (YYYY-MM-DD).
function dayKeyFromStats(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The weakest component, for downgrade messages.
export function weakest(parts) {
  const max = { consistency: 40, target: 30, camera: 15, streak: 15 };
  const names = { consistency: 'fewer study days', target: 'daily target missed more often', camera: 'less camera-verified time', streak: 'streak broken' };
  const [k] = Object.entries(parts).sort((a, b) => a[1] / max[a[0]] - b[1] / max[b[0]])[0];
  return names[k];
}
