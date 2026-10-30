/**
 * 三个挑战的评分规则。
 *
 * 每个挑战有三组：表情 / 身体 / 歪头。
 * 组权重来自 challenges.js；检测不到的分组会被剔除并重新分配权重。
 * 手部动作只用来驱动奶龙的手，不参与评分。
 */

import { clamp01, wrapDeg } from './metrics.js';
import { CHALLENGES } from './challenges.js';

export const PERFECT_SCORE = 90;
export const PERFECT_HOLD_SECONDS = 2;
export const ROUND_SECONDS = 30;

const DEAD_ZONE = 0.15;

export function toleranceSim(value, target, tolerance, isAngle = false) {
  const delta = isAngle
    ? Math.abs(wrapDeg(value - target))
    : Math.abs(value - target);
  const plateau = tolerance * DEAD_ZONE;
  if (delta <= plateau) return 1;
  return clamp01(1 - (delta - plateau) / Math.max(1e-6, tolerance - plateau));
}

// Laughing is an action threshold, not a symmetric match to a cartoon maximum.
export function minimumSim(value, minimum, baseline = 0) {
  if (!Number.isFinite(value)) return 0;
  return clamp01((value - baseline) / Math.max(1e-6, minimum - baseline));
}

export function rangeSim(value, [low, high], falloff) {
  if (!Number.isFinite(value)) return 0;
  const distance = value < low ? low - value : value > high ? value - high : 0;
  return clamp01(1 - distance / falloff);
}

function expressionHint(id, target, value, laughing = false) {
  if (laughing) return {
    mouthOpen: '自然张嘴笑起来，不用把嘴撑到最大～',
    smile: '嘴角向两边提起来，放松地笑～',
    squint: '笑的时候眼角轻轻收起来，不必用力闭眼～',
  }[id];
  if (id === 'mouthOpen') {
    return target < 0.2
      ? value > target + 0.08
        ? '嘴闭紧一点，思考时别笑！'
        : '保持住，别张嘴～'
      : value < target
        ? '嘴巴再张大一点，像在喊哈哈哈！'
        : '嘴巴稍微收一点～';
  }
  if (id === 'smile') {
    return target < 0.3
      ? '嘴角收一收，认真思考～'
      : '嘴角咧起来，露出奶龙的招牌坏笑！';
  }
  if (id === 'squint') {
    return target < 0.4
      ? '眼睛睁开，思考的奶龙不眯眼～'
      : '眼睛笑成一条缝，才够疯！';
  }
  return '眉毛再挑高一点！';
}

function armHint(side, target, value, forearm = false) {
  const label = side === 'L' ? '左' : '右';
  if (forearm) {
    return `${label}边的小短手再跟着摆一点～`;
  }
  return value > target
    ? `${label}边手肘再抬高一点～`
    : `${label}边手肘稍微放低一点～`;
}

function buildFeatures(challenge, metrics) {
  const features = [];
  const push = (feature) => features.push(feature);

  // ---------- 表情 ----------
  const laughing = challenge.expressionMode === 'laugh';
  const exprDefs = laughing ? [
    ['mouthOpen', '张嘴', 0.45],
    ['smile', '咧嘴', 0.35],
    ['squint', '笑眼', 0.2],
  ] : [
    ['mouthOpen', '张嘴', 0.4],
    ['smile', '咧嘴', 0.3],
    ['squint', '笑眼', 0.22],
    ['brow', '挑眉', 0.08],
  ];
  for (const [id, label, weight] of exprDefs) {
    const target = laughing ? challenge.exprMinimum[id] : challenge.target.expr[id];
    const tolerance = challenge.exprTolerance[id];
    const available = Boolean(metrics.availability.face);
    const value = metrics.expr[id];
    push({
      id: `expr-${id}`,
      group: 'expr',
      label,
      weight,
      value,
      target,
      available,
      sim: !available ? 0 : laughing
        ? minimumSim(value, target, { mouthOpen: 0.08, smile: 0.12, squint: 0.1 }[id])
        : toleranceSim(value, target, tolerance),
      hint: () => expressionHint(id, target, value, laughing),
    });
  }

  // ---------- 身体 ----------
  const pose = challenge.target.pose;
  if (challenge.poseMode === 'torso') {
    push({
      id: 'pose-torso',
      group: 'pose',
      label: '身体',
      weight: 1,
      value: metrics.poseValues.torsoLean,
      target: pose.torsoLean,
      available: Boolean(metrics.availability.torso),
      sim: metrics.availability.torso
        ? toleranceSim(metrics.poseValues.torsoLean, pose.torsoLean, 22, true)
        : 0,
      hint: () => '站直一点，身体别歪太多～',
    });
  } else {
    // Belly holding is primarily forearms folding inward, not upper arms hanging down.
    const upperWeight = challenge.id === 'belly' ? 0.1 : 0.35;
    const foreWeight = challenge.id === 'belly' ? 0.35 : 0.1;
    const poseDefs = [
      ['armL', '左手', pose.armL, upperWeight, 55, true],
      ['armR', '右手', pose.armR, upperWeight, 55, true],
      ['foreL', '左小臂', pose.foreL, foreWeight, 60, true],
      ['foreR', '右小臂', pose.foreR, foreWeight, 60, true],
      ['torsoLean', '身体', pose.torsoLean, 0.1, 22, false],
    ];
    for (const [id, label, target, weight, tolerance, isArm] of poseDefs) {
      const available = id.startsWith('arm') || id.startsWith('fore')
        ? Boolean(metrics.availability[id.startsWith('arm') ? (id === 'armL' ? 'armL' : 'armR') : (id === 'foreL' ? 'armL' : 'armR')])
        : Boolean(metrics.availability.torso);
      const value = metrics.poseValues[id];
      const range = challenge.poseRanges?.[id];
      const sim = !available ? 0 : range
        ? rangeSim(value, range, id.startsWith('fore') ? 30 : 40)
        : toleranceSim(value, target, tolerance, true);
      push({
        id: `pose-${id}`,
        group: 'pose',
        label,
        weight,
        value,
        target,
        available,
        sim,
        hint: () => {
          if (id === 'torsoLean') return '身体别歪太多，放松一点～';
          if (challenge.id === 'belly') return id.startsWith('fore')
            ? '双手往腹部靠拢，小臂自然斜着放，不用抬到胸口～'
            : '手肘放低、放松，双手捧在肚子前～';
          const side = id.endsWith('L') ? 'L' : 'R';
          return armHint(side, target, value, id.startsWith('fore'));
        },
      });
    }
  }

  // ---------- 歪头 ----------
  const headAvailable = Boolean(metrics.availability.face);
  push({
    id: 'head-tilt',
    group: 'head',
    label: '歪头',
    weight: 1,
    value: metrics.expr.headTilt,
    target: challenge.target.headTilt,
    available: headAvailable,
    sim: headAvailable
      ? toleranceSim(metrics.expr.headTilt, challenge.target.headTilt, 28, true)
      : 0,
    hint: () => {
      const value = metrics.expr.headTilt;
      if (value > challenge.target.headTilt + 6) {
        return '头往另一边歪一点，模仿得更像～';
      }
      if (value < challenge.target.headTilt - 6) {
        return '头歪回来一点，别歪过头～';
      }
      return '头的位置刚好，保持住！';
    },
  });

  return features;
}

