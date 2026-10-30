import assert from 'node:assert/strict';
import { extractMetrics, wristDeltas, Smoother } from '../js/metrics.js';

function makeFace({ leftEyeY = 0.4, rightEyeY = 0.4 } = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  // 33 = 用户右眼外角，263 = 用户左眼外角
  landmarks[33] = { x: 0.4, y: rightEyeY, z: 0, visibility: 0 };
  landmarks[263] = { x: 0.6, y: leftEyeY, z: 0, visibility: 0 };
  // 手部锚点：额头、下巴、左右脸颊
  landmarks[10] = { x: 0.5, y: 0.2, z: 0, visibility: 0 };
  landmarks[152] = { x: 0.5, y: 0.6, z: 0, visibility: 0 };
  landmarks[234] = { x: 0.7, y: 0.5, z: 0, visibility: 0 };
  landmarks[454] = { x: 0.3, y: 0.5, z: 0, visibility: 0 };
  return { faceLandmarks: [landmarks], faceBlendshapes: [], facialTransformationMatrixes: [] };
}

function makePose({ shoulderTilt = 0 } = {}) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  // 用户左臂：raw 画面右侧，向上举；镜像后应变成屏幕左侧
  landmarks[11] = { x: 0.6, y: 0.5, z: 0, visibility: 1 };
  landmarks[13] = { x: 0.7, y: 0.4, z: 0, visibility: 1 };
  landmarks[15] = { x: 0.8, y: 0.3, z: 0, visibility: 1 };
  // 用户右臂：raw 画面左侧，向上举；镜像后应变成屏幕右侧
  landmarks[12] = { x: 0.4, y: 0.5 + shoulderTilt, z: 0, visibility: 1 };
  landmarks[14] = { x: 0.3, y: 0.4 + shoulderTilt, z: 0, visibility: 1 };
  landmarks[16] = { x: 0.2, y: 0.3 + shoulderTilt, z: 0, visibility: 1 };
  return { landmarks: [landmarks], worldLandmarks: [] };
}

const result = extractMetrics(makeFace(), makePose(), null, 4 / 3);
assert.equal(result.hasFace, true);
assert.equal(result.hasPose, true);
assert.equal(result.availability.armL, true);
assert.equal(result.availability.armR, true);

// 镜像后：用户左臂在屏幕左侧，角度应为负；右臂在屏幕右侧，角度应为正。
assert.ok(result.poseValues.armL < -90, `armL should point screen-left, got ${result.poseValues.armL}`);
assert.ok(result.poseValues.armR > 90, `armR should point screen-right, got ${result.poseValues.armR}`);
console.log('arm angles:', result.poseValues.armL.toFixed(1), result.poseValues.armR.toFixed(1));

// 水平眼线 / 肩线 -> 0 度
assert.ok(Math.abs(result.expr.headTilt) < 0.5, `level eyes should be ~0, got ${result.expr.headTilt}`);
assert.ok(Math.abs(result.poseValues.torsoLean) < 0.5, `level shoulders should be ~0, got ${result.poseValues.torsoLean}`);

// 屏幕左侧眼睛更低 -> 头部逆时针倾斜（负角度）
const tilted = extractMetrics(makeFace({ leftEyeY: 0.45 }), makePose(), null, 4 / 3);
assert.ok(tilted.expr.headTilt < -5, `tilted head should be negative, got ${tilted.expr.headTilt}`);
console.log('head tilt:', tilted.expr.headTilt.toFixed(1));

// 肩线：屏幕左侧更高、右侧更低 -> 顺时针倾斜（正角度）
const lean = extractMetrics(makeFace(), makePose({ shoulderTilt: 0.02 }), null, 4 / 3);
assert.ok(lean.poseValues.torsoLean > 2, `leaning shoulders should be positive, got ${lean.poseValues.torsoLean}`);
console.log('torso lean:', lean.poseValues.torsoLean.toFixed(1));

// 手出画 -> 手臂不可用，但肩膀仍可用
const armOut = makePose();
armOut.landmarks[0][13].y = 1.4;
armOut.landmarks[0][15].y = 1.6;
armOut.landmarks[0][13].visibility = 0.1;
armOut.landmarks[0][15].visibility = 0.1;
const outResult = extractMetrics(makeFace(), armOut, null, 4 / 3);
assert.equal(outResult.availability.armL, false);
assert.equal(outResult.availability.armR, true);
assert.equal(outResult.hasPose, true);

