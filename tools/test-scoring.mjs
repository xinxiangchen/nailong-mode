import assert from 'node:assert/strict';
import { CHALLENGES, getChallenge } from '../js/challenges.js';
import { scoreMetrics, gradeFor } from '../js/scoring.js';

function makeMetrics(challenge, overrides = {}) {
  const base = {
    hasFace: true,
    hasPose: true,
    availability: {
      face: true,
      armL: true,
      armR: true,
      torso: true,
      legL: true,
      legR: true,
    },
    expr: {
      ...challenge.target.expr,
      headTilt: challenge.target.headTilt,
    },
    poseValues: {
      ...challenge.target.pose,
      legL: 8,
      kneeL: 5,
      legR: -8,
      kneeR: 5,
    },
  };
  return {
    ...base,
    ...overrides,
    expr: { ...base.expr, ...(overrides.expr ?? {}) },
    poseValues: { ...base.poseValues, ...(overrides.poseValues ?? {}) },
    availability: { ...base.availability, ...(overrides.availability ?? {}) },
  };
}

for (const challenge of CHALLENGES) {
  const perfect = scoreMetrics(makeMetrics(challenge), challenge);
  assert.ok(
    perfect.score > 99,
    `${challenge.id} perfect score should be ~100, got ${perfect.score}`
  );
  assert.ok(perfect.exprScore > 99);
  assert.ok(perfect.poseScore > 99);
  // 手部不再参与评分。
  assert.equal(perfect.handScore, undefined);
  assert.equal(perfect.perfectEligible, true);
  console.log(challenge.id, 'perfect:', perfect.score.toFixed(1));
}

const belly = getChallenge('belly');
const thinking = getChallenge('thinking');

// 手部完全不参与评分：看不到手也满分，不影响完美模仿。
const noHands = scoreMetrics(
  makeMetrics(belly, {
    hands: null,
    availability: { hands: false, handLeft: false, handRight: false },
  }),
  belly
);
assert.ok(noHands.score > 99, `no-hands score should be ~100, got ${noHands.score}`);
assert.equal(noHands.perfectEligible, true);
console.log('belly no-hands:', noHands.score.toFixed(1));

// 看不到上半身 -> 表情和歪头还在，最多 85 分
const noPose = scoreMetrics(
  makeMetrics(belly, {
    hasPose: false,
    availability: { armL: false, armR: false, torso: false },
  }),
  belly
);
assert.equal(noPose.poseScore, null);
assert.equal(noPose.score, 85);
assert.equal(noPose.perfectEligible, false);
console.log('belly no-pose:', noPose.score.toFixed(1));

// 思考挑战不要求躯干始终可见：脸还在就能继续
const thinkingNoPose = scoreMetrics(
  makeMetrics(thinking, {
    hasPose: false,
    availability: { armL: false, armR: false, torso: false },
  }),
  thinking
);
assert.equal(thinkingNoPose.poseScore, null);
assert.ok(thinkingNoPose.score > 99);
assert.equal(thinkingNoPose.perfectEligible, true);
console.log('thinking no-pose:', thinkingNoPose.score.toFixed(1));

// 完全不像 -> 低分
const neutral = scoreMetrics(
  makeMetrics(belly, {
    expr: { mouthOpen: 0.05, smile: 0, squint: 0, brow: 0, headTilt: 20 },
    poseValues: { armL: 0, foreL: 0, armR: 0, foreR: 0, torsoLean: 20 },
  }),
  belly
);
assert.ok(neutral.score < 40, `neutral score should be low, got ${neutral.score}`);
console.log('neutral:', neutral.score.toFixed(1));

assert.equal(gradeFor(95).grade, 'S');
assert.equal(gradeFor(85).grade, 'A');
assert.equal(gradeFor(75).grade, 'B');
assert.equal(gradeFor(60).grade, 'C');
assert.equal(gradeFor(30).grade, 'D');
assert.equal(gradeFor(null).grade, '—');

console.log('all scoring tests passed');

// Natural laughing signals must not require maximum blendshapes or raised brows.
for (const id of ['belly','head']) {
  const c = getChallenge(id);
  const natural = scoreMetrics(makeMetrics(c,{expr:{mouthOpen:0.55,smile:0.5,squint:0.38,brow:0}}),c);
  const stronger = scoreMetrics(makeMetrics(c,{expr:{mouthOpen:1,smile:1,squint:1,brow:0}}),c);
  assert.ok(natural.exprScore > 99);
  assert.ok(stronger.exprScore >= natural.exprScore);
  for (const expr of [
    {mouthOpen:0.9,smile:0.05,squint:0.05,brow:0}, // yawning
    {mouthOpen:0.05,smile:0.05,squint:0.9,brow:0}, // just closing eyes
    {mouthOpen:0.05,smile:0.8,squint:0.4,brow:0}, // closed-mouth smile
  ]) {
    assert.ok(scoreMetrics(makeMetrics(c,{expr}),c).score < 85);
  }
  const missingArm = scoreMetrics(makeMetrics(c,{availability:{armL:false}}),c);
  assert.ok(missingArm.score <= 85);
  assert.equal(missingArm.perfectEligible,false);
}
// Both low and high belly holds are valid; dropped arms and outward forearms are not.
for (const fore of [35,55,70,90,105]) {
  const r = scoreMetrics(makeMetrics(belly,{poseValues:{armL:-25,armR:25,foreL:fore,foreR:-fore}}),belly);
  assert.ok(r.poseScore > 99);
}
for (const [l,r] of [[0,0],[-70,70],[170,-170]]) {
  const result=scoreMetrics(makeMetrics(belly,{poseValues:{armL:0,armR:0,foreL:l,foreR:r}}),belly);
  assert.ok(result.poseScore < 50);
  assert.ok(result.score < 90);
}
const thinkingLaugh=scoreMetrics(makeMetrics(thinking,{expr:{mouthOpen:0.6,smile:0.7,squint:0.5}}),thinking);
assert.ok(thinkingLaugh.exprScore<50,'thinking still requires a closed mouth');
console.log('natural/strong laugh, non-laugh negatives, belly holds and missing arms passed');

const weakEyes=scoreMetrics(makeMetrics(belly,{expr:{squint:0}}),belly);
assert.ok(weakEyes.feedback.some(text=>text.includes('眼角')));
assert.ok(!weakEyes.feedback.some(text=>text.includes('思考')));
