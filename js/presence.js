// Camera presence detection, entirely in the browser - no video leaves the
// device. Two frames a second go through MediaPipe models, and a frame only
// counts as "someone at the desk" when the evidence is strong:
//   - a face detector (BlazeFace) is confident, or
//   - the person detector (EfficientDet-Lite0) AND the body-pose model agree,
//     i.e. pose shoulders sit inside the person box. This covers looking down
//     at notes, when the face isn't visible.
// A single model misfiring on a chair or a coat isn't enough, and you must be
// seen in 2 of the last 3 frames, so one-frame flukes are ignored too.
//
// presence.state: 'off' | 'loading' | 'ready' | 'error'
// presence.seen:  whether someone is at the desk right now (after smoothing)
// presence.phone: whether a phone is in frame (optional phone check)
const VISION_VERSION = '0.10.14';
export const VISION_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const MODELS = 'https://storage.googleapis.com/mediapipe-models';
const FACE_MODEL = `${MODELS}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;
const PERSON_MODEL = `${MODELS}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`;
const POSE_MODEL = `${MODELS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`;
const FACE_MIN = 0.6;    // chairs, pets and posters score below ~0.5 in testing
const PERSON_MIN = 0.5;
const PHONE_MIN = 0.4;   // phone check; no false phones on faces or furniture in testing
const SAMPLE_MS = 500;
const WINDOW = 3;        // smoothing: frames considered
const NEEDED = 2;        // ...of which this many must be positive
// If detection hasn't run for this long (e.g. the tab is throttled in the
// background) we can't vouch for presence any more.
const STALE_MS = 90000;

const listeners = new Set();

export const presence = {
  state: 'off',
  error: '',
  seen: false,
  lastSeen: 0,
  lastCheck: 0,
  box: null,
  reason: '',            // 'face' | 'body' | '' - what the last positive frame was based on
  scores: { face: 0, person: 0, pose: false, phone: 0 },
  phone: false,          // a phone in frame (after smoothing), when the phone check is on
  phoneBox: null,
};

let models = null;
let stream = null;
let loop = null;
let history = [];
let phoneHistory = [];

// One <video> element for the whole app; views move it in and out of the page.
export const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
video.className = 'cam-video';

// The phone check is a setting; read it lazily so this module stays independent.
let phoneCheckOn = () => false;
export function setPhoneCheckSource(fn) { phoneCheckOn = fn; }

export function onPresence(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(presence);
}

async function createModels() {
  const { FilesetResolver, FaceDetector, ObjectDetector, PoseLandmarker } = await import(`${VISION_CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
  // CPU is plenty for two small frames a second and avoids GPU stalls.
  const base = (modelAssetPath) => ({ modelAssetPath, delegate: 'CPU' });
  const [face, person, pose] = await Promise.all([
    FaceDetector.createFromOptions(fileset, { baseOptions: base(FACE_MODEL), runningMode: 'VIDEO', minDetectionConfidence: 0.3 }),
    ObjectDetector.createFromOptions(fileset, { baseOptions: base(PERSON_MODEL), runningMode: 'VIDEO', scoreThreshold: 0.2, categoryAllowlist: ['person', 'cell phone'], maxResults: 5 }),
    PoseLandmarker.createFromOptions(fileset, { baseOptions: base(POSE_MODEL), runningMode: 'VIDEO', numPoses: 1 }),
  ]);
  return { face, person, pose };
}

// Self-scheduling so a slow frame never queues up a backlog.
function scheduleDetect() {
  loop = setTimeout(() => {
    detect();
    if (loop) scheduleDetect();
  }, SAMPLE_MS);
}

// Runs the models on one frame. Returns { hit, reason, box } with box in
// 0-1 video coordinates. Cheapest check first; later models only run if needed.
// Runs the models on one frame. Returns { hit, reason, box, phone } with box
// in 0-1 video coordinates. Cheapest check first; later models only run if
// needed (the object detector always runs when the phone check is on).
function analyse(ts, wantPhone) {
  const W = video.videoWidth, H = video.videoHeight;
  const norm = (b) => ({ x: b.originX / W, y: b.originY / H, w: b.width / W, h: b.height / H });
  let objects = null;
  const detectObjects = () => (objects ||= models.person.detectForVideo(video, ts).detections);
  const best = (name) => detectObjects().filter((d) => d.categories[0].categoryName === name)
    .reduce((b, d) => (d.categories[0].score > (b?.categories[0].score ?? 0) ? d : b), null);

  let phone = null;
  if (wantPhone) {
    phone = best('cell phone');
    presence.scores.phone = phone?.categories[0].score ?? 0;
  } else {
    presence.scores.phone = 0;
  }
  const phoneHit = presence.scores.phone >= PHONE_MIN;
  const phoneBox = phoneHit ? norm(phone.boundingBox) : null;

  const faces = models.face.detectForVideo(video, ts).detections;
  const face = faces.reduce((b, d) => (d.categories[0].score > (b?.categories[0].score ?? 0) ? d : b), null);
  presence.scores.face = face?.categories[0].score ?? 0;
  if (presence.scores.face >= FACE_MIN) {
    presence.scores.person = 0;
    presence.scores.pose = false;
    return { hit: true, reason: 'face', box: norm(face.boundingBox), phone: phoneHit, phoneBox };
  }

  const person = best('person');
  presence.scores.person = person?.categories[0].score ?? 0;
  presence.scores.pose = false;
  if (presence.scores.person < PERSON_MIN) return { hit: false, phone: phoneHit, phoneBox };

  const box = norm(person.boundingBox);
  const lm = models.pose.detectForVideo(video, ts).landmarks[0];
  if (!lm) return { hit: false, phone: phoneHit, phoneBox };
  // Shoulder midpoint (landmarks 11, 12) must sit inside the person box.
  const sx = (lm[11].x + lm[12].x) / 2;
  const sy = (lm[11].y + lm[12].y) / 2;
  const pad = 0.05;
  presence.scores.pose = sx > box.x - pad && sx < box.x + box.w + pad && sy > box.y - pad && sy < box.y + box.h + pad;
  return presence.scores.pose ? { hit: true, reason: 'body', box, phone: phoneHit, phoneBox } : { hit: false, phone: phoneHit, phoneBox };
}

function detect() {
  if (!models || video.readyState < 2 || !video.videoWidth) return;
  const now = Date.now();
  let frame;
  try {
    frame = analyse(performance.now(), phoneCheckOn());
  } catch {
    return;
  }
  history = [...history, frame.hit].slice(-WINDOW);
  phoneHistory = [...phoneHistory, frame.phone].slice(-WINDOW);
  presence.seen = history.filter(Boolean).length >= NEEDED;
  presence.phone = phoneHistory.filter(Boolean).length >= NEEDED;
  presence.phoneBox = frame.phoneBox || (presence.phone ? presence.phoneBox : null);
  presence.lastCheck = now;
  if (presence.seen) presence.lastSeen = now;
  if (frame.hit) {
    presence.box = frame.box;
    presence.reason = frame.reason;
  } else if (!presence.seen) {
    presence.box = null;
    presence.reason = '';
  }
  emit();
}

export async function startCamera() {
  if (presence.state === 'ready' || presence.state === 'loading') return;
  presence.state = 'loading';
  presence.error = '';
  emit();
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access (the page must be served over https).');
    const [loaded, cam] = await Promise.all([
      models || createModels(),
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false }),
    ]);
    models = loaded;
    stream = cam;
    video.srcObject = stream;
    await video.play().catch(() => {});
    presence.state = 'ready';
    presence.lastSeen = 0;
    history = [];
    phoneHistory = [];
    scheduleDetect();
  } catch (err) {
    presence.state = 'error';
    presence.error = err.name === 'NotAllowedError' ? 'Camera permission was denied.' : err.message || String(err);
    stopStream();
  }
  emit();
}

function stopStream() {
  clearTimeout(loop);
  loop = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

export function stopCamera() {
  stopStream();
  presence.state = 'off';
  presence.seen = false;
  presence.phone = false;
  presence.box = null;
  emit();
}

// True if a person was seen within the last `graceSec` seconds.
export function isPresent(graceSec) {
  const now = Date.now();
  return presence.state === 'ready' && now - presence.lastCheck < STALE_MS && now - presence.lastSeen <= graceSec * 1000;
}