// ---- 几何兜底：眼睛开合按 aspect 校正，咧嘴不受张嘴影响 ----
function makeExpressionFace({ eyeGap = 0.02, jawGap = 0.02, cornerLift = 0 } = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0,
  }));
  const eyeY = 0.4;
  landmarks[33] = { x: 0.35, y: eyeY, z: 0, visibility: 0 };
  landmarks[263] = { x: 0.65, y: eyeY, z: 0, visibility: 0 };
  landmarks[133] = { x: 0.45, y: eyeY, z: 0, visibility: 0 };
  landmarks[362] = { x: 0.55, y: eyeY, z: 0, visibility: 0 };
  landmarks[159] = { x: 0.4, y: eyeY - eyeGap / 2, z: 0, visibility: 0 };
  landmarks[145] = { x: 0.4, y: eyeY + eyeGap / 2, z: 0, visibility: 0 };
  landmarks[386] = { x: 0.6, y: eyeY - eyeGap / 2, z: 0, visibility: 0 };
  landmarks[374] = { x: 0.6, y: eyeY + eyeGap / 2, z: 0, visibility: 0 };
  const upperLipY = 0.6;
  landmarks[13] = { x: 0.5, y: upperLipY, z: 0, visibility: 0 };
  landmarks[14] = { x: 0.5, y: upperLipY + jawGap, z: 0, visibility: 0 };
  landmarks[61] = { x: 0.45, y: upperLipY - cornerLift, z: 0, visibility: 0 };
  landmarks[291] = { x: 0.55, y: upperLipY - cornerLift, z: 0, visibility: 0 };
  return { faceLandmarks: [landmarks], faceBlendshapes: [], facialTransformationMatrixes: [] };
}

const squintFace = extractMetrics(makeExpressionFace({ eyeGap: 0.02 }), null, null, 16 / 9);
assert.ok(
  squintFace.face.blendGeometry.squint > 0.6,
  `16:9 eye squint should be corrected, got ${squintFace.face.blendGeometry.squint}`
);
console.log('aspect-corrected squint:', squintFace.face.blendGeometry.squint.toFixed(2));

const closedJaw = extractMetrics(makeExpressionFace({ jawGap: 0.02 }), null, null, 16 / 9);
const openJaw = extractMetrics(makeExpressionFace({ jawGap: 0.08 }), null, null, 16 / 9);
assert.ok(
  Math.abs(openJaw.face.blendGeometry.smile - closedJaw.face.blendGeometry.smile) < 0.05,
  'jaw opening must not be counted as smiling'
);
const liftedCorners = extractMetrics(
  makeExpressionFace({ jawGap: 0.08, cornerLift: 0.03 }),
  null,
  null,
  16 / 9
);
assert.ok(
  liftedCorners.face.blendGeometry.smile > 0.1,
  `lifted mouth corners should read as a smile, got ${liftedCorners.face.blendGeometry.smile}`
);
console.log('jaw-independent smile:', liftedCorners.face.blendGeometry.smile.toFixed(2));

// ---- 手部 21 点：侧面分配、下巴距离、开合度 ----
function makeHandLandmarks({ mirrorX = 0.45, wristY = 0.58, open = true } = {}) {
  const raw = (x, y) => ({ x: 1 - x, y, z: 0, visibility: 1 });
  const landmarks = Array.from({ length: 21 }, () => raw(mirrorX, wristY));
  const fingers = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, x: mirrorX - 0.03 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, x: mirrorX - 0.01 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, x: mirrorX + 0.01 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, x: mirrorX + 0.03 },
  ];
  for (const finger of fingers) {
    landmarks[finger.mcp] = raw(finger.x, wristY - 0.03);
    landmarks[finger.pip] = raw(finger.x, wristY - 0.06);
    landmarks[finger.dip] = raw(finger.x, wristY - 0.09);
    landmarks[finger.tip] = raw(finger.x, wristY - (open ? 0.11 : 0.04));
  }
  landmarks[0] = raw(mirrorX, wristY);
  landmarks[1] = raw(mirrorX - 0.04, wristY - 0.01);
  landmarks[2] = raw(mirrorX - 0.05, wristY - 0.02);
  landmarks[3] = raw(mirrorX - 0.06, wristY - 0.03);
  landmarks[4] = raw(mirrorX - 0.07, wristY - (open ? 0.05 : 0.03));
  return { landmarks: [landmarks], worldLandmarks: [], handedness: [] };
}

