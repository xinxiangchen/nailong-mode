/**
 * 奶龙模仿挑战 · 主程序
 * 摄像头 -> MediaPipe Face/Pose/Hand -> 表情/肢体/手部映射 -> 实时评分 -> 30 秒挑战
 * 手部只驱动奶龙的手，不计分。
 */

import {
  FaceLandmarker,
  PoseLandmarker,
  HandLandmarker,
  FilesetResolver,
} from '../vendor/vision_bundle.mjs';
import { faceCrop, restoreFaceCoordinates } from './face-tracking.js';
import {
  extractMetrics,
  Smoother,
  clamp,
  clamp01,
  smoothstep,
  wrapDeg,
  wristDeltas,
} from './metrics.js';
import {
  scoreMetrics,
  gradeFor,
  PERFECT_SCORE,
  PERFECT_HOLD_SECONDS,
  ROUND_SECONDS,
} from './scoring.js';
import { CHALLENGES, DEFAULT_CHALLENGE_ID, getChallenge } from './challenges.js';
import { drawNailong, idleState } from './avatar.js';
import { Sound } from './audio.js';
import { Confetti } from './fx.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DETECT_BASE_MS = 33;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lerp = (a, b, t) => a + (b - a) * t;

const els = {
  video: $('video'),
  camOverlay: $('camOverlay'),
  camPip: $('camPip'),
  skeletonBtn: $('skeletonBtn'),
  targetImage: $('targetImage'),
  targetTitle: $('targetTitle'),
  targetSticker: $('targetSticker'),
  targetNote: $('targetNote'),
  targetTips: $('targetTips'),
  challengeTabs: $('challengeTabs'),
  introChallengeNote: $('introChallengeNote'),
  avatarCanvas: $('avatarCanvas'),
  avatar3dCanvas: $('avatar3dCanvas'),
  liveWrap: document.querySelector('.canvas-live'),
  countdown: $('countdown'),
  perfectFlash: $('perfectFlash'),
  statusChip: $('statusChip'),
  statusText: $('statusText'),
  feedbackText: $('feedbackText'),
  scoreValue: $('scoreValue'),
  scoreRing: $('scoreRing'),
  gradeChip: $('gradeChip'),
  exprValue: $('exprValue'),
  exprBar: $('exprBar'),
  poseValue: $('poseValue'),
  poseBar: $('poseBar'),
  headValue: $('headValue'),
  headBar: $('headBar'),
  timer: $('timer'),
  timerBox: $('timerBox'),
  timerLabel: $('timerLabel'),
  perfectFill: $('perfectFill'),
  perfectText: $('perfectText'),
  startBtn: $('startBtn'),
  practiceBtn: $('practiceBtn'),
  stopBtn: $('stopBtn'),
  bestValue: $('bestValue'),
  introOverlay: $('introOverlay'),
  introStatus: $('introStatus'),
  introStatusText: $('introStatusText'),
  introStartBtn: $('introStartBtn'),
  introPracticeBtn: $('introPracticeBtn'),
  demoBtn: $('demoBtn'),
  modelRetryBtn: $('modelRetryBtn'),
  resultOverlay: $('resultOverlay'),
  resultKicker: $('resultKicker'),
  resultGrade: $('resultGrade'),
  resultTitle: $('resultTitle'),
  resultScore: $('resultScore'),
  resultStars: $('resultStars'),
  resultExprBar: $('resultExprBar'),
  resultExprValue: $('resultExprValue'),
  resultPoseBar: $('resultPoseBar'),
  resultPoseValue: $('resultPoseValue'),
  resultHeadBar: $('resultHeadBar'),
  resultHeadValue: $('resultHeadValue'),
  perfectBadge: $('perfectBadge'),
  newRecord: $('newRecord'),
  resultTip: $('resultTip'),
  retryBtn: $('retryBtn'),
  practiceAgainBtn: $('practiceAgainBtn'),
  homeBtn: $('homeBtn'),
  soundBtn: $('soundBtn'),
  helpBtn: $('helpBtn'),
  helpOverlay: $('helpOverlay'),
  helpClose: $('helpClose'),
  helpCloseBtn: $('helpCloseBtn'),
  helpStartBtn: $('helpStartBtn'),
  fxCanvas: $('fxCanvas'),
};

const sound = new Sound();
const confetti = new Confetti(els.fxCanvas);

const CHALLENGE_KEY = 'nailong.challenge';

function readChallengeId() {
  try {
    return getChallenge(localStorage.getItem(CHALLENGE_KEY) || DEFAULT_CHALLENGE_ID).id;
  } catch {
    return DEFAULT_CHALLENGE_ID;
  }
}

function bestStorageKey(challengeId) {
  return `nailong.best.${challengeId}`;
}

function readBest(challengeId) {
  try {
    const raw = localStorage.getItem(bestStorageKey(challengeId));
    if (raw != null) return Math.max(0, Number(raw) || 0);
    // 旧版本只有一个总纪录，把它让给「捧腹」这个默认挑战。
    if (challengeId === 'belly') {
      return Math.max(0, Number(localStorage.getItem('nailong.best') || 0) || 0);
    }
    return 0;
  } catch {
    return 0;
  }
}

function saveBest(challengeId, value) {
  try {
    localStorage.setItem(bestStorageKey(challengeId), String(value));
  } catch {
    /* ignore */
  }
}

function idleHand() {
  return {
    openness: 0.35,
    fingers: [0.35, 0.35, 0.35, 0.35],
    thumb: 0.4,
    wrist: { flex: 0, dev: 0, twist: 0 },
  };
}

function idleVisual() {
  return {
    presence: 0,
    expr: { mouthOpen: 0.05, smile: 0.2, squint: 0.08, brow: 0.15 },
    arms: {
      left: {
        upper: 18,
        fore: 8,
        forward: 0,
        foreForward: 0,
        target: null,
        elbow: null,
        targetMix: 0,
        hand: idleHand(),
      },
      right: {
        upper: -18,
        fore: -8,
        forward: 0,
        foreForward: 0,
        target: null,
        elbow: null,
        targetMix: 0,
        hand: idleHand(),
      },
    },
    legs: { left: { hip: 8, knee: 5 }, right: { hip: -8, knee: 5 } },
    torsoLean: 0,
    headTilt: 0,
    headYaw: 0,
    headPitch: 0,
    bodyYaw: 0,
    bodyPitch: 0,
    offsetX: 0,
    offsetY: 0,
    laugh: 0,
  };
}

const initialChallengeId = readChallengeId();
const initialChallenge = getChallenge(initialChallengeId);

const state = {
  phase: 'idle',
  mode: 'challenge',
  demo: false,
  modelsReady: false,
  loadingModels: false,
  modelError: '',
  faceLandmarker: null,
  poseLandmarker: null,
  handLandmarker: null,
  lastHandResult: null,
  lastHandDetectAt: 0,
  usingCpu: false,
  stream: null,
  cameraReady: false,
  cameraRequesting: false,
  showSkeleton: false,
  helpOpen: false,
  startRequestId: 0,
  detectError: false,
  endedEarly: false,
  smoother: new Smoother(0.12),
  smoothed: null,
  lastProcessedAt: 0,
  lastSmoothAt: 0,
  lastDetectAt: 0,
  lastTs: 0,
  lastVideoTime: -1,
  faceCropMisses: 0,
  faceTooSmall: false,
  detectInterval: DETECT_BASE_MS,
  lastDetectCost: 0,
  detectErrors: 0,
  scoreSmooth: null,
  lastScoreResult: null,
  challengeId: initialChallengeId,
  challenge: initialChallenge,
  peak: 0,
  peakExpr: null,
  peakPose: null,
  peakHead: null,
  // 手腕按「相对手出现时的增量」算，这里存每只手出现时的参考朝向。
  wristRef: { screenLeft: null, screenRight: null },
  validTime: 0,
  holdTime: 0,
  perfect: false,
  timeLeft: ROUND_SECONDS,
  phaseTime: 0,
  roundToken: 0,
  lastLoop: performance.now(),
  lastHudAt: 0,
  lastFeedbackAt: 0,
  lastFeedbackText: '',
  best: readBest(initialChallengeId),
  visual: idleVisual(),
};

let avatar3d = null;
let avatar3dPromise = null;
let avatar3dUnavailable = false;

/* ============================ 初始化 ============================ */

function init() {
  updateSoundButton();
  applyChallengeUI();
  wireEvents();
  updateButtons();
  updateHUD(true);

  if (params.get('demo') === '1') {
    state.demo = true;
    document.body.classList.add('demo-mode');
  }

  init3DAvatar();
  initModels();

  if (params.get('demo') === '1' && params.get('autostart') === '1') {
    setTimeout(() => startRound('challenge', { demo: true }), 350);
  }

  requestAnimationFrame(loop);
}

/**
 * 3D 奶龙是增强项：Three.js / WebGL 不可用时保留原来的 2D 奶龙，
 * 整个挑战流程不受影响。
 */
function init3DAvatar() {
  if (params.get('no3d') === '1') {
    avatar3dUnavailable = true;
    document.body.dataset.avatar3d = 'off';
    return null;
  }
  if (avatar3dPromise || avatar3d || avatar3dUnavailable) {
    return avatar3dPromise;
  }
  if (!els.avatar3dCanvas) {
    avatar3dUnavailable = true;
    document.body.dataset.avatar3d = 'fallback';
    return null;
  }

  document.body.dataset.avatar3d = 'loading';
  avatar3dPromise = (async () => {
    try {
      const { createNailong3D } = await import('./nailong3d.js');
      const instance = createNailong3D(els.avatar3dCanvas, {
        onError: (error) => disable3DAvatar(error),
      });
      avatar3d = instance;
      els.avatar3dCanvas.hidden = false;
      els.liveWrap?.classList.add('has-3d');
      document.body.dataset.avatar3d = 'ready';
    } catch (error) {
      console.warn('3D 奶龙初始化失败，继续使用 2D 奶龙：', error);
      avatar3dUnavailable = true;
      if (els.avatar3dCanvas) els.avatar3dCanvas.hidden = true;
      els.liveWrap?.classList.remove('has-3d');
      document.body.dataset.avatar3d = 'fallback';
    }
  })();

  return avatar3dPromise;
}

