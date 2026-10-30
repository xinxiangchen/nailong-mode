import { createNailong3D } from '../js/nailong3d.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'neutral';
const value = Number(params.get('v') ?? '0');
const challengeParam = params.get('challenge') ?? '';
const view = params.get('view') ?? '';
const canvas = document.querySelector('#stage');

function wrist(flex = 0, dev = 0, twist = 0) {
  return { flex, dev, twist };
}

const rig = {
  body: { yaw: 0, pitch: 0, roll: 0 },
  neck: { yaw: 0, pitch: 0, roll: 0 },
  head: { yaw: 0, pitch: 0, roll: 0 },
};

const arms = {
  left: {
    upper: 14,
    fore: 6,
    forward: 0,
    foreForward: 0,
    target: null,
    elbow: null,
    targetMix: 0,
    hand: {
      fingers: [0.35, 0.35, 0.35, 0.35],
      thumb: 0.4,
      wrist: wrist(),
    },
  },
  right: {
    upper: -14,
    fore: -6,
    forward: 0,
    foreForward: 0,
    target: null,
    elbow: null,
    targetMix: 0,
    hand: {
      fingers: [0.35, 0.35, 0.35, 0.35],
      thumb: 0.4,
      wrist: wrist(),
    },
  },
};

if (mode === 'neck-yaw') {
  rig.neck.yaw = value;
} else if (mode === 'neck-pitch') {
  rig.neck.pitch = value;
} else if (mode === 'head-pitch') {
  rig.neck.pitch = value * 0.65;
  rig.head.pitch = value * 0.35;
} else if (mode === 'neck-roll') {
  rig.head.roll = value;
} else if (mode === 'body-yaw') {
  rig.body.yaw = value;
} else if (mode === 'body-pitch') {
  rig.body.pitch = value;
} else if (mode === 'body-roll') {
  rig.body.roll = value;
} else if (mode.startsWith('wrist-')) {
  const flex = mode === 'wrist-flex' || mode === 'wrist-combo' ? value : 0;
  const dev = mode === 'wrist-dev' || mode === 'wrist-combo' ? value : 0;
  const twist = mode === 'wrist-twist' || mode === 'wrist-combo' ? value : 0;
  for (const arm of Object.values(arms)) {
    arm.upper = arm.upper > 0 ? 52 : -52;
    arm.fore = arm.fore > 0 ? -18 : 18;
    arm.hand.fingers = [1, 1, 1, 1];
    arm.hand.thumb = 1;
    arm.hand.wrist = wrist(flex, dev, twist);
  }
} else if (mode === 'combined') {
  rig.body = { yaw: value, pitch: value * 0.45, roll: value * 0.55 };
  rig.neck = { yaw: value * 0.8, pitch: value * 0.55, roll: value * 0.35 };
  rig.head = { yaw: value * 0.35, pitch: value * 0.35, roll: value * 0.3 };
  for (const arm of Object.values(arms)) {
    arm.upper = arm.upper > 0 ? 70 : -70;
    arm.fore = arm.fore > 0 ? -35 : 35;
    arm.hand.wrist = wrist(value, value * 0.65, value * 0.65);
  }
} else if (mode === 'arm-depth') {
  arms.left.target = { x: 0.55, y: -0.55, z: 0.55 };
  arms.left.elbow = { x: 0.45, y: -0.35, z: 0.25 };
  arms.right.target = { x: -0.55, y: -0.55, z: -0.55 };
  arms.right.elbow = { x: -0.45, y: -0.35, z: -0.25 };
  for (const arm of Object.values(arms)) arm.targetMix = 1;
} else if (mode === 'arm-forward') {
  arms.left.target = { x: 0.5, y: 0.1, z: 0.75 };
  arms.left.elbow = { x: 0.35, y: -0.15, z: 0.45 };
  arms.right.target = { x: -0.5, y: 0.1, z: 0.75 };
  arms.right.elbow = { x: -0.35, y: -0.15, z: 0.45 };
  for (const arm of Object.values(arms)) arm.targetMix = 1;
} else if (mode === 'arm-back') {
  arms.left.target = { x: 0.5, y: -0.4, z: -0.7 };
  arms.left.elbow = { x: 0.4, y: -0.3, z: -0.35 };
  arms.right.target = { x: -0.5, y: -0.4, z: -0.7 };
  arms.right.elbow = { x: -0.4, y: -0.3, z: -0.35 };
  for (const arm of Object.values(arms)) arm.targetMix = 1;
} else if (mode === 'challenge-3d') {
  const pose = {
    thinking: {
      left: [{ x: 0, y: -0.92, z: 0.05 }, { x: 0, y: -0.45, z: 0.05 }],
      right: [{ x: 0.55, y: 0.08, z: 0.3 }, { x: 0.45, y: -0.2, z: 0.15 }],
    },
    belly: {
      left: [{ x: -0.45, y: -0.4, z: 0.35 }, { x: -0.4, y: -0.25, z: 0.2 }],
      right: [{ x: 0.45, y: -0.4, z: 0.35 }, { x: 0.4, y: -0.25, z: 0.2 }],
    },
    head: {
      left: [{ x: 0, y: 0.15, z: -0.35 }, { x: -0.45, y: -0.05, z: -0.2 }],
      right: [{ x: 0, y: 0.15, z: -0.35 }, { x: 0.45, y: -0.05, z: -0.2 }],
    },
  };
  const preset = pose[challengeParam] ?? pose.belly;
  for (const [key, target] of [
    ['left', preset.left],
    ['right', preset.right],
  ]) {
    arms[key].target = target[0];
    arms[key].elbow = target[1];
    arms[key].targetMix = 1;
  }
  arms.left.fore = arms.left.upper > 0 ? 120 : -120;
  arms.right.fore = arms.right.upper > 0 ? 120 : -120;
}