const openHand = extractMetrics(
  makeFace(),
  makePose(),
  makeHandLandmarks({ open: true }),
  16 / 9
);
assert.equal(openHand.hands.screenLeft?.present, true);
assert.ok(openHand.hands.screenLeft.openness > 0.7, 'open hand should have high openness');
assert.ok(
  openHand.hands.screenLeft.distChin < 0.5,
  'hand near the chin should have a small normalized distance'
);
assert.equal(openHand.hands.bestChin, openHand.hands.screenLeft);
console.log('open hand:', openHand.hands.screenLeft.openness.toFixed(2), openHand.hands.screenLeft.distChin.toFixed(2));

const fistHand = extractMetrics(
  makeFace(),
  makePose(),
  makeHandLandmarks({ open: false }),
  16 / 9
);
assert.ok(fistHand.hands.screenLeft.openness < 0.2, 'fist should have low openness');
console.log('fist hand:', fistHand.hands.screenLeft.openness.toFixed(2));

const leftHand = makeHandLandmarks({ mirrorX: 0.35 }).landmarks[0];
const rightHand = makeHandLandmarks({ mirrorX: 0.65 }).landmarks[0];
const bothHands = extractMetrics(
  makeFace(),
  makePose(),
  { landmarks: [leftHand, rightHand], worldLandmarks: [], handedness: [] },
  16 / 9
);
assert.equal(bothHands.hands.screenLeft?.present, true);
assert.equal(bothHands.hands.screenRight?.present, true);
assert.ok(bothHands.hands.screenLeft.center.x < bothHands.hands.screenRight.center.x);

const fallback = extractMetrics(
  makeFace(),
  makePose(),
  { landmarks: [], worldLandmarks: [], handedness: [] },
  16 / 9
);
assert.equal(fallback.hands.screenLeft?.fromPose, true);
assert.equal(fallback.hands.screenLeft?.openness, null);

// ---- 头部矩阵：yaw 向右为正，pitch 抬头为正 ----
function makeMatrixFace(yawDeg, pitchDeg) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const f = [
    -Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
  const down = [0, -1, 0];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalize = (v) => {
    const length = Math.hypot(...v);
    return v.map((value) => value / length);
  };
  const r = normalize(cross(down, f));
  const u = normalize(cross(f, r));
  const data = [
    ...r, 0,
    ...u, 0,
    ...f, 0,
    0, 0, 0, 1,
  ];
  const face = makeFace();
  face.facialTransformationMatrixes = [
    { rows: 4, columns: 4, data: Float32Array.from(data) },
  ];
  return face;
}

const matrixPose = extractMetrics(makeMatrixFace(25, 15), makePose(), null, 4 / 3);
assert.equal(matrixPose.face.headSource, 'matrix');
assert.equal(matrixPose.face.matrixValid, true);
assert.ok(
  Math.abs(matrixPose.expr.headYaw - 25) < 2,
  `matrix yaw should be ~25, got ${matrixPose.expr.headYaw}`
);
assert.ok(
  Math.abs(matrixPose.expr.headPitch - 15) < 2,
  `matrix pitch should be ~15, got ${matrixPose.expr.headPitch}`
);
console.log(
  'head matrix yaw/pitch:',
  matrixPose.expr.headYaw.toFixed(1),
  matrixPose.expr.headPitch.toFixed(1)
);

const geomFace = makeFace();
const geomLandmarks = geomFace.faceLandmarks[0];
geomLandmarks[1] = { x: 0.56, y: 0.45, z: -0.05, visibility: 0 };
geomLandmarks[10] = { x: 0.5, y: 0.25, z: 0.02, visibility: 0 };
geomLandmarks[152] = { x: 0.5, y: 0.61, z: 0, visibility: 0 };
const geomResult = extractMetrics(geomFace, null, null, 1);
assert.ok(
  ['geometry', 'geometry2d'].includes(geomResult.face.headSource),
  `geometry fallback should report its source, got ${geomResult.face.headSource}`
);
assert.ok(
  geomResult.expr.headYaw < -40,
  `raw nose right of center must become screen-left yaw, got ${geomResult.expr.headYaw}`
);
console.log(
  'geometry head fallback:',
  geomResult.face.headSource,
  geomResult.expr.headYaw.toFixed(1)
);