function disable3DAvatar(error) {
  if (avatar3dUnavailable && !avatar3d) return;
  console.warn('3D 奶龙不可用，切换到 2D 奶龙：', error);
  avatar3dUnavailable = true;
  const instance = avatar3d;
  avatar3d = null;
  try {
    instance?.dispose();
  } catch {
    /* ignore */
  }
  if (els.avatar3dCanvas) els.avatar3dCanvas.hidden = true;
  els.liveWrap?.classList.remove('has-3d');
  document.body.dataset.avatar3d = 'fallback';
}

function renderTargetTips(challenge) {
  els.targetTips.replaceChildren(
    ...challenge.tips.map(([icon, title, detail]) => {
      const tip = document.createElement('div');
      tip.className = 'target-tip';
      const iconEl = document.createElement('span');
      iconEl.setAttribute('aria-hidden', 'true');
      iconEl.textContent = icon;
      const body = document.createElement('div');
      const titleEl = document.createElement('b');
      titleEl.textContent = title;
      const detailEl = document.createElement('small');
      detailEl.textContent = detail;
      body.append(titleEl, detailEl);
      tip.append(iconEl, body);
      return tip;
    })
  );
}

function applyChallengeUI() {
  const challenge = state.challenge;
  els.targetTitle.textContent = challenge.name;
  els.targetImage.src = challenge.image;
  els.targetImage.alt = `${challenge.name}目标图`;
  els.targetSticker.textContent = challenge.sticker;
  els.targetNote.textContent = challenge.note;
  els.introChallengeNote.textContent = `当前：${challenge.name} · ${challenge.sticker}`;
  renderTargetTips(challenge);
  for (const tab of els.challengeTabs.querySelectorAll('[data-challenge]')) {
    const active = tab.dataset.challenge === challenge.id;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', String(active));
  }
  els.bestValue.textContent = String(state.best);
}

function setChallenge(id) {
  if (state.phase === 'playing' || state.phase === 'countdown') return;
  const challenge = getChallenge(id);
  if (challenge.id === state.challengeId) return;
  state.challengeId = challenge.id;
  state.challenge = challenge;
  state.best = readBest(challenge.id);
  try {
    localStorage.setItem(CHALLENGE_KEY, challenge.id);
  } catch {
    /* ignore */
  }
  applyChallengeUI();
  updateHUD(true);
  sound.click();
}

/* ============================ 模型 ============================ */

async function createLandmarkers(vision, delegate) {
  const face = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: './models/face_landmarker.task',
      delegate,
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  const pose = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: './models/pose_landmarker_lite.task',
      delegate,
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  const hand = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: './models/hand_landmarker.task',
      delegate,
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return { face, pose, hand };
}

async function initModels() {
  if (state.loadingModels || state.modelsReady) return;
  state.loadingModels = true;
  state.modelError = '';
  els.modelRetryBtn.hidden = true;
  setIntroStatus('正在加载表情、肢体与手部模型…', 'loading');
  updateButtons();

  try {
    const vision = await FilesetResolver.forVisionTasks('./vendor/wasm');
    let face;
    let pose;
    let hand;
    try {
      setIntroStatus('正在启用 GPU 加速…', 'loading');
      ({ face, pose, hand } = await createLandmarkers(vision, 'GPU'));
      state.usingCpu = false;
    } catch (gpuError) {
      console.warn('GPU delegate failed, falling back to CPU:', gpuError);
      setIntroStatus('GPU 不可用，正在切换 CPU 模式…', 'loading');
      ({ face, pose, hand } = await createLandmarkers(vision, 'CPU'));
      state.usingCpu = true;
    }

    state.faceLandmarker = face;
    state.poseLandmarker = pose;
    state.handLandmarker = hand;
    state.modelsReady = true;
    updateButtons();
    setIntroStatus(
      state.cameraReady
        ? '摄像头已就绪，点击开始挑战！'
        : '模型就绪，点击开始挑战！',
      'ready'
    );
  } catch (error) {
    console.error('Failed to initialize MediaPipe models:', error);
    state.modelError = error?.message || '未知错误';
    setIntroStatus(
      `模型加载失败：${state.modelError}。请确认是通过 start.ps1 启动的服务器，然后点下方重试。`,
      'error'
    );
    els.modelRetryBtn.hidden = false;
  } finally {
    state.loadingModels = false;
    updateButtons();
  }
}

/* ============================ 摄像头 ============================ */

function waitForVideo() {
  if (els.video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      els.video.removeEventListener('loadedmetadata', finish);
      els.video.removeEventListener('playing', finish);
      resolve();
    };
    const timer = setTimeout(finish, 5000);
    els.video.addEventListener('loadedmetadata', finish);
    els.video.addEventListener('playing', finish);
  });
}

async function ensureCamera() {
  if (state.cameraReady) {
    const track = state.stream?.getVideoTracks?.()[0];
    if (track && track.readyState === 'live') return true;
    // 设备被拔掉 / 被其他程序占用后，不能直接复用旧 stream。
    stopCamera();
  }
  if (state.cameraRequesting) return false;

  if (!navigator.mediaDevices?.getUserMedia) {
    setIntroStatus(
      '这个浏览器不支持摄像头接口。请用最新版 Chrome / Edge，并通过 start.ps1 打开。',
      'error'
    );
    return false;
  }

  state.cameraRequesting = true;
  updateButtons();
  setIntroStatus('正在请求摄像头权限…如果浏览器弹出提示，请点「允许」。', 'loading');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: 'user',
      },
      audio: false,
    });
    state.stream = stream;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        if (state.stream === stream) handleCameraEnded();
      });
    }
    els.video.srcObject = stream;
    await els.video.play();
    await waitForVideo();
    if (state.stream !== stream) {
      throw new Error('摄像头断开了');
    }
    if (!els.video.videoWidth) {
      throw new Error('摄像头画面没有准备好');
    }
    state.cameraReady = true;
    els.camPip.hidden = state.demo;
    els.skeletonBtn.hidden = state.demo;
    setIntroStatus('摄像头已就绪，点击开始挑战！', 'ready');
    return true;
  } catch (error) {
    console.error('getUserMedia failed:', error);
    if (state.stream) {
      for (const track of state.stream.getTracks()) {
        track.stop();
      }
      state.stream = null;
    }
    state.cameraReady = false;
    els.video.srcObject = null;
    els.camPip.hidden = true;
    els.skeletonBtn.hidden = true;
    const name = error?.name || '';
    let message = '摄像头没有打开，请再试一次。';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      message =
        '摄像头权限被拒绝了。点地址栏左侧的摄像头图标允许访问，然后再点一次「开始挑战」。';
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      message = '没有找到摄像头设备。可以先用「看演示」体验。';
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      message = '摄像头被其他程序占用了，先关掉会议 / 直播软件再试。';
    } else if (name === 'SecurityError') {
      message =
        '浏览器阻止了摄像头。请确认地址是 http://127.0.0.1:8899，而不是直接双击 index.html。';
    }
    setIntroStatus(message, 'error');
    sound.error();
    return false;
  } finally {
    state.cameraRequesting = false;
    updateButtons();
  }
}

function handleCameraEnded() {
  const wasPlaying = state.phase === 'playing';
  const wasCountdown = state.phase === 'countdown';
  stopCamera();
  const message = '摄像头断开了。请检查连接后重新开始。';
  if (wasPlaying) {
    endRound(true);
  } else if (wasCountdown) {
    showHome();
  }
  setIntroStatus(message, 'error');
}

/* ============================ 开始 / 结束 ============================ */

async function startRound(mode = 'challenge', { demo = false } = {}) {
  if (state.phase === 'playing' || state.phase === 'countdown') return;
  if (!demo && state.cameraRequesting) return;
  sound.click();

  let requestId = null;
  if (!demo) {
    if (!state.modelsReady) {
      setIntroStatus('模型还在加载，再等一小会儿～', 'loading');
      return;
    }
    requestId = ++state.startRequestId;
    const cameraOk = await ensureCamera();
    if (!cameraOk) return;
    // 权限弹窗期间如果用户点了「看演示」（或已经回首页），以新状态为准；
    // 旧请求刚拿到的摄像头要立刻释放，别留下一个没人用的相机。
    if (requestId !== state.startRequestId) {
      stopCamera();
      return;
    }
  } else {
    state.startRequestId += 1;
  }

  state.demo = demo;
  state.mode = mode;
  state.roundToken += 1;
  const token = state.roundToken;
  state.phase = 'countdown';
  state.phaseTime = 0;
  state.timeLeft = ROUND_SECONDS;
  state.peak = 0;
  state.peakExpr = null;
  state.peakPose = null;
  state.peakHead = null;
  state.wristRef = { screenLeft: null, screenRight: null };
  state.validTime = 0;
  state.lastHandResult = null;
  state.lastVideoTime = -1;
  state.faceCropMisses = 0;
  state.faceTooSmall = false;
  state.lastHandDetectAt = 0;
  state.holdTime = 0;
  state.perfect = false;
  state.scoreSmooth = null;
  state.lastScoreResult = null;
  state.smoothed = null;
  state.lastSmoothAt = 0;
  state.lastDetectAt = 0;
  state.detectError = false;
  state.endedEarly = false;
  state.visual = idleVisual();
  state.smoother.reset();

  document.body.classList.toggle('demo-mode', state.demo);
  document.body.classList.remove('is-perfect');
  state.helpOpen = false;
  els.introOverlay.hidden = true;
  els.helpOverlay.hidden = true;
  els.resultOverlay.hidden = true;
  els.perfectFlash.hidden = true;
  els.camPip.hidden = state.demo || !state.cameraReady;
  els.skeletonBtn.hidden = state.demo || !state.cameraReady;
  els.timerLabel.textContent = mode === 'challenge' ? '剩余' : '自由练习';
  els.timer.textContent = mode === 'challenge' ? formatTime(ROUND_SECONDS) : '∞';
  els.timerBox.classList.remove('is-paused');
  els.feedbackText.textContent = '准备！3 秒后开始，摆出目标姿势～';
  setStatus('准备中', 'is-idle');
  updateButtons();
  updateHUD(true);

  await runCountdown(token);
}