function groupScore(features) {
  let weightSum = 0;
  let scoreSum = 0;
  for (const feature of features) {
    if (!feature.available) continue;
    weightSum += feature.weight;
    scoreSum += feature.weight * feature.sim;
  }
  if (weightSum <= 0) return null;
  return (scoreSum / weightSum) * 100;
}

const PRAISES = [
  '就是这个感觉！奶龙都点头了！',
  '有内味了，保持住！',
  '稳了，满分预定！',
  '奶龙认证的模仿，继续！',
];

/**
 * @param {object} metrics extractMetrics 的结果
 * @param {object} challenge challenges.js 里的一个挑战
 */
export function scoreMetrics(metrics, challenge = CHALLENGES[0]) {
  const features = buildFeatures(challenge, metrics);
  const groups = { expr: [], pose: [], head: [] };
  for (const feature of features) groups[feature.group].push(feature);

  const scores = {
    expr: groupScore(groups.expr),
    pose: groupScore(groups.pose),
    head: groupScore(groups.head),
  };

  let weightSum = 0;
  let scoreSum = 0;
  for (const group of ['expr', 'pose', 'head']) {
    if (scores[group] == null) continue;
    const groupWeight = challenge.weights[group] ?? 0;
    weightSum += groupWeight;
    scoreSum += groupWeight * scores[group];
  }

  let score = weightSum > 0 ? scoreSum / weightSum : null;
  const poseComplete = scores.pose != null && (challenge.poseMode !== 'arms' ||
    (metrics.availability.armL && metrics.availability.armR));
  if (score != null && challenge.requirePose && !poseComplete) {
    score = Math.min(score, 85);
  }

  const evaluated = features.filter((feature) => feature.available);
  const feedback = [];
  if (metrics.hasFace) {
    const weak = evaluated
      .filter((feature) => feature.sim < 0.78)
      .sort(
        (a, b) =>
          b.weight *
            (challenge.weights[b.group] ?? 0) *
            (1 - b.sim) -
          a.weight *
            (challenge.weights[a.group] ?? 0) *
            (1 - a.sim)
      )
      .slice(0, 2);
    for (const feature of weak) {
      const message = feature.hint();
      if (message && !feedback.includes(message)) feedback.push(message);
    }
    if (!feedback.length && score != null && score >= 82) {
      feedback.push(PRAISES[Math.floor(performance.now() / 2400) % PRAISES.length]);
    }
    if (challenge.requirePose && !poseComplete) {
      feedback.unshift('请让肩膀、手肘和手腕都入镜，方便判断动作～');
    }
  } else {
    feedback.push('脸不在镜头里，往前一点，计时会暂停～');
  }

  const perfectEligible =
    scores.expr != null && (!challenge.requirePose || poseComplete);

  return {
    score,
    exprScore: scores.expr,
    poseScore: scores.pose,
    headScore: scores.head,
    features: groups,
    feedback,
    hasAny: weightSum > 0,
    perfectEligible,
    challengeId: challenge.id,
  };
}

export function gradeFor(score) {
  if (score == null) {
    return { grade: '—', title: '还没开始', stars: 0, color: 'muted' };
  }
  if (score >= 92) {
    return { grade: 'S', title: '奶龙本龙', stars: 5, color: 'gold' };
  }
  if (score >= 82) {
    return { grade: 'A', title: '模仿学徒', stars: 4, color: 'mint' };
  }
  if (score >= 70) {
    return { grade: 'B', title: '有模有样', stars: 3, color: 'blue' };
  }
  if (score >= 58) {
    return { grade: 'C', title: '形似三分', stars: 2, color: 'orange' };
  }
  return { grade: 'D', title: '还没入戏', stars: 1, color: 'muted' };
}