// ---- 扭头方向：几何兜底必须和矩阵、3D 骨骼同号（屏幕右转为正） ----
function makeTurnFace({ yaw = 0, pitch = 0, flat = false } = {}) {
  const face = makeFace();
  const landmarks = face.faceLandmarks[0];
  const radius = 0.06;
  const yawRad = (yaw * Math.PI) / 180;
  const pitchRad = (pitch * Math.PI) / 180;
  if (flat) {
    // 没有 z 时用鼻尖的水平偏移判断。
    landmarks[1] = {
      x: 0.5 - radius * Math.sin(yawRad),
      y: 0.45,
      z: 0,
      visibility: 0,
    };
  } else {
    landmarks[1] = {
      x: 0.5 - radius * Math.sin(yawRad) * Math.cos(pitchRad),
      y: 0.45,
      z: -radius * Math.cos(yawRad) * Math.cos(pitchRad),
      visibility: 0,
    };
    // 抬头时额头远离镜头、下巴靠近镜头；低头相反。
    // 额头到下巴的竖直距离是 0.4，所以单侧 z 偏移取 0.2*tan(pitch)。
    const zOffset = 0.2 * Math.tan(pitchRad);
    landmarks[10] = {
      x: 0.5,
      y: 0.2,
      z: zOffset,
      visibility: 0,
    };
    landmarks[152] = {
      x: 0.5,
      y: 0.6,
      z: -zOffset,
      visibility: 0,
    };
  }
  return extractMetrics(face, null, null, 1);
}

for (const yaw of [-35, 35]) {
  const turned = makeTurnFace({ yaw });
  assert.equal(turned.face.headSource, 'geometry');
  assert.ok(
    Math.abs(turned.expr.headYaw - yaw) < 1,
    `3D geometry yaw ${yaw} should stay on the same side, got ${turned.expr.headYaw}`
  );
}
for (const yaw of [-35, 35]) {
  const turned = makeTurnFace({ yaw, flat: true });
  assert.equal(turned.face.headSource, 'geometry2d');
  // 没有 z 时只能判断方向，幅度会被眼睛间距压小；不能要求还原 35°。
  assert.ok(
    Math.abs(turned.expr.headYaw) > 8 &&
      Math.sign(turned.expr.headYaw) === Math.sign(yaw),
    `2D geometry yaw ${yaw} should keep its direction, got ${turned.expr.headYaw}`
  );
}
for (const pitch of [-12, 12]) {
  const tilted = makeTurnFace({ pitch });
  assert.equal(tilted.face.headSource, 'geometry');
  assert.ok(
    Math.abs(tilted.expr.headPitch - pitch) < 1,
    `geometry pitch ${pitch} should keep its sign, got ${tilted.expr.headPitch}`
  );
}
console.log(
  'geometry head directions:',
  makeTurnFace({ yaw: 35 }).expr.headYaw.toFixed(1),
  makeTurnFace({ yaw: -35 }).expr.headYaw.toFixed(1),
  makeTurnFace({ pitch: 12 }).expr.headPitch.toFixed(1),
  makeTurnFace({ pitch: -12 }).expr.headPitch.toFixed(1)
);

// ---- 手臂前后：pose z 小 = 靠近镜头，正值 = 向前伸 ----
const depthPose = makePose();
const depthLandmarks = depthPose.landmarks[0];
// 屏幕左侧手臂向前伸，屏幕右侧手臂向后摆。
depthLandmarks[11].z = 0;
depthLandmarks[13].z = -0.04;
depthLandmarks[15].z = -0.08;
depthLandmarks[12].z = 0;
depthLandmarks[14].z = 0.04;
depthLandmarks[16].z = 0.08;
const depthResult = extractMetrics(makeFace(), depthPose, null, 1);
assert.ok(
  depthResult.poseValues.armLForward > 10,
  `forward arm should get positive depth, got ${depthResult.poseValues.armLForward}`
);
assert.ok(
  depthResult.poseValues.foreLForward > 10,
  `forward forearm should get positive depth, got ${depthResult.poseValues.foreLForward}`
);
assert.ok(
  depthResult.poseValues.armRForward < -10,
  `backward arm should get negative depth, got ${depthResult.poseValues.armRForward}`
);
assert.ok(
  depthResult.poseValues.foreRForward < -10,
  `backward forearm should get negative depth, got ${depthResult.poseValues.foreRForward}`
);
console.log(
  'arm depth L/R:',
  depthResult.poseValues.armLForward.toFixed(1),
  depthResult.poseValues.armRForward.toFixed(1)
);