async function runCountdown(token) {
  if (token !== state.roundToken) return;
  els.countdown.hidden = false;

  for (const number of [3, 2, 1]) {
    if (token !== state.roundToken || state.phase !== 'countdown') {
      els.countdown.hidden = true;
      return;
    }
    els.countdown.textContent = String(number);
    replayAnimation(els.countdown);
    sound.countdown(number);
    await sleep(750);
  }

  if (token !== state.roundToken || state.phase !== 'countdown') {
    els.countdown.hidden = true;
    return;
  }

  els.countdown.textContent = '开始！';
  replayAnimation(els.countdown);
  sound.start();
  await sleep(430);

  if (token !== state.roundToken) return;
  els.countdown.hidden = true;
  state.phase = 'playing';
  state.phaseTime = 0;
  state.timeLeft = ROUND_SECONDS;
  setStatus(state.demo ? '演示模式' : '追踪中', state.demo ? 'is-demo' : 'is-live');
  updateButtons();
  updateHUD(true);
}

function endRound(manual = false) {
  if (state.phase !== 'playing') return;
  state.phase = 'result';
  state.roundToken += 1;

  const finalScore = Math.round(state.peak || 0);
  const grade = gradeFor(finalScore);
  // 成绩取峰值；分项也取「峰值那一刻」的分项，避免和总分对不上。
  const peakExpr =
    state.peakExpr == null ? null : Math.round(state.peakExpr);
  const peakPose =
    state.peakPose == null ? null : Math.round(state.peakPose);
  const peakHead =
    state.peakHead == null ? null : Math.round(state.peakHead);

  const isChallenge = state.mode === 'challenge';
  // 手动点「结束本轮」提前收场时，不把这一轮的峰值写进最佳纪录。
  const endedEarly =
    manual && isChallenge && !state.demo && state.timeLeft > 0.1;
  state.endedEarly = endedEarly;
  const isRecord =
    !state.demo &&
    isChallenge &&
    !endedEarly &&
    finalScore > state.best &&
    finalScore > 0;

  if (isRecord) {
    state.best = finalScore;
    saveBest(state.challengeId, state.best);
    els.bestValue.textContent = String(state.best);
  }

  state.scoreSmooth = finalScore;
  state.lastScoreResult = {
    score: finalScore,
    exprScore: peakExpr,
    poseScore: peakPose,
    headScore: peakHead,
    feedback: [],
    hasAny: true,
  };

  els.resultKicker.textContent = state.demo
    ? `演示结束 · ${state.challenge.name}`
    : endedEarly
      ? `提前结束 · ${state.challenge.name}`
      : isChallenge
        ? `30 秒挑战结束 · ${state.challenge.name}`
        : `练习结束 · ${state.challenge.name}`;
  els.resultGrade.textContent = grade.grade;
  els.resultGrade.className =
    'result-grade' + (grade.color === 'gold' ? '' : ` is-${grade.color}`);
  els.resultTitle.textContent = grade.title;
  els.resultScore.textContent = String(finalScore);
  els.resultStars.textContent = '★'.repeat(grade.stars) + '☆'.repeat(5 - grade.stars);
  els.resultStars.setAttribute('aria-label', `${grade.stars} 星`);

  setResultBar(els.resultExprBar, els.resultExprValue, peakExpr);
  setResultBar(els.resultPoseBar, els.resultPoseValue, peakPose);
  setResultBar(els.resultHeadBar, els.resultHeadValue, peakHead);

  els.perfectBadge.hidden = !state.perfect;
  els.newRecord.hidden = !isRecord;
  els.retryBtn.textContent = state.demo ? '再看一次演示' : '再来一次';
  els.practiceAgainBtn.textContent = state.demo ? '演示练习' : '练一练';
  els.resultTip.textContent = endedEarly
    ? '本轮是提前结束的，成绩不会写入最佳纪录。'
    : state.demo
      ? `这是自动演示的「${state.challenge.name}」。回首页开启摄像头，挑战你自己的版本吧！`
      : state.perfect
        ? `奶龙认证：这个「${state.challenge.name}」模仿到位了。要不要冲击更高分？`
        : finalScore >= 82
          ? '很接近了！再保持久一点，就能触发「完美模仿」。'
          : '看准目标图：表情和身体跟上，再来一次会更像。';

  els.resultOverlay.hidden = false;
  els.stopBtn.hidden = true;
  els.startBtn.hidden = false;
  els.practiceBtn.hidden = false;
  els.timerBox.classList.remove('is-paused');
  setStatus(
    endedEarly ? '提前结束' : isChallenge ? '挑战结束' : '练习结束',
    'is-idle'
  );
  updateButtons();
  updateHUD(true);

  if (finalScore >= 80) {
    const rect = els.resultOverlay.getBoundingClientRect();
    confetti.burst(window.innerWidth * 0.5, Math.min(rect.height * 0.28, 260), 120);
    setTimeout(() => {
      confetti.burst(window.innerWidth * 0.32, 180, 70);
      confetti.burst(window.innerWidth * 0.68, 210, 70);
    }, 220);
  }

  if (state.perfect) {
    // 达到完美模仿时 onPerfect() 已经播过音效，这里不再重复。
  } else if (finalScore >= 58) {
    sound.success(grade.stars);
  } else {
    sound.fail();
  }
}

function setResultBar(bar, valueEl, value) {
  const safe = value == null ? 0 : clamp(value, 0, 100);
  bar.style.width = `${safe}%`;
  valueEl.textContent = value == null ? '--' : String(Math.round(safe));
}

function stopCamera() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
  state.cameraReady = false;
  state.smoothed = null;
  state.lastProcessedAt = 0;
  state.lastHandResult = null;
  state.lastVideoTime = -1;
  state.faceCropMisses = 0;
  state.faceTooSmall = false;
  state.lastHandDetectAt = 0;
  state.wristRef = { screenLeft: null, screenRight: null };
  els.video.srcObject = null;
  els.camPip.hidden = true;
  els.skeletonBtn.hidden = true;
  clearCameraOverlay();
}

function showHome() {
  state.roundToken += 1;
  state.phase = 'idle';
  state.demo = false;
  state.mode = 'challenge';
  stopCamera();
  state.scoreSmooth = null;
  state.lastScoreResult = null;
  state.perfect = false;
  state.holdTime = 0;
  state.endedEarly = false;
  state.detectError = false;
  state.visual = idleVisual();
  state.smoother.reset();

  document.body.classList.remove('demo-mode', 'is-perfect');
  state.helpOpen = false;
  els.resultOverlay.hidden = true;
  els.helpOverlay.hidden = true;
  els.introOverlay.hidden = false;
  els.countdown.hidden = true;
  els.stopBtn.hidden = true;
  els.startBtn.hidden = false;
  els.practiceBtn.hidden = false;
  els.perfectFlash.hidden = true;
  els.timerLabel.textContent = '剩余';
  els.timer.textContent = formatTime(ROUND_SECONDS);
  els.timerBox.classList.remove('is-paused');
  els.feedbackText.textContent = '点击开始，先对着镜头站好～';
  setStatus('等待开始', 'is-idle');
  if (state.modelsReady) {
    setIntroStatus('模型就绪，点击开始挑战！', 'ready');
  }
  updateButtons();
  updateHUD(true);
}

function toggleHelp(show) {
  state.helpOpen = show;
  els.helpOverlay.hidden = !show;
  els.helpStartBtn.textContent =
    state.phase === 'playing' || state.phase === 'countdown'
      ? '继续游戏'
      : '开始挑战';
}

/* ============================ 检测循环 ============================ */

function loop(now) {
  const dt = clamp((now - state.lastLoop) / 1000, 0.001, 0.08);
  state.lastLoop = now;

  if (state.demo) {
    if (
      state.phase === 'countdown' ||
      state.phase === 'playing' ||
      state.phase === 'result'
    ) {
      processFrame(demoMetrics(now), now);
    }
  } else if (
    state.modelsReady &&
    state.cameraReady &&
    els.video.readyState >= 2 &&
    !els.camPip.hidden
  ) {
    if (now - state.lastDetectAt >= state.detectInterval) {
      state.lastDetectAt = now;
      runDetection(now);
    }
  }

  render(now, dt);
  requestAnimationFrame(loop);
}

const faceCanvas = document.createElement('canvas');
faceCanvas.width = faceCanvas.height = 512;
const faceContext = faceCanvas.getContext('2d');

