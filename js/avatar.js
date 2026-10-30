/**
 * 一只原创的、奶龙 fan-art 风格的圆滚滚小黄龙。
 *
 * 全部用 Canvas 2D 矢量绘制，没有使用任何版权图片。
 * 表情：嘴巴开合 / 嘴角 / 笑眼 / 挑眉 / 歪头
 * 肢体：上臂、小臂、大腿、小腿的角度都可由 PoseLandmarker 实时驱动。
 */

export const PALETTE = {
  bodyTop: '#FFE45C',
  bodyBottom: '#FFC531',
  bodyShadow: '#F0A81E',
  belly: '#FFF6D9',
  horn: '#FFB525',
  hornInner: '#FFD875',
  hand: '#7C7C6E',
  handLight: '#9A9A8B',
  ink: '#3B2412',
  inkSoft: '#6B4A22',
  eye: '#241A12',
  white: '#FFFFFF',
  blush: '#FF8E8E',
  mouth: '#6D2A20',
  mouthDark: '#521C15',
  tongue: '#FF9AA2',
  tongueLine: '#E06D79',
  teeth: '#FFFDF5',
  bubble: '#FFFDF7',
  accent: '#FF6B57',
  ground: 'rgba(74, 48, 18, 0.16)',
};

const INK = PALETTE.ink;
const W = 640;
const H = 640;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const deg = (d) => (d * Math.PI) / 180;

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function bodyGradient(ctx, top, bottom) {
  const gradient = ctx.createLinearGradient(0, 80, 0, 620);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  return gradient;
}

function headPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(320, 98);
  ctx.bezierCurveTo(420, 94, 481, 163, 477, 258);
  ctx.bezierCurveTo(474, 336, 410, 388, 320, 392);
  ctx.bezierCurveTo(230, 388, 166, 336, 163, 258);
  ctx.bezierCurveTo(159, 163, 220, 94, 320, 98);
  ctx.closePath();
}

function bodyPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(320, 318);
  ctx.bezierCurveTo(428, 318, 462, 386, 458, 460);
  ctx.bezierCurveTo(454, 534, 400, 566, 320, 566);
  ctx.bezierCurveTo(240, 566, 186, 534, 182, 460);
  ctx.bezierCurveTo(178, 386, 212, 318, 320, 318);
  ctx.closePath();
}