// ---- 单目 3D 重定向：worldLandmarks 转成躯干局部坐标 ----
function makeWorldPose({ leftForward = 0, rightForward = 0 } = {}) {
  const world = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0,
  }));
  const set = (index, x, y, z) => {
    world[index] = { x, y, z, visibility: 1 };
  };
  // 用户左肩在 raw 画面右侧，镜像后落在屏幕左侧。
  // MediaPipe 的 world 坐标 y 轴向下为正：肩膀在上（0），髋在下（+0.55）。
  // 早先这里写成了 y 向上，躯干上轴因此反号，前伸的手臂被算到身后。
  set(11, 0.18, 0, 0);
  set(12, -0.18, 0, 0);
  set(23, 0.1, 0.55, 0);
  set(24, -0.1, 0.55, 0);
  set(13, 0.18, 0.3, -0.3 * leftForward);
  set(15, 0.18, 0.6, -0.6 * leftForward);
  set(14, -0.18, 0.3, 0.3 * rightForward);
  set(16, -0.18, 0.6, 0.6 * rightForward);
  return world;
}

function turnWorld(world, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return world.map((point) => ({
    ...point,
    x: point.x * cos + point.z * sin,
    z: -point.x * sin + point.z * cos,
  }));
}

const worldPose = makePose();
worldPose.worldLandmarks = [makeWorldPose()];
const worldResult = extractMetrics(makeFace(), worldPose, null, 1);
assert.ok(
  worldResult.poseValues.armLTarget,
  'world landmarks should produce a 3D arm target'
);
assert.ok(
  Math.abs(worldResult.poseValues.armLTarget.x) < 0.02,
  `arm hanging down should stay on its shoulder line, got ${worldResult.poseValues.armLTarget.x}`
);
assert.ok(
  worldResult.poseValues.armLTarget.y < -0.9,
  `arm hanging down should point down in torso space, got ${worldResult.poseValues.armLTarget.y}`
);
assert.ok(
  Math.abs(worldResult.poseValues.armLTarget.z) < 0.02,
  `arm hanging down should have no depth, got ${worldResult.poseValues.armLTarget.z}`
);

const worldForwardPose = makePose();
worldForwardPose.worldLandmarks = [
  makeWorldPose({ leftForward: 1, rightForward: 1 }),
];
const worldForward = extractMetrics(makeFace(), worldForwardPose, null, 1);
assert.ok(
  worldForward.poseValues.armLTarget.z > 0.6,
  `left arm reaching at camera should get +z, got ${worldForward.poseValues.armLTarget.z}`
);
assert.ok(
  worldForward.poseValues.armRTarget.z < -0.6,
  `right arm reaching away should get -z, got ${worldForward.poseValues.armRTarget.z}`
);
assert.ok(
  worldForward.poseValues.armLTarget.y < -0.6,
  'the 3D target must keep the hand below the shoulder'
);
console.log(
  '3D retarget L/R z:',
  worldForward.poseValues.armLTarget.z.toFixed(2),
  worldForward.poseValues.armRTarget.z.toFixed(2)
);

// 玩家整体转身 50° 后，世界坐标全变了，但躯干局部目标必须几乎不变。
const turnedWorldPose = makePose();
turnedWorldPose.worldLandmarks = [
  turnWorld(makeWorldPose({ leftForward: 1, rightForward: 1 }), 50),
];
const turnedWorld = extractMetrics(makeFace(), turnedWorldPose, null, 1);
for (const [field, reference] of [
  ['armLTarget', worldForward.poseValues.armLTarget],
  ['armRTarget', worldForward.poseValues.armRTarget],
]) {
  const actual = turnedWorld.poseValues[field];
  assert.ok(
    Math.abs(actual.x - reference.x) < 1e-6 &&
      Math.abs(actual.y - reference.y) < 1e-6 &&
      Math.abs(actual.z - reference.z) < 1e-6,
    `${field} should be expressed in the player's torso frame, got ${JSON.stringify(actual)} vs ${JSON.stringify(reference)}`
  );
}
console.log('3D retarget is torso-relative under a 50° turn');

// ---- 躯干 yaw / pitch：肩线前后错位 -> 转身；肩髋 z 差 -> 前倾 ----
const yawPose = makePose();
yawPose.landmarks[0][11].z = -0.05;
yawPose.landmarks[0][12].z = 0.05;
const bodyYawResult = extractMetrics(makeFace(), yawPose, null, 1);
assert.ok(
  Math.abs(bodyYawResult.poseValues.bodyYaw - 26.6) < 2,
  `body yaw should be ~26.6, got ${bodyYawResult.poseValues.bodyYaw}`
);
assert.equal(bodyYawResult.bodyYawSource, 'shoulder');
assert.equal(bodyYawResult.availability.bodyYaw, true);
console.log('body yaw:', bodyYawResult.poseValues.bodyYaw.toFixed(1));