const state = {
  expr: { mouthOpen: 0.16, smile: 0.24, squint: 0, brow: 0.15 },
  arms,
  legs: { left: { hip: 8, knee: 5 }, right: { hip: -8, knee: 5 } },
  torsoLean: 0,
  headTilt: 0,
  rig,
  offsetX: 0,
  offsetY: 0,
  laugh: 0,
  active: Boolean(challengeParam),
  challengeId: challengeParam || 'idle',
};

const facePresets = {
  'face-think': {
    expr: { mouthOpen: 0.02, smile: 0.08, squint: 0, brow: 0.1 },
    laugh: 0,
  },
  'face-grin': {
    expr: { mouthOpen: 0.45, smile: 0.78, squint: 0.34, brow: 0.35 },
    laugh: 0.25,
  },
  'face-laugh': {
    expr: { mouthOpen: 0.98, smile: 1, squint: 1, brow: 0.9 },
    laugh: 1,
  },
  'face-laugh-soft': {
    expr: { mouthOpen: 0.78, smile: 0.95, squint: 0.9, brow: 0.7 },
    laugh: 0.72,
  },
};
if (facePresets[mode]) {
  state.expr = facePresets[mode].expr;
  state.laugh = facePresets[mode].laugh;
}

const views = {
  face: [
    { x: 1.05, y: 1.82, z: 2.55 },
    { x: 0, y: 1.72, z: 0.08 },
  ],
  'face-front': [
    { x: 0.22, y: 1.8, z: 2.8 },
    { x: 0, y: 1.72, z: 0.08 },
  ],
  'face-side': [
    { x: 2.3, y: 1.8, z: 1.45 },
    { x: 0, y: 1.72, z: 0.08 },
  ],
  game: [
    { x: 2.35, y: 1.35, z: 4.85 },
    { x: 0.02, y: 1.15, z: 0 },
  ],
};

const avatar = createNailong3D(canvas);
if (views[view]) avatar.setView(views[view][0], views[view][1]);
window.__avatar = avatar;
// __previewState：把当前这页自己用的 state 暴露出去，方便逐字段做对比。
window.__previewState = state;
const startedAt = performance.now();
let frames = 0;

function tick(now) {
  // __stateOverride：把真实游戏里的一帧状态原样灌进来复现问题。
  const override = window.__stateOverride;
  avatar.render(override ?? state, override ? 1.2 : (now - startedAt) / 1000, 1 / 60);
  frames += 1;
  if (frames === 3) document.body.dataset.ready = 'true';
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