function runDetection(now) {
  // A display refresh is not necessarily a new camera frame.
  if (els.video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = els.video.currentTime;
  const started = performance.now();
  try {
    const timestamp = Math.max(performance.now(), state.lastTs + 1);
    state.lastTs = timestamp;
    const width = els.video.videoWidth || 1280;
    const height = els.video.videoHeight || 720;
    const aspect = width / height;

    const poseResult = state.poseLandmarker.detectForVideo(els.video, timestamp);
    // Pose finds a small face even when the full-frame face detector misses it.
    // After a crop miss, alternate with full-frame reacquisition; no stale face
    // result is reused for expression scoring.
    const crop = state.faceCropMisses % 2 === 0 && faceContext
      ? faceCrop(poseResult, width, height) : null;
    let faceInput = els.video;
    if (crop) {
      faceContext.drawImage(els.video, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512);
      faceInput = faceCanvas;
    }
    const faceResult = restoreFaceCoordinates(
      state.faceLandmarker.detectForVideo(faceInput, timestamp), crop, width, height
    );
    const facePoints = faceResult.faceLandmarks?.[0];
    if (facePoints?.length) {
      state.faceCropMisses = 0;
      const faceWidth = (Math.max(...facePoints.map(p => p.x)) -
        Math.min(...facePoints.map(p => p.x))) * width;
      state.faceTooSmall = faceWidth < 80;
    } else {
      state.faceCropMisses += 1;
      state.faceTooSmall = Boolean(crop);
    }

    // 手部模型略重一些，约 20fps 刷新即可；中间帧复用上一帧结果。
    let handResult = state.lastHandResult;
    if (!handResult || now - state.lastHandDetectAt >= 50) {
      handResult = state.handLandmarker.detectForVideo(els.video, timestamp);
      state.lastHandResult = handResult;
      state.lastHandDetectAt = now;
    }

    const raw = extractMetrics(faceResult, poseResult, handResult, aspect);
    state.detectErrors = 0;
    state.detectError = false;
    // Freshness starts when inference finishes, including on slower devices.
    processFrame(raw, performance.now());
  } catch (error) {
    state.detectErrors += 1;
    if (state.detectErrors <= 3) {
      console.warn('MediaPipe detection error:', error);
    }
    if (state.detectErrors > 30) {
      state.detectError = true;
      setStatus('识别出错，请刷新', 'is-danger');
    }
  } finally {
    const cost = performance.now() - started;
    state.lastDetectCost = state.lastDetectCost * 0.85 + cost * 0.15;
    if (state.lastDetectCost > 42 && state.detectInterval < 90) {
      state.detectInterval += 5;
    } else if (state.lastDetectCost < 22 && state.detectInterval > DETECT_BASE_MS) {
      state.detectInterval -= 3;
    }
  }
}

function processFrame(raw, now) {
  // 平滑用较短的时间步，计时用真实间隔，避免低帧率时倒计时变慢。
  const realDt = clamp((now - (state.lastSmoothAt || now - 16)) / 1000, 0.001, 0.5);
  state.lastSmoothAt = now;
  state.lastProcessedAt = now;
  const smoothed = smoothMetrics(raw, Math.min(realDt, 0.2));
  state.smoothed = smoothed;
  if (state.phase === 'playing') {
    updateGameplay(smoothed, realDt);
  }
}

function smoothMetrics(raw, dt) {
  const smoother = state.smoother;
  const out = {
    hasFace: raw.hasFace,
    hasPose: raw.hasPose,
    availability: { ...raw.availability },
    expr: { ...raw.expr },
    poseValues: { ...raw.poseValues },
    faceBox: raw.face?.faceBox ?? null,
    raw: raw.raw,
  };

  if (raw.hasFace) {
    for (const key of ['mouthOpen', 'smile', 'squint', 'brow']) {
      out.expr[key] = smoother.update(`expr.${key}`, raw.expr[key], dt, 0.12);
    }
    out.expr.headTilt = smoother.updateAngle(
      'expr.headTilt',
      raw.expr.headTilt,
      dt,
      0.2
    );
  }

  // 头/躯干新自由度：失去跟踪时回中，而不是停在上一帧扭头看人。
  const headYawAvailable = Boolean(raw.hasFace && raw.availability.headYaw);
  const headPitchAvailable = Boolean(
    raw.hasFace && raw.availability.headPitch
  );
  out.expr.headYaw = smoother.updateAngle(
    'expr.headYaw',
    headYawAvailable ? raw.expr.headYaw : 0,
    dt,
    headYawAvailable ? 0.16 : 0.4
  );
  out.expr.headPitch = smoother.updateAngle(
    'expr.headPitch',
    headPitchAvailable ? raw.expr.headPitch : 0,
    dt,
    headPitchAvailable ? 0.18 : 0.4
  );

  const bodyYawAvailable = Boolean(raw.availability.bodyYaw);
  const bodyPitchAvailable = Boolean(raw.availability.bodyPitch);
  out.poseValues.bodyYaw = smoother.updateAngle(
    'pose.bodyYaw',
    bodyYawAvailable ? raw.poseValues.bodyYaw : 0,
    dt,
    bodyYawAvailable ? 0.22 : 0.45
  );
  out.poseValues.bodyPitch = smoother.updateAngle(
    'pose.bodyPitch',
    bodyPitchAvailable ? raw.poseValues.bodyPitch : 0,
    dt,
    bodyPitchAvailable ? 0.28 : 0.45
  );
  out.headSource = raw.face?.headSource ?? null;
  out.bodyYawSource = raw.bodyYawSource ?? 'none';
  out.bodyPitchValid = Boolean(raw.bodyPitchValid);

  if (raw.availability.armL) {
    out.poseValues.armL = smoother.updateMotionAngle(
      'pose.armL',
      raw.poseValues.armL,
      dt,
      0.16
    );
    out.poseValues.foreL = smoother.updateMotionAngle(
      'pose.foreL',
      raw.poseValues.foreL,
      dt,
      0.16
    );
    out.poseValues.armLForward = smoother.updateMotionAngle(
      'pose.armLForward',
      Number.isFinite(raw.poseValues.armLForward)
        ? raw.poseValues.armLForward
        : 0,
      dt,
      0.24
    );
    out.poseValues.foreLForward = smoother.updateMotionAngle(
      'pose.foreLForward',
      Number.isFinite(raw.poseValues.foreLForward)
        ? raw.poseValues.foreLForward
        : 0,
      dt,
      0.24
    );
  }
  if (raw.availability.armR) {
    out.poseValues.armR = smoother.updateMotionAngle(
      'pose.armR',
      raw.poseValues.armR,
      dt,
      0.16
    );
    out.poseValues.foreR = smoother.updateMotionAngle(
      'pose.foreR',
      raw.poseValues.foreR,
      dt,
      0.16
    );
    out.poseValues.armRForward = smoother.updateMotionAngle(
      'pose.armRForward',
      Number.isFinite(raw.poseValues.armRForward)
        ? raw.poseValues.armRForward
        : 0,
      dt,
      0.24
    );
    out.poseValues.foreRForward = smoother.updateMotionAngle(
      'pose.foreRForward',
      Number.isFinite(raw.poseValues.foreRForward)
        ? raw.poseValues.foreRForward
        : 0,
      dt,
      0.24
    );
  }
  if (raw.availability.torso) {
    out.poseValues.torsoLean = smoother.updateAngle(
      'pose.torsoLean',
      raw.poseValues.torsoLean,
      dt,
      0.2
    );
  }
  if (raw.availability.legL) {
    out.poseValues.legL = smoother.updateAngle(
      'pose.legL',
      raw.poseValues.legL,
      dt,
      0.2
    );
    out.poseValues.kneeL = smoother.updateAngle(
      'pose.kneeL',
      raw.poseValues.kneeL,
      dt,
      0.2
    );
  }
  if (raw.availability.legR) {
    out.poseValues.legR = smoother.updateAngle(
      'pose.legR',
      raw.poseValues.legR,
      dt,
      0.2
    );
    out.poseValues.kneeR = smoother.updateAngle(
      'pose.kneeR',
      raw.poseValues.kneeR,
      dt,
      0.2
    );
  }

  out.hands = smoothHands(raw.hands, dt);
  return out;
}

function smoothHands(rawHands, dt) {
  if (!rawHands) {
    return { screenLeft: null, screenRight: null, any: false, bestChin: null };
  }
  const smoother = state.smoother;
  const smoothOne = (hand) => {
    if (!hand) return null;
    const side = hand.side;
    const out = { ...hand };
    for (const field of ['distChin', 'distBelly', 'distHead']) {
      if (hand[field] == null || !Number.isFinite(hand[field])) {
        out[field] = null;
      } else {
        out[field] = smoother.update(
          `hand.${side}.${field}`,
          hand[field],
          dt,
          0.15
        );
      }
    }
    if (hand.openness == null || !Number.isFinite(hand.openness)) {
      out.openness = null;
      out.fingers = null;
      out.thumb = null;
    } else {
      out.openness = smoother.update(
        `hand.${side}.openness`,
        hand.openness,
        dt,
        0.15
      );
      out.fingers = Array.isArray(hand.fingers)
        ? hand.fingers.map((value, index) =>
            smoother.update(`hand.${side}.finger.${index}`, value, dt, 0.15)
          )
        : null;
      out.thumb =
        hand.thumb == null
          ? null
          : smoother.update(`hand.${side}.thumb`, hand.thumb, dt, 0.15);
    }

    if (hand.wrist) {
      const wrist = { ...hand.wrist };
      if (hand.wrist.basis) {
        // 屈伸 / 侧偏用相对增量：绝对角度在托腮 / 捧腹这类手本来就弯得很
        // 厉害的姿势里会顶在钳位边界，手腕再抬 / 压输出都不变，看起来就像
        // 没跟上。参考点取手刚出现（或重新回到画面）时的手型；手离开画面
        // 期间奶龙的手已经回中，所以重新出现时也从 0 起算，不会跳回旧值。
        const now = performance.now();
        let ref = state.wristRef[side];
        if (!ref || now - ref.at > 400) {
          ref = state.wristRef[side] = {
            h: hand.wrist.basis.h,
            fore: hand.wrist.basis.fore,
            at: now,
            offset: { flex: 0, dev: 0 },
          };
        } else {
          ref.at = now;
        }
        const delta = wristDeltas(ref, hand.wrist.basis, side);
        wrist.flex = clamp(ref.offset.flex + delta.flex, -60, 60);
        wrist.dev = clamp(ref.offset.dev + delta.dev, -45, 45);
        // 前臂旋转在单目下噪声最大，手型交给挑战预设，这里不再叠加。
        wrist.twist = 0;
      } else if (hand.wrist.flex == null || !Number.isFinite(hand.wrist.flex)) {
        // 前臂看不见时没有可比较的方向，回中，避免停在上一帧的怪姿势。
        wrist.flex = 0;
        wrist.dev = 0;
        wrist.twist = 0;
      } else {
        // 纯 2D 兜底：屏幕平面上的弯腕角，没有基向量可做增量。
        wrist.dev = 0;
        wrist.twist = 0;
      }
      wrist.confidence =
        hand.wrist.confidence == null || !Number.isFinite(hand.wrist.confidence)
          ? 0
          : smoother.update(
              `hand.${side}.wrist.confidence`,
              hand.wrist.confidence,
              dt,
              0.2
            );
      out.wrist = wrist;
    } else {
      out.wrist = null;
    }
    return out;
  };

  const screenLeft = smoothOne(rawHands.screenLeft);
  const screenRight = smoothOne(rawHands.screenRight);
  const present = [screenLeft, screenRight].filter(Boolean);
  const chinHands = present
    .filter((hand) => hand.distChin != null && Number.isFinite(hand.distChin))
    .sort((a, b) => a.distChin - b.distChin);

  return {
    screenLeft,
    screenRight,
    any: present.length > 0,
    bestChin: chinHands[0] ?? null,
  };
}

function updateGameplay(metrics, dt) {
  // 打开玩法说明时暂停计分与倒计时，关掉后继续。
  if (state.helpOpen) return;
  state.phaseTime += dt;

  const result = metrics.hasFace
    ? scoreMetrics(metrics, state.challenge)
    : null;
  state.lastScoreResult = result;

  if (result && result.score != null) {
    const alpha = 1 - Math.exp(-dt / 0.28);
    state.scoreSmooth =
      state.scoreSmooth == null
        ? result.score
        : state.scoreSmooth + (result.score - state.scoreSmooth) * alpha;

    if (result.score > state.peak) {
      state.peak = result.score;
      state.peakExpr = result.exprScore;
      state.peakPose = result.poseScore;
      state.peakHead = result.headScore;
    }
    state.validTime += dt;

    if (result.score >= PERFECT_SCORE && result.perfectEligible) {
      state.holdTime += dt;
      if (state.holdTime >= PERFECT_HOLD_SECONDS && !state.perfect) {
        state.perfect = true;
        onPerfect();
      }
    } else {
      state.holdTime = Math.max(0, state.holdTime - dt * 2.5);
    }
  } else {
    state.holdTime = Math.max(0, state.holdTime - dt * 2.5);
    state.scoreSmooth = Math.max(0, (state.scoreSmooth ?? 0) - dt * 22);
  }

  if (state.mode === 'challenge' && metrics.hasFace) {
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    if (state.timeLeft <= 0) {
      endRound();
    }
  }
}

function onPerfect() {
  sound.perfect();
  document.body.classList.add('is-perfect');
  els.perfectFlash.hidden = false;
  restartAnimation(els.perfectFlash, 'perfectPop');
  setTimeout(() => {
    els.perfectFlash.hidden = true;
    document.body.classList.remove('is-perfect');
  }, 2600);

  const rect = (els.liveWrap || els.avatarCanvas).getBoundingClientRect();
  // 从头顶上方撒花，纸屑落下时不会糊住奶龙的眼睛和嘴。
  confetti.burst(rect.left + rect.width / 2, rect.top + rect.height * 0.08, 120);
}

/* ============================ 演示模式 ============================ */

function demoHands(challenge, ramp, clock) {
  const cfg = challenge.hand;
  const distance =
    lerp(1.2, cfg.positionTarget * 0.7, ramp) + 0.01 * Math.sin(clock * 2);
  const opennessTarget =
    cfg.openness + (cfg.opennessMode === 'min' ? 0.08 : -0.02);
  const openness = clamp01(
    lerp(0.4, opennessTarget, ramp) + 0.015 * Math.sin(clock * 2.4)
  );
  const fingers = [openness, openness, openness, openness];
  const makeHand = (side) => ({
    present: true,
    fromPose: false,
    side,
    center: { x: 0.5, y: 0.5 },
    distChin: distance,
    distBelly: distance,
    distHead: distance,
    openness,
    fingers,
    thumb: openness,
    wrist: {
      flex: 4 * Math.sin(clock * 1.7 + (side === 'screenLeft' ? 0 : 0.8)),
      dev: 2 * Math.sin(clock * 1.3),
      twist: 3 * Math.sin(clock * 1.1 + 0.4),
      source: 'demo',
      confidence: 1,
    },
  });
  const left = makeHand('screenLeft');
  return {
    screenLeft: left,
    screenRight: cfg.sides === 'both' ? makeHand('screenRight') : null,
    any: true,
    bestChin: left,
  };
}

function demoMetrics(now) {
  const challenge = state.challenge;
  const t = state.phaseTime;
  const clock = now / 1000;
  const ramp = smoothstep(1.0, 6.5, t);
  const exprTarget = challenge.target.expr;
  const poseTarget = challenge.target.pose;
  const neutral = { armL: -16, foreL: -8, armR: 16, foreR: 8 };
  const hands = demoHands(challenge, ramp, clock);

  return {
    hasFace: true,
    hasPose: true,
    hands,
    availability: {
      face: true,
      armL: true,
      armR: true,
      torso: true,
      legL: true,
      legR: true,
      hands: true,
      handLeft: Boolean(hands.screenLeft),
      handRight: Boolean(hands.screenRight),
      headYaw: true,
      headPitch: true,
      bodyYaw: true,
      bodyPitch: true,
      wristL: true,
      wristR: true,
    },
    headSource: 'demo',
    bodyYawSource: 'demo',
    bodyPitchValid: true,
    expr: {
      mouthOpen: clamp01(
        0.08 +
          (exprTarget.mouthOpen - 0.08) * ramp +
          0.025 * Math.sin(clock * 3.1)
      ),
      smile: clamp01(
        0.15 +
          (exprTarget.smile - 0.15) * ramp +
          0.02 * Math.sin(clock * 2.3 + 1)
      ),
      squint: clamp01(
        0.1 +
          (exprTarget.squint - 0.1) * ramp +
          0.02 * Math.sin(clock * 1.9)
      ),
      brow: clamp01(0.2 + (exprTarget.brow - 0.2) * ramp),
      headTilt: challenge.target.headTilt * ramp + 1.5 * Math.sin(clock * 1.1),
      headYaw: 5 * Math.sin(clock * 0.8) * ramp,
      headPitch:
        (challenge.id === 'head' ? 12 : 2) * ramp +
        1.5 * Math.sin(clock * 1.2),
    },
    poseValues: {
      armL:
        lerp(neutral.armL, poseTarget.armL, ramp) +
        3 * Math.sin(clock * 1.3),
      foreL:
        lerp(neutral.foreL, poseTarget.foreL, ramp) +
        3 * Math.sin(clock * 1.1 + 0.5),
      armR:
        lerp(neutral.armR, poseTarget.armR, ramp) -
        3 * Math.sin(clock * 1.3),
      foreR:
        lerp(neutral.foreR, poseTarget.foreR, ramp) -
        3 * Math.sin(clock * 1.1 + 0.5),
      // 演示没有 worldLandmarks，走 2D 角度路径；前后深度保持 0。
      armLForward: 0,
      foreLForward: 0,
      armRForward: 0,
      foreRForward: 0,
      armLTarget: null,
      armLElbow: null,
      armRTarget: null,
      armRElbow: null,
      torsoLean: poseTarget.torsoLean * ramp + 1.5 * Math.sin(clock * 1.3),
      legL: 8,
      kneeL: 5,
      legR: -8,
      kneeR: 5,
      bodyYaw: 4 * Math.sin(clock * 0.7) * ramp,
      bodyPitch: 1.5 * ramp + 0.8 * Math.sin(clock * 0.9),
    },
    raw: {
      shoulderMid: {
        x: 0.5 + 0.02 * Math.sin(clock * 0.8),
        y: 0.45,
      },
      faceResult: null,
      poseResult: null,
      handResult: null,
      pose: null,
    },
  };
}

/* ============================ 渲染 ============================ */

function render(now, dt) {
  const liveState = buildLiveState(now, dt);
  // 开发预览用：把这一帧的状态挂出来，方便在控制台 / Playwright 里
  // 复现「游戏里到底喂了什么给 3D 奶龙」。
  state.lastLive = liveState;
  let rendered3d = false;
  if (avatar3d) {
    try {
      avatar3d.render(liveState, now / 1000, dt);
      rendered3d = true;
    } catch (error) {
      disable3DAvatar(error);
    }
  }
  if (!rendered3d) {
    const ctx = els.avatarCanvas.getContext('2d');
    drawNailong(ctx, liveState, { time: now / 1000 });
  }
  drawCameraOverlay();
  confetti.update(dt);

  if (now - state.lastHudAt > 90) {
    state.lastHudAt = now;
    updateHUD();
  }
}

function buildLiveState(now, dt) {
  const time = now / 1000;
  const idle = idleState(time);
  const metrics = state.demo || now - state.lastProcessedAt < 500 ? state.smoothed : null;
  const hasFace = Boolean(metrics?.hasFace);
  const hasPose = Boolean(metrics?.hasPose);
  const visual = state.visual;
  const exprAlpha = 1 - Math.exp(-dt / 0.16);

  visual.presence += ((hasFace ? 1 : 0) - visual.presence) * exprAlpha;

  const exprTarget = hasFace
    ? {
        mouthOpen: clamp01(metrics.expr.mouthOpen * 1.18),
        smile: clamp01(metrics.expr.smile * 1.14 + 0.05),
        squint: clamp01(metrics.expr.squint * 1.25),
        brow: clamp01(metrics.expr.brow),
      }
    : idle.expr;

  for (const key of ['mouthOpen', 'smile', 'squint', 'brow']) {
    visual.expr[key] = lerp(visual.expr[key], exprTarget[key], exprAlpha);
  }

  const wantHeadTilt = hasFace ? metrics.expr.headTilt * 0.8 : idle.headTilt;
  visual.headTilt = easeAngle(visual.headTilt, wantHeadTilt, dt, 0.24);

  const headYawTarget =
    hasFace && metrics.availability.headYaw
      ? deadZone(metrics.expr.headYaw, 1.5)
      : 0;
  const headPitchTarget =
    hasFace && metrics.availability.headPitch
      ? deadZone(metrics.expr.headPitch, 1.5)
      : 0;
  visual.headYaw = easeAngle(visual.headYaw, headYawTarget, dt, 0.14);
  visual.headPitch = easeAngle(visual.headPitch, headPitchTarget, dt, 0.16);

  const bodyYawTarget = metrics?.availability.bodyYaw
    ? deadZone(metrics.poseValues.bodyYaw, 2)
    : 0;
  const bodyPitchTarget = metrics?.availability.bodyPitch
    ? deadZone(metrics.poseValues.bodyPitch, 2)
    : 0;
  visual.bodyYaw = easeAngle(visual.bodyYaw, bodyYawTarget, dt, 0.2);
  visual.bodyPitch = easeAngle(visual.bodyPitch, bodyPitchTarget, dt, 0.24);

  // 奶龙面朝观众，所以它的「左手」画在屏幕右侧。
  // 在镜像预览里，用户的右手也出现在屏幕右侧 —— 这里按屏幕方位对应，而不是按解剖学左右。
  const screenRightUpper = metrics?.availability.armR
    ? metrics.poseValues.armR
    : idle.arms.left.upper;
  const screenRightFore = metrics?.availability.armR
    ? metrics.poseValues.foreR
    : idle.arms.left.fore;
  const screenLeftUpper = metrics?.availability.armL
    ? metrics.poseValues.armL
    : idle.arms.right.upper;
  const screenLeftFore = metrics?.availability.armL
    ? metrics.poseValues.foreL
    : idle.arms.right.fore;

  visual.arms.left.upper = easeAngle(
    visual.arms.left.upper,
    screenRightUpper,
    dt,
    0.065
  );
  visual.arms.left.fore = easeAngle(
    visual.arms.left.fore,
    screenRightFore,
    dt,
    0.065
  );
  visual.arms.right.upper = easeAngle(
    visual.arms.right.upper,
    screenLeftUpper,
    dt,
    0.065
  );
  visual.arms.right.fore = easeAngle(
    visual.arms.right.fore,
    screenLeftFore,
    dt,
    0.065
  );

  // 前后深度是独立自由度，慢一点平滑，免得 MediaPipe 的 z 噪声让手臂来回抽。
  visual.arms.left.forward = easeAngle(
    visual.arms.left.forward,
    metrics?.availability.armR ? metrics.poseValues.armRForward ?? 0 : 0,
    dt,
    0.26
  );
  visual.arms.left.foreForward = easeAngle(
    visual.arms.left.foreForward,
    metrics?.availability.armR ? metrics.poseValues.foreRForward ?? 0 : 0,
    dt,
    0.26
  );
  visual.arms.right.forward = easeAngle(
    visual.arms.right.forward,
    metrics?.availability.armL ? metrics.poseValues.armLForward ?? 0 : 0,
    dt,
    0.26
  );
  visual.arms.right.foreForward = easeAngle(
    visual.arms.right.foreForward,
    metrics?.availability.armL ? metrics.poseValues.foreLForward ?? 0 : 0,
    dt,
    0.26
  );

  // 单目 3D：世界坐标 → 玩家躯干局部坐标 → 奶龙胸口局部坐标。
  // targetMix 在跟踪丢失时缓慢退回 2D，避免 3D 和平面两套落点硬切。
  const screenRightTarget = metrics?.availability.armR
    ? metrics.poseValues.armRTarget
    : null;
  const screenRightElbow = metrics?.availability.armR
    ? metrics.poseValues.armRElbow
    : null;
  const screenLeftTarget = metrics?.availability.armL
    ? metrics.poseValues.armLTarget
    : null;
  const screenLeftElbow = metrics?.availability.armL
    ? metrics.poseValues.armLElbow
    : null;
  const targetAlpha = 1 - Math.exp(-Math.max(0.001, dt) / 0.18);
  visual.arms.left.targetMix = lerp(
    visual.arms.left.targetMix,
    screenRightTarget ? 1 : 0,
    targetAlpha
  );
  visual.arms.right.targetMix = lerp(
    visual.arms.right.targetMix,
    screenLeftTarget ? 1 : 0,
    targetAlpha
  );
  if (screenRightTarget) {
    visual.arms.left.target = easePoint(
      visual.arms.left.target,
      screenRightTarget,
      dt,
      0.14
    );
  }
  if (screenRightElbow) {
    visual.arms.left.elbow = easePoint(
      visual.arms.left.elbow,
      screenRightElbow,
      dt,
      0.14
    );
  }
  if (screenLeftTarget) {
    visual.arms.right.target = easePoint(
      visual.arms.right.target,
      screenLeftTarget,
      dt,
      0.14
    );
  }
  if (screenLeftElbow) {
    visual.arms.right.elbow = easePoint(
      visual.arms.right.elbow,
      screenLeftElbow,
      dt,
      0.14
    );
  }

  // 屏幕左侧的手驱动奶龙屏幕左侧（arms.right）；右侧同理。
  visual.arms.right.hand = easeHand(
    visual.arms.right.hand,
    metrics?.hands?.screenLeft,
    dt
  );
  visual.arms.left.hand = easeHand(
    visual.arms.left.hand,
    metrics?.hands?.screenRight,
    dt
  );

  const screenRightLegTarget = metrics?.availability.legR
    ? clamp(metrics.poseValues.legR * 0.6, -20, 20)
    : idle.legs.left.hip;
  const screenLeftLegTarget = metrics?.availability.legL
    ? clamp(metrics.poseValues.legL * 0.6, -20, 20)
    : idle.legs.right.hip;
  visual.legs.left.hip = lerp(
    visual.legs.left.hip,
    screenRightLegTarget,
    1 - Math.exp(-dt / 0.2)
  );
  visual.legs.right.hip = lerp(
    visual.legs.right.hip,
    screenLeftLegTarget,
    1 - Math.exp(-dt / 0.2)
  );
  const screenRightKneeTarget = metrics?.availability.legR
    ? clamp(metrics.poseValues.kneeR * 0.6, -20, 20)
    : idle.legs.left.knee;
  const screenLeftKneeTarget = metrics?.availability.legL
    ? clamp(metrics.poseValues.kneeL * 0.6, -20, 20)
    : idle.legs.right.knee;
  visual.legs.left.knee = lerp(
    visual.legs.left.knee,
    screenRightKneeTarget,
    1 - Math.exp(-dt / 0.2)
  );
  visual.legs.right.knee = lerp(
    visual.legs.right.knee,
    screenLeftKneeTarget,
    1 - Math.exp(-dt / 0.2)
  );

  const leanTarget = metrics?.availability.torso
    ? metrics.poseValues.torsoLean
    : idle.torsoLean;
  visual.torsoLean = lerp(visual.torsoLean, leanTarget, 1 - Math.exp(-dt / 0.2));

  const shoulderMid = metrics?.raw?.shoulderMid;
  const targetX =
    hasPose && shoulderMid ? clamp((shoulderMid.x - 0.5) * 70, -24, 24) : 0;
  const targetY =
    hasPose && shoulderMid ? clamp((0.45 - shoulderMid.y) * 50, -10, 12) : 0;
  visual.offsetX = lerp(visual.offsetX, targetX, 1 - Math.exp(-dt / 0.25));
  visual.offsetY = lerp(visual.offsetY, targetY, 1 - Math.exp(-dt / 0.25));

  const score = state.scoreSmooth ?? 0;
  // 思考挑战是「闭嘴别笑」，分数高时也不能冒哈哈哈气泡。
  const laughTarget =
    state.challenge.id !== 'thinking' &&
    (state.phase === 'playing' || state.phase === 'result')
      ? smoothstep(72, 93, score)
      : 0;
  visual.laugh = lerp(visual.laugh, laughTarget, 1 - Math.exp(-dt / 0.3));

  // 头部自由度拆成「脖子 + 头」两段。躯干已经先转掉 bodyYaw / bodyPitch，
  // 所以这里只补剩余量；这样脚底不会跟着头转，脖子也不会被拧成一根木棍。
  const neckYawResidual = clamp(
    wrapDeg(visual.headYaw - visual.bodyYaw),
    -50,
    50
  );
  const neckYaw = clamp(neckYawResidual * 0.68, -34, 34);
  const headYawResidual = clamp(neckYawResidual - neckYaw, -24, 24);
  const neckPitchResidual = clamp(
    visual.headPitch + visual.bodyPitch,
    -55,
    55
  );
  const neckPitch = clamp(neckPitchResidual * 0.65, -35, 35);
  const headPitchResidual = clamp(
    neckPitchResidual - neckPitch,
    -24,
    24
  );
  const neckRollResidual = clamp(
    wrapDeg(visual.headTilt - visual.torsoLean),
    -45,
    45
  );
  const neckRoll = neckRollResidual * 0.4;
  const headRoll = neckRollResidual - neckRoll;

  const rig = {
    tracked: !state.demo && hasFace,
    body: {
      yaw: visual.bodyYaw,
      pitch: visual.bodyPitch,
      roll: visual.torsoLean,
    },
    neck: { yaw: neckYaw, pitch: neckPitch, roll: neckRoll },
    head: {
      yaw: headYawResidual,
      pitch: headPitchResidual,
      roll: headRoll,
    },
  };

  return {
    expr: visual.expr,
    arms: visual.arms,
    legs: visual.legs,
    torsoLean: visual.torsoLean,
    headTilt: visual.headTilt,
    headYaw: visual.headYaw,
    headPitch: visual.headPitch,
    bodyYaw: visual.bodyYaw,
    bodyPitch: visual.bodyPitch,
    rig,
    offsetX: visual.offsetX,
    offsetY: visual.offsetY,
    laugh: visual.laugh,
    tracked: hasFace,
    challengeId: state.challenge.id,
    active:
      state.phase === 'countdown' ||
      state.phase === 'playing' ||
      state.phase === 'result',
  };
}

/* ============================ 摄像头骨架 ============================ */

const POSE_CONNECTIONS = [
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

function clearCameraOverlay() {
  const canvas = els.camOverlay;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawCameraOverlay() {
  const canvas = els.camOverlay;
  if (!state.cameraReady || !state.showSkeleton || els.camPip.hidden) {
    return;
  }
  const metrics = state.smoothed;
  if (!metrics || performance.now() - state.lastProcessedAt > 600) {
    clearCameraOverlay();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(rect.width * dpr);
  const pixelHeight = Math.round(rect.height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const videoWidth = els.video.videoWidth || 1280;
  const videoHeight = els.video.videoHeight || 720;
  const scale = Math.max(rect.width / videoWidth, rect.height / videoHeight);
  const drawWidth = videoWidth * scale;
  const drawHeight = videoHeight * scale;
  const offsetX = (rect.width - drawWidth) / 2;
  const offsetY = (rect.height - drawHeight) / 2;
  const map = (x, y) => [
    offsetX + x * drawWidth,
    offsetY + y * drawHeight,
  ];

  if (metrics.hasFace && metrics.faceBox) {
    const { minX, maxX, minY, maxY } = metrics.faceBox;
    const [x1, y1] = map(minX, minY);
    const [x2, y2] = map(maxX, maxY);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 212, 59, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.restore();
  }

  const poseLm = metrics.raw?.poseResult?.landmarks?.[0];
  if (poseLm && metrics.hasPose) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 107, 87, 0.95)';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    const usedPoints = new Set();
    for (const [a, b] of POSE_CONNECTIONS) {
      const pa = poseLm[a];
      const pb = poseLm[b];
      if (!pa || !pb) continue;
      if ((pa.visibility ?? 1) < 0.35 || (pb.visibility ?? 1) < 0.35) continue;
      usedPoints.add(a);
      usedPoints.add(b);
      const [x1, y1] = map(pa.x, pa.y);
      const [x2, y2] = map(pb.x, pb.y);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 253, 246, 0.95)';
    for (const index of usedPoints) {
      const point = poseLm[index];
      if (!point) continue;
      const [x, y] = map(point.x, point.y);
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  const handResults = metrics.raw?.handResult?.landmarks;
  if (Array.isArray(handResults)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(139, 124, 246, 0.98)';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (const hand of handResults) {
      if (!Array.isArray(hand) || hand.length < 21) continue;
      const used = new Set();
      for (const [a, b] of HAND_CONNECTIONS) {
        const pa = hand[a];
        const pb = hand[b];
        if (!pa || !pb) continue;
        used.add(a);
        used.add(b);
        const [x1, y1] = map(pa.x, pa.y);
        const [x2, y2] = map(pb.x, pb.y);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 253, 246, 0.95)';
      for (const index of used) {
        const point = hand[index];
        if (!point) continue;
        const [x, y] = map(point.x, point.y);
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/* ============================ HUD ============================ */

function updateHUD(force = false) {
  const metrics = state.demo || performance.now() - state.lastProcessedAt < 500 ? state.smoothed : null;
  const hasFace = Boolean(metrics?.hasFace);
  const result = state.lastScoreResult;
  const showLive = state.phase === 'playing';
  const showResult = state.phase === 'result';

  let scoreDisplay = null;
  if (showLive && hasFace && result?.score != null) {
    scoreDisplay = Math.round(state.scoreSmooth ?? result.score);
  } else if (showResult) {
    scoreDisplay = Math.round(state.peak || 0);
  }

  els.scoreValue.textContent = scoreDisplay == null ? '--' : String(scoreDisplay);
  const ring = scoreDisplay == null ? 0 : clamp(scoreDisplay, 0, 100);
  els.scoreRing.style.strokeDashoffset = String(100 - ring);
  els.scoreRing.classList.remove('is-low', 'is-mid', 'is-high', 'is-perfect');
  els.scoreRing.classList.add(
    ring >= 90 ? 'is-perfect' : ring >= 75 ? 'is-high' : ring >= 50 ? 'is-mid' : 'is-low'
  );

  const expr = result?.exprScore;
  const pose = result?.poseScore;
  const head = result?.headScore;
  const ready = showLive || showResult;
  setSubscore(els.exprBar, els.exprValue, ready ? expr : null);
  setSubscore(els.poseBar, els.poseValue, ready ? pose : null);
  setSubscore(els.headBar, els.headValue, ready ? head : null);

  updateGradeChip(scoreDisplay, showLive, showResult);
  updateTimer(hasFace);
  updatePerfectHold();

  if (state.demo) {
    setStatus(state.phase === 'result' ? '演示结束' : '演示模式', 'is-demo');
  } else if (state.phase === 'idle') {
    setStatus('等待开始', 'is-idle');
  } else if (state.phase === 'countdown') {
    setStatus('准备中', 'is-idle');
  } else if (state.phase === 'result') {
    setStatus(
      state.endedEarly
        ? '提前结束'
        : state.mode === 'challenge'
          ? '挑战结束'
          : '练习结束',
      'is-idle'
    );
  } else if (state.phase === 'playing') {
    if (state.detectError) {
      setStatus('识别出错，请刷新', 'is-danger');
    } else if (!metrics) {
      setStatus('启动中', 'is-warn');
    } else if (!hasFace) {
      setStatus('找不到脸', 'is-danger');
    } else if (!state.demo && state.faceTooSmall) {
      setStatus('脸部较远，请靠近一点', 'is-warn');
    } else if (state.challenge.requirePose && !metrics.hasPose) {
      setStatus('看不到上半身', 'is-warn');
    } else if (state.perfect) {
      setStatus('完美模仿！', 'is-live');
    } else {
      setStatus('追踪中', 'is-live');
    }
  }

  updateFeedback(force, hasFace, metrics);
}

function setSubscore(bar, valueEl, value) {
  const safe = value == null ? 0 : clamp(value, 0, 100);
  bar.style.width = `${safe}%`;
  valueEl.textContent = value == null ? '--' : String(Math.round(safe));
}

function updateGradeChip(score, showLive, showResult) {
  let text = '等待挑战';
  let cls = 'grade-chip is-muted';

  if (showResult) {
    // 和结算弹窗使用同一个四舍五入后的分数，避免 91.6 在弹窗是 S、HUD 却是 A。
    const grade = gradeFor(Math.round(state.peak || 0));
    text = `${grade.grade} · ${grade.title}`;
    cls = `grade-chip is-${grade.color}`;
  } else if (showLive && score == null) {
    text = state.smoothed?.hasFace === false ? '找不到脸' : '识别中';
    cls = 'grade-chip is-muted';
  } else if (showLive && score != null) {
    if (score >= 92) {
      text = '奶龙附体！';
      cls = 'grade-chip is-gold';
    } else if (score >= 82) {
      text = '超像！';
      cls = 'grade-chip is-mint';
    } else if (score >= 70) {
      text = '有内味！';
      cls = 'grade-chip is-blue';
    } else if (score >= 55) {
      text = '再夸张一点';
      cls = 'grade-chip is-gold';
    } else {
      text = '还不太像';
      cls = 'grade-chip is-muted';
    }
  } else if (state.phase === 'countdown') {
    text = '准备！';
    cls = 'grade-chip is-gold';
  }

  if (els.gradeChip.textContent !== text) els.gradeChip.textContent = text;
  if (els.gradeChip.className !== cls) els.gradeChip.className = cls;
}

function updateTimer(hasFace) {
  if (state.mode === 'challenge') {
    if (state.phase === 'playing') {
      els.timer.textContent = formatTime(state.timeLeft);
      els.timerBox.classList.toggle('is-paused', !hasFace);
    } else if (state.phase === 'result') {
      els.timer.textContent = state.endedEarly
        ? formatTime(state.timeLeft)
        : '00:00';
      els.timerBox.classList.remove('is-paused');
    } else {
      els.timer.textContent = formatTime(ROUND_SECONDS);
      els.timerBox.classList.remove('is-paused');
    }
  } else {
    els.timerLabel.textContent = '自由练习';
    els.timer.textContent = '∞';
    els.timerBox.classList.remove('is-paused');
  }
  if (state.phase === 'playing' && state.mode === 'challenge') {
    els.timerLabel.textContent = '剩余';
  }
}

function updatePerfectHold() {
  const percent = clamp((state.holdTime / PERFECT_HOLD_SECONDS) * 100, 0, 100);
  els.perfectFill.style.width = `${percent}%`;
  if (state.perfect) {
    els.perfectText.textContent = '完美模仿已达成！';
  } else if (state.phase === 'playing' && state.holdTime > 0.05) {
    const left = Math.max(0, PERFECT_HOLD_SECONDS - state.holdTime);
    els.perfectText.textContent = `还差 ${left.toFixed(1)} 秒`;
  } else {
    els.perfectText.textContent = '保持 90 分 2 秒';
  }
}

function updateFeedback(force, hasFace, metrics) {
  let message = null;
  if (state.phase === 'playing') {
    if (state.detectError) {
      message = '识别出错了。请刷新页面，或点「结束本轮」收场。';
    } else if (!metrics) {
      message = '正在启动识别，先站好别动～';
    } else if (!hasFace) {
      message = '暂时没看清脸，请靠近一点、面向光线，计时已暂停～';
    } else if (!state.demo && state.faceTooSmall) {
      message = '脸部细节有点小，请向前半步，保持头和双手都在画面里～';
    } else if (state.challenge.requirePose && !metrics.hasPose) {
      message = '后退一点，让镜头看到你的上半身～';
    } else {
      message = state.lastScoreResult?.feedback?.[0] || '保持住，奶龙在看着你！';
    }
  } else if (state.phase === 'countdown') {
    message = '准备！3 秒后开始，摆出目标姿势～';
  } else if (state.phase === 'result') {
    message = state.endedEarly
      ? '本轮提前结束，成绩不会写入最佳纪录。'
      : state.perfect
        ? '完美模仿达成！奶龙都佩服你。'
        : '挑战结束，看看你的模仿成绩吧！';
  } else if (state.phase === 'idle') {
    message = '点击开始，先对着镜头站好～';
  }

  if (!message) return;
  const now = performance.now();
  if (
    force ||
    (message !== state.lastFeedbackText &&
      now - state.lastFeedbackAt > 750)
  ) {
    els.feedbackText.textContent = message;
    state.lastFeedbackText = message;
    state.lastFeedbackAt = now;
    restartAnimation(els.feedbackText, 'feedback-text-swap');
  }
}

function setStatus(text, cls) {
  if (els.statusText.textContent !== text) els.statusText.textContent = text;
  const next = `status-chip ${cls}`;
  if (els.statusChip.className !== next) els.statusChip.className = next;
}

/* ============================ 工具 ============================ */

function formatTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `00:${String(safe).padStart(2, '0')}`;
}

function easeAngle(current, target, dt, tau = 0.2) {
  const alpha = 1 - Math.exp(-Math.max(0.001, dt) / tau);
  return wrapDeg(current + wrapDeg(target - current) * alpha);
}

/** 连续死区：带内归零，带外扣掉带宽，避免在阈值处跳一下。 */
function deadZone(angle, band) {
  const value = wrapDeg(angle);
  const magnitude = Math.abs(value);
  return magnitude <= band ? 0 : Math.sign(value) * (magnitude - band);
}

function easePoint(current, target, dt, tau = 0.15) {
  if (!target) return current;
  const alpha = 1 - Math.exp(-Math.max(0.001, dt) / tau);
  if (!current) return { ...target };
  return {
    x: current.x + (target.x - current.x) * alpha,
    y: current.y + (target.y - current.y) * alpha,
    z: current.z + (target.z - current.z) * alpha,
  };
}

function easeHand(current, hand, dt) {
  const alpha = 1 - Math.exp(-Math.max(0.001, dt) / 0.15);
  // 不拿开合度当「手在不在」的门：手在画面里、只是某一帧没算出开合度时，
  // 已经算好的腕角也应该继续用。
  const target = hand ?? null;
  const fallbackFingers = [0.35, 0.35, 0.35, 0.35];
  const currentFingers = current?.fingers ?? fallbackFingers;
  const targetFingers = target?.fingers ?? fallbackFingers;
  const wristAlpha = 1 - Math.exp(-Math.max(0.001, dt) / 0.07);
  const currentWrist = current?.wrist ?? { flex: 0, dev: 0, twist: 0 };
  const targetWrist =
    target?.wrist && Number.isFinite(target.wrist.flex)
      ? target.wrist
      : { flex: 0, dev: 0, twist: 0 };
  return {
    tracked: Boolean(target?.fingers && !target.fromPose && !state.demo),
    openness: lerp(current?.openness ?? 0.35, target?.openness ?? 0.35, alpha),
    fingers: targetFingers.map((value, index) =>
      lerp(currentFingers[index] ?? 0.35, value, alpha)
    ),
    thumb: lerp(current?.thumb ?? 0.4, target?.thumb ?? 0.4, alpha),
    wrist: {
      flex: lerp(
        currentWrist.flex ?? 0,
        deadZone(targetWrist.flex ?? 0, 1.5),
        wristAlpha
      ),
      dev: lerp(
        currentWrist.dev ?? 0,
        deadZone(targetWrist.dev ?? 0, 1.5),
        wristAlpha
      ),
      twist: lerp(
        currentWrist.twist ?? 0,
        deadZone(targetWrist.twist ?? 0, 2),
        wristAlpha
      ),
      source: target?.wrist?.source ?? current?.wrist?.source ?? null,
    },
  };
}

function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function replayAnimation(element) {
  element.style.animation = 'none';
  void element.offsetWidth;
  element.style.animation = '';
}

function updateSoundButton() {
  els.soundBtn.textContent = sound.enabled ? '🔊' : '🔇';
  els.soundBtn.setAttribute('aria-label', sound.enabled ? '关闭声音' : '打开声音');
  els.soundBtn.setAttribute('aria-pressed', String(sound.enabled));
}

function setIntroStatus(text, mode = 'loading') {
  els.introStatusText.textContent = text;
  els.introStatus.classList.toggle('is-ready', mode === 'ready');
  els.introStatus.classList.toggle('is-error', mode === 'error');

  let spinner = els.introStatus.querySelector('.spinner');
  let dot = els.introStatus.querySelector('.status-dot');
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'status-dot';
    els.introStatus.insertBefore(dot, els.introStatusText);
  }
  if (!spinner) {
    spinner = document.createElement('span');
    spinner.className = 'spinner';
    els.introStatus.insertBefore(spinner, els.introStatusText);
  }

  spinner.hidden = mode !== 'loading';
  dot.hidden = mode === 'loading';
  dot.className = `status-dot ${mode === 'ready' ? 'ok' : mode === 'error' ? 'error' : 'loading'}`;
}

function updateButtons() {
  const locked = !state.modelsReady;
  const running = state.phase === 'playing' || state.phase === 'countdown';
  const requesting = state.cameraRequesting;

  for (const button of [
    els.introStartBtn,
    els.introPracticeBtn,
    els.startBtn,
    els.practiceBtn,
  ]) {
    button.disabled = locked || running || requesting;
  }
  els.demoBtn.disabled = requesting;
  for (const tab of els.challengeTabs.querySelectorAll('[data-challenge]')) {
    tab.disabled = running;
  }

  els.startBtn.hidden = running;
  els.practiceBtn.hidden = running;
  els.stopBtn.hidden = state.phase !== 'playing';
  els.stopBtn.textContent = state.mode === 'practice' ? '结束练习' : '结束本轮';
}

/* ============================ 事件 ============================ */

function startAgain(mode) {
  // 演示局结束后「再来一次」仍然保持演示，不要偷偷打开摄像头。
  startRound(mode, { demo: state.demo });
}

function wireEvents() {
  for (const tab of els.challengeTabs.querySelectorAll('[data-challenge]')) {
    tab.addEventListener('click', () => setChallenge(tab.dataset.challenge));
  }

  els.introStartBtn.addEventListener('click', () => startRound('challenge'));
  els.introPracticeBtn.addEventListener('click', () => startRound('practice'));
  els.startBtn.addEventListener('click', () => startAgain('challenge'));
  els.practiceBtn.addEventListener('click', () => startAgain('practice'));
  els.stopBtn.addEventListener('click', () => endRound(true));
  els.retryBtn.addEventListener('click', () => startAgain(state.mode));
  els.practiceAgainBtn.addEventListener('click', () => startAgain('practice'));
  els.homeBtn.addEventListener('click', showHome);

  els.demoBtn.addEventListener('click', () => startRound('challenge', { demo: true }));
  els.modelRetryBtn.addEventListener('click', initModels);

  els.soundBtn.addEventListener('click', () => {
    sound.setEnabled(!sound.enabled);
    updateSoundButton();
    if (sound.enabled) sound.click();
  });

  els.helpBtn.addEventListener('click', () => {
    sound.click();
    toggleHelp(true);
  });
  els.helpClose.addEventListener('click', () => toggleHelp(false));
  els.helpCloseBtn.addEventListener('click', () => toggleHelp(false));
  els.helpStartBtn.addEventListener('click', () => {
    toggleHelp(false);
    if (state.phase === 'idle' || state.phase === 'result') {
      startRound('challenge', { demo: state.demo });
    }
  });

  els.skeletonBtn.addEventListener('click', () => {
    state.showSkeleton = !state.showSkeleton;
    els.skeletonBtn.setAttribute('aria-pressed', String(state.showSkeleton));
    els.skeletonBtn.textContent = state.showSkeleton ? '隐藏骨架' : '显示骨架';
    if (!state.showSkeleton) clearCameraOverlay();
  });

  els.helpOverlay.addEventListener('click', (event) => {
    if (event.target === els.helpOverlay) toggleHelp(false);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!els.helpOverlay.hidden) toggleHelp(false);
    }
    if (event.code === 'Space' && state.phase === 'idle') {
      const target = document.activeElement;
      if (target && ['BUTTON', 'INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      event.preventDefault();
      if (!els.introOverlay.hidden) startRound('challenge');
    }
  });

  document.addEventListener('visibilitychange', () => {
    state.lastLoop = performance.now();
  });

  window.addEventListener('beforeunload', stopCamera);
}

/* ============================ 调试接口（自动化测试用） ============================ */

window.__nailong = {
  state,
  confetti,
  startRound,
  endRound,
  showHome,
  demoMetrics,
  setChallenge,
  getScore: () =>
    scoreMetrics(state.smoothed || demoMetrics(performance.now()), state.challenge),
};

init();