const pitchPose = makePose();
for (const index of [11, 12]) {
  pitchPose.landmarks[0][index].y = 0.4;
  pitchPose.landmarks[0][index].z = -0.06;
  pitchPose.landmarks[0][index].visibility = 1;
}
for (const index of [23, 24]) {
  pitchPose.landmarks[0][index] = {
    x: index === 23 ? 0.6 : 0.4,
    y: 0.75,
    z: 0,
    visibility: 1,
  };
}
const bodyPitchResult = extractMetrics(makeFace(), pitchPose, null, 16 / 9);
assert.equal(bodyPitchResult.bodyPitchValid, true);
assert.ok(
  Math.abs(bodyPitchResult.poseValues.bodyPitch - 17) < 3,
  `body pitch should be ~17, got ${bodyPitchResult.poseValues.bodyPitch}`
);
console.log('body pitch:', bodyPitchResult.poseValues.bodyPitch.toFixed(1));

// ---- 手腕：用合成手掌 / 前臂验证 flex / twist 符号和来源 ----
function makeWristScene({ flexDeg = 0, twistDeg = 0, devDeg = 0 } = {}) {
  const aspect = 1;
  const raw = (x, y, z = 0) => ({ x: 1 - x, y, z, visibility: 1 });
  const wrist = { x: 0.45, y: 0.55, z: 0.004 };
  const flex = (flexDeg * Math.PI) / 180;
  const twist = (twistDeg * Math.PI) / 180;
  const dev = (devDeg * Math.PI) / 180;
  // 纯侧偏：手掌在屏幕平面内绕掌面法线旋转，index→pinky 跟着一起转。
  const h = devDeg
    ? [Math.sin(dev), -Math.cos(dev), 0]
    : [0, -Math.cos(flex), Math.sin(flex)];
  // 左手的 index→pinky 在屏幕上是 +x，绕前臂转 twist 后进入 +z。
  const l = devDeg
    ? [Math.cos(dev), Math.sin(dev), 0]
    : [Math.cos(twist), 0, Math.sin(twist)];
  const pointAt = (alongH, alongL) => ({
    x: wrist.x + h[0] * alongH + l[0] * alongL,
    y: wrist.y + h[1] * alongH + l[1] * alongL,
    z: wrist.z + h[2] * alongH + l[2] * alongL,
  });
  const screen = [wrist, pointAt(0.03, 0), pointAt(0.04, 0)];
  const p0 = pointAt(0, 0);
  const p5 = pointAt(0.08, 0.08);
  const p9 = pointAt(0.11, 0);
  const p17 = pointAt(0.08, -0.08);
  const landmarks = Array.from({ length: 21 }, () => raw(0.45, 0.55, 0.004));
  landmarks[0] = raw(p0.x, p0.y, p0.z);
  landmarks[5] = raw(p5.x, p5.y, p5.z);
  landmarks[9] = raw(p9.x, p9.y, p9.z);
  landmarks[17] = raw(p17.x, p17.y, p17.z);
  void screen;

  const pose = makePose();
  // 前臂从下方指向手腕（屏幕上向上），这样中性腕角为 0。
  pose.landmarks[0][13] = { x: 1 - 0.45, y: 0.65, z: 0, visibility: 1 };
  pose.landmarks[0][15] = { x: 1 - 0.45, y: 0.55, z: 0, visibility: 1 };
  return extractMetrics(
    makeFace(),
    pose,
    { landmarks: [landmarks], worldLandmarks: [], handedness: [] },
    aspect
  );
}

const neutralWrist = makeWristScene();
assert.equal(neutralWrist.hands.screenLeft?.wrist?.source, 'pose+hand');
assert.ok(
  Math.abs(neutralWrist.hands.screenLeft?.wrist?.flex ?? 99) < 2,
  'neutral wrist flex should be ~0'
);
assert.ok(
  Math.abs(neutralWrist.hands.screenLeft?.wrist?.twist ?? 99) < 2,
  'neutral wrist twist should be ~0'
);
assert.equal(neutralWrist.availability.wristL, true);

