/**
 * 三个挑战目标。
 *
 * 目标数值都以「镜像后的屏幕坐标」为准：
 * - 表情来自 FaceLandmarker blendshape（0..1）
 * - 手臂角度：0° = 垂直向下，正数 = 朝屏幕右侧，负数 = 朝屏幕左侧
 * - 手部距离：手中心到「下巴 / 肚子 / 头侧」的距离，除以人脸高度
 *
 * 目标图是用户提供的三张奶龙表情包，放在 assets/targets/。
 */
export const CHALLENGES = [
  {
    id: 'thinking',
    name: '奶龙思考',
    short: '思考',
    image: './assets/targets/thinking.webp',
    sticker: '托腮 · 睁眼 · 别笑',
    note: '把一只手托在下巴上，眼睛睁大，摆出「让我想想」。',
    target: {
      expr: { mouthOpen: 0.06, smile: 0.12, squint: 0.22, brow: 0.28 },
      headTilt: 0,
      pose: { armL: 62, foreL: 143, armR: 15, foreR: 10, torsoLean: 0 },
    },
    poseMode: 'torso',
    exprTolerance: { mouthOpen: 0.25, smile: 0.25, squint: 0.35, brow: 0.5 },
    weights: { expr: 0.55, pose: 0.1, head: 0.05 },
    // 手部配置只用于演示模式的造型，不参与评分。
    hand: {
      mode: 'chin',
      sides: 'best',
      positionTarget: 0.15,
      positionTolerance: 0.4,
      openness: 0.15,
      opennessTolerance: 0.5,
      opennessMode: 'max',
    },
    requirePose: false,
    tips: [
      ['😐', '表情 79%', '嘴闭紧 · 眼睛睁开'],
      ['🧍', '身体 14%', '站直，别乱晃'],
      ['🤲', '手部（不计分）', '动作会带动奶龙的手'],
      ['🙂', '歪头 7%', '头轻轻歪一点'],
    ],
  },
  {
    id: 'belly',
    expressionMode: 'laugh',
    exprMinimum: { mouthOpen: 0.55, smile: 0.5, squint: 0.38 },
    poseRanges: { armL: [-40, 15], armR: [-15, 40], foreL: [35, 105], foreR: [-105, -35] },
    name: '奶龙捧腹',
    short: '捧腹',
    image: './assets/targets/belly.webp',
    sticker: '捧肚 · 张嘴 · 眯眼',
    note: '双手捧住肚子，张大嘴、眯起眼睛，笑到弯下腰。',
    target: {
      expr: { mouthOpen: 0.9, smile: 0.8, squint: 0.8, brow: 0.4 },
      headTilt: -6,
      pose: { armL: -15, foreL: 70, armR: 15, foreR: -70, torsoLean: 0 },
    },
    poseMode: 'arms',
    exprTolerance: { mouthOpen: 0.38, smile: 0.42, squint: 0.48, brow: 0.55 },
    weights: { expr: 0.45, pose: 0.2, head: 0.05 },
    // 手部配置只用于演示模式的造型，不参与评分。
    hand: {
      mode: 'belly',
      sides: 'both',
      positionTarget: 0.18,
      positionTolerance: 0.45,
      openness: 0.55,
      opennessTolerance: 0.55,
      opennessMode: 'min',
    },
    requirePose: true,
    tips: [
      ['😆', '表情 64%', '张大嘴 · 眼睛眯成缝'],
      ['🧎', '身体 29%', '双手放在腹前 · 手肘放松'],
      ['🫱', '手部（不计分）', '动作会带动奶龙的手'],
      ['🤪', '歪头 7%', '头稍微歪一点'],
    ],
  },
  {
    id: 'head',
    expressionMode: 'laugh',
    exprMinimum: { mouthOpen: 0.55, smile: 0.5, squint: 0.38 },
    name: '奶龙仰天',
    short: '抱头',
    image: './assets/targets/head.webp',
    sticker: '抱头 · 仰头 · 眯眼',
    note: '双手放到脑袋两侧，仰头、张大嘴，笑到停不下来。',
    target: {
      expr: { mouthOpen: 0.9, smile: 0.8, squint: 0.85, brow: 0.4 },
      headTilt: -8,
      pose: { armL: -125, foreL: 135, armR: 125, foreR: -135, torsoLean: 0 },
    },
    poseMode: 'arms',
    exprTolerance: { mouthOpen: 0.38, smile: 0.42, squint: 0.48, brow: 0.55 },
    weights: { expr: 0.45, pose: 0.2, head: 0.05 },
    // 手部配置只用于演示模式的造型，不参与评分。
    hand: {
      mode: 'head',
      sides: 'both',
      positionTarget: 0.22,
      positionTolerance: 0.5,
      openness: 0.8,
      opennessTolerance: 0.55,
      opennessMode: 'min',
    },
    requirePose: true,
    tips: [
      ['😆', '表情 64%', '张大嘴 · 眼睛眯成缝'],
      ['🙌', '身体 29%', '手肘向外抬高'],
      ['🤲', '手部（不计分）', '动作会带动奶龙的手'],
      ['🤪', '歪头 7%', '头稍微歪一点'],
    ],
  },
];

export const DEFAULT_CHALLENGE_ID = 'belly';

export function getChallenge(id) {
  return CHALLENGES.find((challenge) => challenge.id === id) || CHALLENGES[0];
}