function drawShadow(ctx, offsetX) {
  ctx.save();
  ctx.fillStyle = PALETTE.ground;
  ctx.beginPath();
  ctx.ellipse(320 + offsetX * 0.45, 618, 172, 21, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawTail(ctx) {
  // 尾巴：先描粗边，再用内部颜色盖住，得到圆润的描边效果。
  const tail = () => {
    ctx.beginPath();
    ctx.moveTo(430, 486);
    ctx.bezierCurveTo(512, 500, 555, 458, 548, 398);
    ctx.bezierCurveTo(544, 362, 520, 348, 502, 360);
    ctx.bezierCurveTo(520, 390, 512, 438, 440, 456);
    ctx.lineTo(430, 486);
    ctx.closePath();
  };
  ctx.save();
  tail();
  ctx.lineWidth = 15;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  tail();
  ctx.fillStyle = PALETTE.horn;
  ctx.fill();
  ctx.restore();

  // 尾巴上的三个小刺
  ctx.save();
  ctx.fillStyle = PALETTE.horn;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  for (const [x, y, s, rot] of [
    [536, 448, 16, -0.5],
    [554, 408, 18, -0.9],
    [546, 366, 14, -1.2],
  ]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.6, -s);
    ctx.lineTo(s * 1.3, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawLeg(ctx, hip, knee, ankle, footAngle, color) {
  const thigh = 48;
  const shin = 46;
  const radius = 18;
  const kneePoint = {
    x: hip.x + Math.sin(deg(knee)) * thigh,
    y: hip.y + Math.cos(deg(knee)) * thigh,
  };
  const anklePoint = {
    x: kneePoint.x + Math.sin(deg(ankle)) * shin,
    y: kneePoint.y + Math.cos(deg(ankle)) * shin,
  };

  ctx.save();
  ctx.lineCap = 'round';
  // 描边
  ctx.strokeStyle = INK;
  ctx.lineWidth = radius * 2 + 12;
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(kneePoint.x, kneePoint.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(kneePoint.x, kneePoint.y);
  ctx.lineTo(anklePoint.x, anklePoint.y);
  ctx.stroke();

  // 填充
  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 2;
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(kneePoint.x, kneePoint.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(kneePoint.x, kneePoint.y);
  ctx.lineTo(anklePoint.x, anklePoint.y);
  ctx.stroke();

  // 脚掌
  ctx.save();
  ctx.translate(anklePoint.x, anklePoint.y + 4);
  ctx.rotate(deg(footAngle));
  ctx.beginPath();
  ctx.ellipse(8, 4, 29, 17, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // 脚趾线
  ctx.strokeStyle = 'rgba(59, 36, 18, 0.45)';
  ctx.lineWidth = 3;
  for (const dx of [0, 10, 20]) {
    ctx.beginPath();
    ctx.moveTo(dx - 2, -2);
    ctx.lineTo(dx + 2, 8);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

function armPoints(shoulder, upperAngle, foreAngle) {
  const upperLength = 76;
  const foreLength = 70;
  const elbow = {
    x: shoulder.x + Math.sin(deg(upperAngle)) * upperLength,
    y: shoulder.y + Math.cos(deg(upperAngle)) * upperLength,
  };
  const wrist = {
    x: elbow.x + Math.sin(deg(foreAngle)) * foreLength,
    y: elbow.y + Math.cos(deg(foreAngle)) * foreLength,
  };
  return { elbow, wrist };
}

/**
 * 上臂画在头后面，小臂和手画在头前面。
 * 奶龙的头很大，双手举过头顶时如果整条手臂都在头后面，
 * 手掌会完全被头挡住；分开画可以保证举手始终看得见。
 */
function drawUpperArm(ctx, shoulder, upperAngle, color) {
  const radius = 17;
  const elbow = {
    x: shoulder.x + Math.sin(deg(upperAngle)) * 76,
    y: shoulder.y + Math.cos(deg(upperAngle)) * 76,
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = radius * 2 + 12;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(elbow.x, elbow.y);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 2;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(elbow.x, elbow.y);
  ctx.stroke();
  ctx.restore();
}

function drawFinger(ctx, x1, y1, x2, y2, radius, color) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = radius * 2 + 4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawForearm(
  ctx,
  shoulder,
  upperAngle,
  foreAngle,
  color,
  hand = null,
  thumbSign = 1
) {
  const radius = 17;
  const { elbow, wrist } = armPoints(shoulder, upperAngle, foreAngle);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = radius * 2 + 12;
  ctx.beginPath();
  ctx.moveTo(elbow.x, elbow.y);
  ctx.lineTo(wrist.x, wrist.y);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = radius * 2;
  ctx.beginPath();
  ctx.moveTo(elbow.x, elbow.y);
  ctx.lineTo(wrist.x, wrist.y);
  ctx.stroke();

  // 手部关节：把 21 点识别结果压缩成 4 根手指 + 1 根拇指的开合度。
  const dir = { x: Math.sin(deg(foreAngle)), y: Math.cos(deg(foreAngle)) };
  const perp = { x: Math.cos(deg(foreAngle)), y: -Math.sin(deg(foreAngle)) };
  const rotate = (vector, angle) => ({
    x: vector.x * Math.cos(angle) - vector.y * Math.sin(angle),
    y: vector.x * Math.sin(angle) + vector.y * Math.cos(angle),
  });
  const fingers = hand?.fingers ?? [0.35, 0.35, 0.35, 0.35];
  const spread = [-10, -3.5, 3.5, 10];
  const fans = [-9, -3, 3, 9];
  const handColor = PALETTE.hand;

  for (let i = 0; i < 4; i++) {
    const extension = Math.min(1, Math.max(0, fingers[i] ?? 0.35));
    const base = {
      x: wrist.x + dir.x * 9 + perp.x * spread[i],
      y: wrist.y + dir.y * 9 + perp.y * spread[i],
    };
    const direction = rotate(dir, deg(fans[i]));
    const length = 4 + extension * 13;
    drawFinger(
      ctx,
      base.x,
      base.y,
      base.x + direction.x * length,
      base.y + direction.y * length,
      4.2,
      handColor
    );
  }

  const thumbExtension = Math.min(1, Math.max(0, hand?.thumb ?? 0.4));
  const thumbBase = {
    x: wrist.x + perp.x * thumbSign * 10 + dir.x * 2,
    y: wrist.y + perp.y * thumbSign * 10 + dir.y * 2,
  };
  const thumbTip = {
    x:
      wrist.x +
      perp.x * thumbSign * (16 + thumbExtension * 7) +
      dir.x * (4 + thumbExtension * 9),
    y:
      wrist.y +
      perp.y * thumbSign * (16 + thumbExtension * 7) +
      dir.y * (4 + thumbExtension * 9),
  };
  drawFinger(ctx, thumbBase.x, thumbBase.y, thumbTip.x, thumbTip.y, 5, handColor);

  // 手掌盖在手指根部，让手指从掌心长出来
  ctx.beginPath();
  ctx.arc(wrist.x, wrist.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = handColor;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(
    wrist.x - perp.x * 5,
    wrist.y - perp.y * 5,
    7,
    10,
    deg(foreAngle),
    0,
    Math.PI * 2
  );
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();

  ctx.restore();
}

function drawHorn(ctx, x, flip, fill) {
  ctx.save();
  ctx.translate(x, 0);
  ctx.scale(flip ? -1 : 1, 1);
  ctx.beginPath();
  ctx.moveTo(0, 176);
  ctx.bezierCurveTo(-16, 142, -18, 110, -2, 96);
  ctx.bezierCurveTo(14, 82, 33, 104, 34, 148);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // 内层高光
  ctx.beginPath();
  ctx.moveTo(8, 158);
  ctx.bezierCurveTo(0, 134, 1, 113, 9, 104);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255, 248, 190, 0.75)';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawEyes(ctx, squint, blink, brow) {
  const eyes = [
    { x: 252, y: 247, dir: 1 },
    { x: 388, y: 247, dir: -1 },
  ];
  const happyArc = Math.min(1, Math.max(0, (squint - 0.3) / 0.45));

  for (const eye of eyes) {
    const eyeHeight = Math.max(2.2, 31 * (1 - 0.84 * squint) * (1 - 0.7 * blink));
    const eyeWidth = 23;

    // 眼白（保留了奶龙黑色大眼珠的观感，用深色直接画）
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, eyeWidth, eyeHeight, 0, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.eye;
    ctx.fill();

    if (eyeHeight > 10) {
      ctx.beginPath();
      ctx.arc(eye.x - 7 * eye.dir, eye.y - eyeHeight * 0.36, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eye.x + 6 * eye.dir, eye.y + eyeHeight * 0.3, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();
    }
    ctx.restore();

    if (happyArc > 0.02) {
      ctx.save();
      ctx.globalAlpha = happyArc;
      ctx.beginPath();
      ctx.moveTo(eye.x - 27, eye.y + 5);
      ctx.quadraticCurveTo(eye.x, eye.y - 27, eye.x + 27, eye.y + 5);
      ctx.lineWidth = 9;
      ctx.strokeStyle = PALETTE.eye;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 眉毛
    ctx.save();
    const browY = eye.y - 39 - brow * 10;
    ctx.beginPath();
    ctx.moveTo(eye.x - 25, browY + 5);
    ctx.quadraticCurveTo(eye.x, browY - 7, eye.x + 25, browY + 3);
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#B57B14';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }
}

function drawMouth(ctx, mouthOpen, smile) {
  const open = clamp01(mouthOpen);
  const smileV = clamp01(smile);
  const cx = 320;
  const cy = 318;
  const halfWidth = 54 + 26 * smileV + 10 * open;
  const height = 4 + 60 * open;

  if (open < 0.115) {
    // 闭着嘴的笑：一条上扬的弧线 + 嘴角小窝
    const width = 36 + 32 * smileV;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - width, cy - 5);
    ctx.quadraticCurveTo(cx, cy + 12 + 17 * smileV, cx + width, cy - 5);
    ctx.lineWidth = 8;
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#7A3427';
    ctx.lineWidth = 3.2;
    ctx.stroke();
    ctx.restore();
    return;
  }

  const topY = cy - 3 - 9 * smileV;
  const cornerY = cy - 13 * smileV;
  const bottomY = cy + height;

  const mouth = () => {
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, cornerY);
    ctx.quadraticCurveTo(cx, topY - 4, cx + halfWidth, cornerY);
    ctx.quadraticCurveTo(
      cx + halfWidth * 0.68,
      bottomY,
      cx,
      bottomY
    );
    ctx.quadraticCurveTo(cx - halfWidth * 0.68, bottomY, cx - halfWidth, cornerY);
    ctx.closePath();
  };

  ctx.save();
  mouth();
  ctx.fillStyle = PALETTE.mouth;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 口腔内部
  ctx.save();
  mouth();
  ctx.clip();
  const inner = ctx.createRadialGradient(cx, cy + height * 0.4, 4, cx, cy + height * 0.4, halfWidth);
  inner.addColorStop(0, '#8D382B');
  inner.addColorStop(1, PALETTE.mouthDark);
  ctx.fillStyle = inner;
  ctx.fillRect(cx - halfWidth - 10, topY - 10, halfWidth * 2 + 20, bottomY - topY + 20);

  // 舌头
  ctx.beginPath();
  ctx.ellipse(cx, bottomY - height * 0.12, halfWidth * 0.54, height * 0.34, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.tongue;
  ctx.fill();
  ctx.strokeStyle = PALETTE.tongueLine;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, bottomY - height * 0.33);
  ctx.lineTo(cx, bottomY - height * 0.04);
  ctx.strokeStyle = 'rgba(180, 70, 80, 0.45)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // 上排牙
  ctx.fillStyle = PALETTE.teeth;
  roundRect(ctx, cx - 28, topY + 1, 56, 13, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 75, 40, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, topY + 3);
  ctx.lineTo(cx, topY + 13);
  ctx.stroke();

  // 两颗小尖牙
  ctx.fillStyle = PALETTE.teeth;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * (halfWidth * 0.62) - 7, cornerY + 2);
    ctx.lineTo(cx + side * (halfWidth * 0.62) + 7, cornerY + 2);
    ctx.lineTo(cx + side * (halfWidth * 0.62), cornerY + 20);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

function drawFace(ctx, state) {
  const { mouthOpen, smile, squint, brow } = state.expr;

  // 腮红
  ctx.save();
  ctx.globalAlpha = 0.22 + 0.32 * clamp01(smile);
  ctx.fillStyle = PALETTE.blush;
  for (const [x, rot] of [
    [204, -0.2],
    [436, 0.2],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x, 296, 27, 14, rot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 浅色口鼻区
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(320, 307, 104, 63, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 248, 213, 0.92)';
  ctx.fill();
  ctx.restore();

  // 鼻孔
  ctx.save();
  ctx.fillStyle = 'rgba(122, 79, 24, 0.78)';
  for (const x of [305, 335]) {
    ctx.beginPath();
    ctx.ellipse(x, 289, 4.5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  drawMouth(ctx, mouthOpen, smile);
  drawEyes(ctx, squint, 0, brow);
}

function drawLaughBubble(ctx, alpha) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(470, 58);
  ctx.rotate(-0.05);

  // 气泡尾巴
  ctx.beginPath();
  ctx.moveTo(-45, 26);
  ctx.lineTo(-15, 34);
  ctx.lineTo(-72, 68);
  ctx.closePath();
  ctx.fillStyle = PALETTE.bubble;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // 气泡
  roundRect(ctx, -108, -46, 216, 82, 26);
  ctx.fillStyle = PALETTE.bubble;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.fillStyle = PALETTE.accent;
  ctx.font = '900 42px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('哈哈哈', 0, 0);
  ctx.restore();
}

function drawGleeLines(ctx, alpha, time) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha * 0.7;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const [x, y, side] of [
    [126, 196, -1],
    [514, 196, 1],
  ]) {
    for (let i = 0; i < 2; i++) {
      const wobble = Math.sin(time * 9 + i * 1.7) * 3;
      ctx.beginPath();
      ctx.moveTo(x + side * i * 16, y + i * 22);
      ctx.quadraticCurveTo(
        x + side * (28 + i * 10),
        y + i * 22 - 8 + wobble,
        x + side * (12 + i * 10),
        y + i * 22 - 24
      );
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state
 *   state.expr {mouthOpen, smile, squint, brow}
 *   state.arms {left:{upper,fore}, right:{upper,fore}}
 *   state.legs {left:{hip,knee}, right:{hip,knee}}
 *   state.torsoLean, state.headTilt, state.offsetX, state.offsetY
 *   state.laugh, state.tracked
 * @param {{time?: number}} options
 */
export function drawNailong(ctx, state, options = {}) {
  const time = options.time ?? 0;
  const expr = state.expr ?? {};
  const arms = state.arms ?? {};
  const legs = state.legs ?? {};

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 背景柔光
  const glow = ctx.createRadialGradient(320, 330, 40, 320, 330, 320);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  glow.addColorStop(0.62, 'rgba(255, 246, 205, 0.22)');
  glow.addColorStop(1, 'rgba(255, 246, 205, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  drawShadow(ctx, state.offsetX ?? 0);

  const idleBounce = Math.sin(time * 2.1) * 2.2;
  const laugh = clamp01(state.laugh ?? 0);
  const laughBounce = -Math.abs(Math.sin(time * 7.5)) * 5 * laugh;
  const offsetX = state.offsetX ?? 0;
  const offsetY = (state.offsetY ?? 0);

  ctx.save();
  ctx.translate(offsetX, offsetY + idleBounce + laughBounce);
  ctx.translate(320, 555);
  ctx.rotate(deg((state.torsoLean ?? 0) * 0.7));
  ctx.translate(-320, -555);

  const squish = 1 + Math.sin(time * 2.1) * 0.01 + laugh * Math.abs(Math.sin(time * 7.5)) * 0.012;
  ctx.translate(320, 585);
  ctx.scale(2 - squish, squish);
  ctx.translate(-320, -585);

  const yellow = bodyGradient(ctx, PALETTE.bodyTop, PALETTE.bodyBottom);

  // 尾巴
  drawTail(ctx);

  // 腿
  const legLeft = legs.left ?? { hip: 8, knee: 5 };
  const legRight = legs.right ?? { hip: -8, knee: 5 };
  // 髋部抬高一点，让脚掌完整落在 640 画布内，不被底边切平。
  drawLeg(
    ctx,
    { x: 364, y: 516 },
    legLeft.hip + 6,
    legLeft.knee,
    0,
    yellow
  );
  drawLeg(
    ctx,
    { x: 276, y: 516 },
    legRight.hip - 6,
    legRight.knee,
    0,
    yellow
  );

  // 身体
  ctx.save();
  bodyPath(ctx);
  ctx.fillStyle = yellow;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // 肚皮
  ctx.beginPath();
  ctx.ellipse(320, 478, 80, 86, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.belly;
  ctx.fill();
  ctx.strokeStyle = 'rgba(196, 142, 28, 0.32)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(320, 478, 60, 64, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 6;
  ctx.stroke();

  // 身体高光
  ctx.beginPath();
  ctx.ellipse(248, 408, 34, 56, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.fill();
  ctx.restore();

  // 上臂在头后面，小臂和手稍后画在头前面
  const armLeft = arms.left ?? { upper: 20, fore: 10 };
  const armRight = arms.right ?? { upper: -20, fore: -10 };
  drawUpperArm(ctx, { x: 430, y: 392 }, armLeft.upper, yellow);
  drawUpperArm(ctx, { x: 210, y: 392 }, armRight.upper, yellow);

  // 头部整体轻微歪头 + 大笑时向上仰
  ctx.save();
  ctx.translate(320, 362);
  ctx.rotate(deg((state.headTilt ?? 0) + (expr.mouthOpen ?? 0) * -3 + laugh * Math.sin(time * 8) * 1.2));
  ctx.translate(-320, -362);
  const lift = -(expr.mouthOpen ?? 0) * 5 - laugh * 2;
  ctx.translate(0, lift);

  // 角要跟着头一起旋转/上移，否则歪头时会和脑袋脱节
  drawHorn(ctx, 252, false, PALETTE.horn);
  drawHorn(ctx, 388, true, PALETTE.horn);

  headPath(ctx);
  ctx.fillStyle = yellow;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // 头顶高光
  ctx.save();
  headPath(ctx);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(252, 168, 58, 34, -0.45, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
  ctx.fill();
  ctx.restore();

  drawFace(ctx, {
    expr: {
      mouthOpen: expr.mouthOpen ?? 0,
      smile: expr.smile ?? 0,
      squint: expr.squint ?? 0,
      brow: expr.brow ?? 0,
    },
  });
  ctx.restore();

  // 小臂 + 手掌画在头前面：即使举到头顶也能看见手
  drawForearm(
    ctx,
    { x: 430, y: 392 },
    armLeft.upper,
    armLeft.fore,
    yellow,
    armLeft.hand,
    -1
  );
  drawForearm(
    ctx,
    { x: 210, y: 392 },
    armRight.upper,
    armRight.fore,
    yellow,
    armRight.hand,
    1
  );

  ctx.restore();

  drawGleeLines(ctx, laugh, time);
  drawLaughBubble(ctx, laugh > 0.45 ? (laugh - 0.45) / 0.55 : 0);

  ctx.restore();
}

/** 看不到人时的待机动作。 */
export function idleState(time) {
  const sway = Math.sin(time * 1.4);
  return {
    expr: {
      mouthOpen: 0.05 + 0.02 * Math.max(0, sway),
      smile: 0.22 + 0.06 * Math.max(0, sway),
      squint: 0.08,
      brow: 0.15,
    },
    arms: {
      left: { upper: 18 + sway * 3, fore: 8 },
      right: { upper: -18 + sway * 3, fore: -8 },
    },
    legs: { left: { hip: 8, knee: 5 }, right: { hip: -8, knee: 5 } },
    torsoLean: sway * 1.5,
    headTilt: sway * 2,
    offsetX: 0,
    offsetY: 0,
    laugh: 0,
    tracked: false,
  };
}