const flexWrist = makeWristScene({ flexDeg: 20 });
assert.ok(
  Math.abs(flexWrist.hands.screenLeft.wrist.flex - 20) < 3,
  `flex wrist should be ~20, got ${flexWrist.hands.screenLeft.wrist.flex}`
);
assert.ok(
  Math.abs(flexWrist.hands.screenLeft.wrist.dev) < 3,
  `pure flex should not add deviation, got ${flexWrist.hands.screenLeft.wrist.dev}`
);
console.log('wrist flex:', flexWrist.hands.screenLeft.wrist.flex.toFixed(1));

const devWrist = makeWristScene({ devDeg: 20 });
assert.ok(
  Math.abs(devWrist.hands.screenLeft.wrist.dev - 20) < 3,
  `dev wrist should be ~20, got ${devWrist.hands.screenLeft.wrist.dev}`
);
assert.ok(
  Math.abs(devWrist.hands.screenLeft.wrist.flex) < 3,
  `pure deviation should not add flex, got ${devWrist.hands.screenLeft.wrist.flex}`
);
console.log('wrist dev:', devWrist.hands.screenLeft.wrist.dev.toFixed(1));

const twistWrist = makeWristScene({ twistDeg: 20 });
assert.ok(
  Math.abs(twistWrist.hands.screenLeft.wrist.twist - 20) < 3,
  `twist wrist should be ~20, got ${twistWrist.hands.screenLeft.wrist.twist}`
);
console.log('wrist twist:', twistWrist.hands.screenLeft.wrist.twist.toFixed(1));

// ---- 手腕屈伸增量：手已经弯得很厉害时，抬 / 压腕仍然要跟得上 ----
// 托腮 / 捧腹里手相对前臂本来就弯了 60° 以上，绝对 flex 会一直顶在 ±60 的
// 钳位上（下面第一条断言就是这个现象）。游戏里改用「相对参考手型的增量」，
// 所以这里验证从 90° 再抬 / 压 20° 能被量出来。
assert.ok(neutralWrist.hands.screenLeft.wrist.basis, '3D 腕角应带方向基向量');
const bentRef = makeWristScene({ flexDeg: 90 });
const bentUp = makeWristScene({ flexDeg: 110 });
const bentDown = makeWristScene({ flexDeg: 70 });
assert.equal(
  Math.round(bentRef.hands.screenLeft.wrist.flex),
  60,
  '手弯过 90° 后绝对 flex 会钳在 60'
);
const deltaUp = wristDeltas(
  bentRef.hands.screenLeft.wrist.basis,
  bentUp.hands.screenLeft.wrist.basis,
  'screenLeft'
);
const deltaDown = wristDeltas(
  bentRef.hands.screenLeft.wrist.basis,
  bentDown.hands.screenLeft.wrist.basis,
  'screenLeft'
);
assert.ok(
  Math.abs(deltaUp.flex - 20) < 2,
  `抬腕增量应约为 +20，实际 ${deltaUp.flex}`
);
assert.ok(
  Math.abs(deltaDown.flex + 20) < 2,
  `压腕增量应约为 -20，实际 ${deltaDown.flex}`
);
assert.ok(Math.abs(deltaUp.dev) < 2, `纯屈伸不应产生侧偏，实际 ${deltaUp.dev}`);
console.log('wrist flex delta:', deltaUp.flex.toFixed(1), deltaDown.flex.toFixed(1));

// 纯侧偏 20° 也要能量出来，而且不能串到屈伸上。
const devRef = makeWristScene();
const devTurned = makeWristScene({ devDeg: 20 });
const devDelta = wristDeltas(
  devRef.hands.screenLeft.wrist.basis,
  devTurned.hands.screenLeft.wrist.basis,
  'screenLeft'
);
assert.ok(
  Math.abs(devDelta.dev - 20) < 2,
  `侧偏增量应约为 +20，实际 ${devDelta.dev}`
);
assert.ok(
  Math.abs(devDelta.flex) < 2,
  `纯侧偏不应产生屈伸增量，实际 ${devDelta.flex}`
);
console.log('wrist dev delta:', devDelta.dev.toFixed(1));

