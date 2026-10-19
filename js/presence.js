// Camera presence detection. Runs a small person detector (MediaPipe
// EfficientDet-Lite0) on the webcam a couple of times per second, entirely in
// the browser - no video leaves the device.
//
// presence.state: 'off' | 'loading' | 'ready' | 'error'
// presence.seen:  whether a person was in the most recent frame
const VISION_VERSION = '0.10.14';
export const VISION_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
const SAMPLE_MS = 500;
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
};

let detector = null;
let stream = null;
let loop = null;

// One <video> element for the whole app; views move it in and out of the page.
export const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
video.className = 'cam-video';

export function onPresence(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(presence);
}

async function createDetector() {
  const { FilesetResolver, ObjectDetector } = await import(`${VISION_CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
  // CPU is plenty for two small frames a second and avoids GPU stalls.
  return ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    runningMode: 'VIDEO',
    scoreThreshold: 0.35,
    categoryAllowlist: ['person'],
    maxResults: 1,
  });
}

// Self-scheduling so a slow frame never queues up a backlog.
function scheduleDetect() {
  loop = setTimeout(() => {
    detect();
    if (loop) scheduleDetect();
  }, SAMPLE_MS);
}

function detect() {
  if (!detector || video.readyState < 2 || !video.videoWidth) return;
  const now = Date.now();
  let result;
  try {
    result = detector.detectForVideo(video, performance.now());
  } catch {
    return;
  }
  const hit = result.detections[0];
  presence.seen = Boolean(hit);
  presence.lastCheck = now;
  if (hit) {
    presence.lastSeen = now;
    const b = hit.boundingBox;
    presence.box = { x: b.originX / video.videoWidth, y: b.originY / video.videoHeight, w: b.width / video.videoWidth, h: b.height / video.videoHeight };
  } else {
    presence.box = null;
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
    const [det, cam] = await Promise.all([
      detector || createDetector(),
      navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false }),
    ]);
    detector = det;
    stream = cam;
    video.srcObject = stream;
    await video.play().catch(() => {});
    presence.state = 'ready';
    presence.lastSeen = 0;
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
  presence.box = null;
  emit();
}

// True if a person was seen within the last `graceSec` seconds.
export function isPresent(graceSec) {
  const now = Date.now();
  return presence.state === 'ready' && now - presence.lastCheck < STALE_MS && now - presence.lastSeen <= graceSec * 1000;
}