// 整条手臂一起转、手腕本身没动时，增量应该是 0（参考手方向要跟着前臂转）。
const armTurnedBasis = (() => {
  const basis = makeWristScene({ flexDeg: 90 }).hands.screenLeft.wrist.basis;
  const angle = (25 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotX = (v) => ({
    x: v.x,
    y: v.y * cos - v.z * sin,
    z: v.y * sin + v.z * cos,
  });
  return { h: rotX(basis.h), l: rotX(basis.l), fore: rotX(basis.fore) };
})();
const armOnlyDelta = wristDeltas(
  bentRef.hands.screenLeft.wrist.basis,
  armTurnedBasis,
  'screenLeft'
);
assert.ok(
  Math.abs(armOnlyDelta.flex) < 2,
  `纯手臂转动不应产生屈伸增量，实际 ${armOnlyDelta.flex}`
);
assert.ok(
  Math.abs(armOnlyDelta.dev) < 2,
  `纯手臂转动不应产生侧偏增量，实际 ${armOnlyDelta.dev}`
);
console.log('wrist delta under arm turn:', armOnlyDelta.flex.toFixed(1));

console.log('all metrics tests passed');

// Crossing the midline must preserve pose-arm identity and finger openness.
const crossedPose = makePose();
crossedPose.landmarks[0][15] = { x: 0.25, y: 0.58, z: 0, visibility: 1 };
crossedPose.landmarks[0][16] = { x: 0.75, y: 0.58, z: 0, visibility: 1 };
const crossedOpen = makeHandLandmarks({ mirrorX: 0.75, open: true }).landmarks[0];
const crossedFist = makeHandLandmarks({ mirrorX: 0.25, open: false }).landmarks[0];
for (const hands of [[crossedOpen, crossedFist], [crossedFist, crossedOpen]]) {
  const crossed = extractMetrics(makeFace(), crossedPose, { landmarks: hands }, 16 / 9);
  assert.ok(crossed.hands.screenLeft.openness > 0.7);
  assert.ok(crossed.hands.screenRight.openness < 0.2);
}
const singleCrossed = extractMetrics(makeFace(), crossedPose, { landmarks: [crossedOpen] }, 1);
assert.ok(singleCrossed.hands.screenLeft.openness > 0.7);
assert.equal(singleCrossed.hands.screenRight.fromPose, true);
const occludedWorld = makePose();
occludedWorld.worldLandmarks = [makeWorldPose()];
occludedWorld.worldLandmarks[0][15].visibility = 0.1;
const occluded = extractMetrics(makeFace(), occludedWorld, null, 1);
assert.equal(occluded.poseValues.armLTarget, null);
assert.equal(occluded.availability.armL, true, '2D fallback remains available');
assert.ok(occluded.poseValues.armRTarget, 'other arm remains tracked');
const badWorld = makePose();
badWorld.worldLandmarks = [makeWorldPose()];
badWorld.worldLandmarks[0][15].x = 4;
assert.equal(extractMetrics(makeFace(), badWorld, null, 1).poseValues.armLTarget, null);
const adaptive = new Smoother(0.16);
adaptive.updateMotionAngle('arm', 0, 1 / 30);
assert.ok(adaptive.updateMotionAngle('arm', 90, 1 / 30) > 35, 'fast motion catches up');
const held = adaptive.get('arm');
assert.equal(adaptive.updateMotionAngle('arm', NaN, 1 / 30), held);
adaptive.reset();
adaptive.updateMotionAngle('arm', 0, 1 / 30);
assert.ok(adaptive.updateMotionAngle('arm', 1, 1 / 30) < 0.3, 'small jitter stays filtered');
adaptive.reset();
adaptive.updateMotionAngle('arm', 179, 1 / 30);
assert.ok(Math.abs(adaptive.updateMotionAngle('arm', -179, 1 / 30)) > 178, 'wraparound stays continuous');
console.log('crossed hands, 3D confidence fallback, adaptive tracking passed');

// Same physical face in wide, square, portrait and far-away frames.
for (const aspect of [1, 16 / 9, 9 / 16]) {
  for (const scale of [1, 0.1]) {
    const f = makeFace();
    const lm = f.faceLandmarks[0];
    lm[1] = {x:0.5,y:0.45,z:-0.06};
    lm[10].z = 0.2 * Math.tan(12 * Math.PI / 180);
    lm[152].z = -lm[10].z;
    for (const p of lm) {
      p.x = 0.5 + (p.x - 0.5) * scale / aspect;
      p.y = 0.5 + (p.y - 0.5) * scale;
      p.z = p.z * scale / aspect;
    }
    const m = extractMetrics(f,null,null,aspect);
    assert.ok(m.availability.headPitch);
    assert.ok(Math.abs(m.expr.headPitch - 12) < 0.1, `pitch must not depend on distance/aspect: ${aspect},${scale}`);
  }
}
console.log('distance/aspect-invariant head pitch passed');
