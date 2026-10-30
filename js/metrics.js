/**
 * 把 MediaPipe 的原始检测结果翻译成「奶龙可用的表情 / 肢体数值」。
 *
 * 表情：FaceLandmarker 的 52 个 blendshape + 面部关键点几何兜底
 * 肢体：PoseLandmarker 的 33 个姿态点
 *
 * 坐标约定：
 * - 输入是未镜像的摄像头画面（MediaPipe 在原始画面上推理）。
 * - 本文件里的 Face / Pose 坐标全部做了镜像（x' = 1 - x），
 *   这样「用户抬左手」在画面里就是屏幕右侧抬起，与照镜子的直觉一致。
 * - 角度统一用「与竖直向下的夹角」：手臂自然下垂 = 0°，
 *   向屏幕右侧抬起 = 正角度，向屏幕左侧抬起 = 负角度。
 */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v) => clamp(v, 0, 1);
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const wrapDeg = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
export const angleFromDown = (dx, dy) => (Math.atan2(dx, dy) * 180) / Math.PI;

/**
 * 线段倾斜角，统一到 [-90, 90]。
 * 镜像后 x 方向会翻转，直接用 atan2 会得到 ±180° 附近的角度；
 * 对「眼线 / 肩线」这种没有方向的线，需要把角度折回来。
 */
export const lineTiltDeg = (dx, dy) => {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
};

export const FACE_LM = {
  upperInnerLip: 13,
  lowerInnerLip: 14,
  mouthLeft: 61,
  mouthRight: 291,
  rightEyeOuter: 33,
  leftEyeOuter: 263,
  rightEyeUpper: 159,
  rightEyeLower: 145,
  leftEyeUpper: 386,
  leftEyeLower: 374,
  forehead: 10,
  chin: 152,
  leftCheek: 234,
  rightCheek: 454,
  noseTip: 1,
};

export const POSE_LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

const BLEND_ALIASES = {
  jawOpen: ['jawOpen'],
  smileL: ['mouthSmileLeft'],
  smileR: ['mouthSmileRight'],
  eyeSquintL: ['eyeSquintLeft'],
  eyeSquintR: ['eyeSquintRight'],
  cheekL: ['cheekSquintLeft'],
  cheekR: ['cheekSquintRight'],
  blinkL: ['eyeBlinkLeft'],
  blinkR: ['eyeBlinkRight'],
  browInnerUp: ['browInnerUp'],
};

function readBlendshapes(faceResult) {
  const categories = faceResult?.faceBlendshapes?.[0]?.categories;
  if (!categories || !categories.length) return null;
  const map = new Map();
  for (const category of categories) {
    const name = category.categoryName ?? category.category_name ?? '';
    if (name) map.set(name, Number(category.score) || 0);
  }
  if (!map.size) return null;
  const get = (names) => {
    let total = 0;
    let count = 0;
    for (const name of names) {
      if (map.has(name)) {
        total += map.get(name);
        count += 1;
      }
    }
    return count ? total / count : null;
  };
  return {
    jawOpen: get(BLEND_ALIASES.jawOpen),
    smileL: get(BLEND_ALIASES.smileL),
    smileR: get(BLEND_ALIASES.smileR),
    eyeSquintL: get(BLEND_ALIASES.eyeSquintL),
    eyeSquintR: get(BLEND_ALIASES.eyeSquintR),
    cheekL: get(BLEND_ALIASES.cheekL),
    cheekR: get(BLEND_ALIASES.cheekR),
    blinkL: get(BLEND_ALIASES.blinkL),
    blinkR: get(BLEND_ALIASES.blinkR),
    browInnerUp: get(BLEND_ALIASES.browInnerUp),
  };
}

/**
 * 面部朝向矩阵。
 *
 * MediaPipe 的 facialTransformationMatrixes 是列主序 4×4：
 * 前三列是「脸模型 +X / +Y / +Z 轴」在摄像头坐标里的方向，最后一行是平移。
 * +Y 是额头方向，+Z 是鼻子朝外的方向。默认摄像头坐标 y 向下、z 指向屏幕里，
 * 所以正对镜头时第三列约为 (0, 0, -1)，第二列约为 (0, -1, 0)。
 *
 * 不同平台/版本偶尔会换成 +z 朝镜头或行主序；这里只接受带合法旋转矩阵的
 * 列主序结果，并让几何兜底去校正 180° 的坐标约定差异。
 */
function matrixHeadAngles(faceResult) {
  const entry = faceResult?.facialTransformationMatrixes?.[0];
  if (!entry) return null;
  const raw = entry.data ?? entry.matrix?.data ?? entry;
  if (!raw || typeof raw.length !== 'number' || raw.length !== 16) {
    return null;
  }
  const rows = entry.rows ?? 4;
  const columns = entry.columns ?? 4;
  if (Number(rows) !== 4 || Number(columns) !== 4) return null;
  const layout = String(
    entry.layout ?? entry.matrixLayout ?? entry.matrix_layout ?? ''
  ).toLowerCase();
  if (layout.includes('row')) return null;

  const data = Array.from(raw, Number);
  if (!data.every((value) => Number.isFinite(value))) return null;

  const vec = (offset) => [data[offset], data[offset + 1], data[offset + 2]];
  const norm = (v) => Math.hypot(v[0], v[1], v[2]);
  const unit = (v) => {
    const length = norm(v);
    return length > 0 ? v.map((value) => value / length) : null;
  };

  const c0 = unit(vec(0));
  const c1 = unit(vec(4));
  const c2 = unit(vec(8));
  if (!c0 || !c1 || !c2) return null;
  const norms = [norm(vec(0)), norm(vec(4)), norm(vec(8))];
  if (norms.some((value) => value < 0.2 || value > 5)) return null;

  const determinant =
    c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) -
    c0[1] * (c1[0] * c2[2] - c1[2] * c2[0]) +
    c0[2] * (c1[0] * c2[1] - c1[1] * c2[0]);
  if (!Number.isFinite(determinant) || Math.abs(determinant - 1) > 0.2) {
    return null;
  }

  // 标准摄像头坐标里，脸模型的 +Y（额头）映射到 -Y，+Z（鼻子）映射到 -Z。
  // 用 c1.y 的符号识别偶尔出现的 y 轴翻转，避免把「抬头」读成「低头」。
  const yUpSign = c1[1] > 0 ? 1 : -1;
  const forward = c2;
  let yaw = (Math.atan2(-forward[0], -forward[2]) * 180) / Math.PI;
  const pitch =
    (Math.asin(clamp(yUpSign * forward[1], -1, 1)) * 180) / Math.PI;

  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return {
    yaw,
    pitch,
    // 让几何兜底可以判断这到底是 +z 朝外还是 -z 朝外的坐标约定。
    forwardZ: forward[2],
    forward,
  };
}

function faceGeometryAngles(lm, aspect) {
  const P3 = (index) => {
    const point = lm[index];
    if (!point) return null;
    return {
      // 统一成「画面高度」单位：x / z 按宽度归一化，乘 aspect；
      // y 已按高度归一化，不再乘宽高比，避免宽屏下俯仰角被压缩。
      x: (1 - point.x) * aspect,
      y: point.y,
      z: Number.isFinite(point.z) ? point.z * aspect : null,
    };
  };
  const eyeR = P3(FACE_LM.rightEyeOuter);
  const eyeL = P3(FACE_LM.leftEyeOuter);
  const nose = P3(FACE_LM.noseTip);
  const forehead = P3(FACE_LM.forehead);
  const chin = P3(FACE_LM.chin);
  if (!eyeR || !eyeL || !nose || !forehead || !chin) return null;

  const midpoint = {
    x: (eyeR.x + eyeL.x) / 2,
    y: (eyeR.y + eyeL.y) / 2,
    z: (eyeR.z + eyeL.z) / 2,
  };
  const eyeSpanW = Math.hypot(eyeL.x - eyeR.x, eyeL.y - eyeR.y);
  const faceHeightW = Math.hypot(chin.x - forehead.x, chin.y - forehead.y);
  if (eyeSpanW < 0.008 || faceHeightW < 0.016) return null;

  const zValues = [eyeR.z, eyeL.z, nose.z, forehead.z, chin.z];
  if (zValues.some((value) => value == null || !Number.isFinite(value))) {
    return null;
  }
  const zSpread =
    Math.max(...zValues) - Math.min(...zValues);

  let yaw;
  let pitch = null;
  let source = 'geometry2d';
  if (zSpread > 0.002 && Math.abs(nose.z - midpoint.z) > 0.002) {
    // x 已经镜像过：鼻尖往屏幕右移时 dx > 0，必须直接当分子。
    // MediaPipe 的 z 越小越靠近镜头，所以鼻尖朝右前时 dz < 0，
    // 用 -dz 作分母就能得到「屏幕右转为正」。
    yaw =
      (Math.atan2(nose.x - midpoint.x, -(nose.z - midpoint.z)) * 180) /
      Math.PI;
    pitch =
      (Math.atan2(
        forehead.z - chin.z,
        Math.max(0.001, chin.y - forehead.y)
      ) *
        180) /
      Math.PI;
    source = 'geometry';
  } else {
    // 纯 2D 时只能用鼻尖相对眼线中点的水平偏移判断左右转头。
    yaw =
      (Math.atan2(nose.x - midpoint.x, Math.max(0.001, eyeSpanW * 0.5)) *
        180) /
      Math.PI;
  }

  if (!Number.isFinite(yaw)) return null;
  return {
    yaw,
    pitch: Number.isFinite(pitch) ? pitch : null,
    source,
    eyeSpanW,
    faceHeightW,
  };
}

function faceMetrics(faceResult, aspect) {
  const lm = faceResult?.faceLandmarks?.[0];
  if (!lm || lm.length < 300) return null;

  const P = (index) => {
    const point = lm[index];
    return { x: 1 - point.x, y: point.y };
  };
  const d = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

  const eyeSpan = Math.max(1e-4, d(P(FACE_LM.rightEyeOuter), P(FACE_LM.leftEyeOuter)));
  const faceHeight = Math.max(1e-4, d(P(FACE_LM.forehead), P(FACE_LM.chin)));

  // ---- 几何兜底（blendshape 不稳定时使用） ----
  const lipGap = Math.abs(P(FACE_LM.lowerInnerLip).y - P(FACE_LM.upperInnerLip).y);
  const geomMouthOpen = clamp01((lipGap / eyeSpan - 0.02) / 0.42);

  // 用上唇而不是上下唇中点作参考：张嘴时下唇会往下掉，
  // 中点到嘴角的距离会凭空变大，导致「张嘴」被误算成「咧嘴笑」。
  const cornerY =
    (P(FACE_LM.mouthLeft).y + P(FACE_LM.mouthRight).y) / 2;
  const cornerLift = P(FACE_LM.upperInnerLip).y - cornerY;
  const geomSmile = clamp01((cornerLift / eyeSpan - 0.02) / 0.28);

  // 分子是归一化 y 距离、分母是归一化 x 距离，必须把分母乘上 aspect
  // 才能和物理上的眼睛开合比例一致（16:9 视频尤其明显）。
  const rightEyeOpen =
    Math.abs(P(FACE_LM.rightEyeLower).y - P(FACE_LM.rightEyeUpper).y) /
    Math.max(
      1e-4,
      Math.abs((P(FACE_LM.rightEyeOuter).x - P(133).x) * aspect) ||
        eyeSpan * 0.9
    );
  const leftEyeOpen =
    Math.abs(P(FACE_LM.leftEyeLower).y - P(FACE_LM.leftEyeUpper).y) /
    Math.max(
      1e-4,
      Math.abs((P(FACE_LM.leftEyeOuter).x - P(362).x) * aspect) ||
        eyeSpan * 0.9
    );
  const geomEyeOpen = (rightEyeOpen + leftEyeOpen) / 2;
  const geomSquint = clamp01((0.26 - geomEyeOpen) / 0.2);

  const roll = lineTiltDeg(
    (P(FACE_LM.leftEyeOuter).x - P(FACE_LM.rightEyeOuter).x) * aspect,
    P(FACE_LM.leftEyeOuter).y - P(FACE_LM.rightEyeOuter).y
  );

  const blends = readBlendshapes(faceResult);

  let mouthOpen = geomMouthOpen;
  let smile = geomSmile;
  let squint = geomSquint;
  let brow = 0.2;

  if (blends) {
    const avg = (a, b, fallback = 0) =>
      a == null && b == null ? fallback : ((a ?? fallback) + (b ?? fallback)) / 2;
    const smileB = avg(blends.smileL, blends.smileR, geomSmile);
    const eyeSquint = avg(blends.eyeSquintL, blends.eyeSquintR, geomSquint);
    const cheek = avg(blends.cheekL, blends.cheekR, geomSquint);
    const blink = avg(blends.blinkL, blends.blinkR, 0);
    const jaw = blends.jawOpen ?? geomMouthOpen;

    mouthOpen = clamp01(0.72 * jaw + 0.28 * geomMouthOpen);
    // blendshape 是更干净的咧嘴信号；几何量只做小幅校正。
    smile = clamp01(0.8 * smileB + 0.2 * geomSmile);
    squint = clamp01(
      0.42 * eyeSquint + 0.18 * cheek + 0.22 * blink + 0.18 * geomSquint
    );
    brow = clamp01(blends.browInnerUp ?? 0.2);
  }

  // 人脸框（原始坐标，供摄像头小窗画框使用）
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of lm) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  // 手部定位用的锚点，统一转换成「镜像 + aspect 校正」的像素比例空间。
  const aspectPoint = (point) => ({
    x: point.x * aspect,
    y: point.y,
  });
  const chin = aspectPoint(P(FACE_LM.chin));
  const forehead = aspectPoint(P(FACE_LM.forehead));
  const headLeft = aspectPoint(P(FACE_LM.leftCheek));
  const headRight = aspectPoint(P(FACE_LM.rightCheek));
  const anchors = {
    chin,
    forehead,
    headLeft,
    headRight,
    faceHeight,
    center: {
      x: (chin.x + forehead.x) / 2,
      y: (chin.y + forehead.y) / 2,
    },
    // 肚子锚点：下巴正下方约 1.25 个脸高处（不依赖髋部是否入镜）。
    belly: {
      x: chin.x,
      y: chin.y + faceHeight * 1.25,
    },
  };

  // ---- 头部 yaw / pitch ----
  // 优先使用人脸变换矩阵；矩阵缺失、数值损坏或和 3D 关键点明显矛盾时
  // 退到鼻尖 / 眼线几何，保证戴帽子、大角度或旧版 MediaPipe 也不会失联。
  const geometryAngles = faceGeometryAngles(lm, aspect);
  const matrixAngles = matrixHeadAngles(faceResult);
  let headSource = 'none';
  let matrixValid = false;
  let headYaw = 0;
  let headPitch = 0;

  if (matrixAngles) {
    let yaw = matrixAngles.yaw;
    let pitch = matrixAngles.pitch;
    let agreesWithGeometry = true;
    if (geometryAngles) {
      // 某些构建的矩阵把 +Z 朝镜头，会整体差 180°；用几何朝向掰回来。
      if (Math.abs(wrapDeg(yaw - geometryAngles.yaw)) > 120) {
        yaw = wrapDeg(yaw - 180);
      }
      if (
        Math.abs(wrapDeg(yaw - geometryAngles.yaw)) > 45 ||
        (geometryAngles.pitch != null &&
          Math.abs(wrapDeg(pitch - geometryAngles.pitch)) > 55)
      ) {
        agreesWithGeometry = false;
      }
    }

    if (agreesWithGeometry) {
      matrixValid = true;
      headSource = 'matrix';
      headYaw = clamp(yaw, -60, 60);
      headPitch = clamp(pitch, -45, 45);
      if (geometryAngles) {
        // 只有几何量和矩阵基本一致时才混入，避免把 2D 近似当成第二票；
        // 两者都可信时用 90/10 平滑一下矩阵抖动。
        const yawDiff = Math.abs(wrapDeg(headYaw - geometryAngles.yaw));
        const pitchDiff =
          geometryAngles.pitch == null
            ? null
            : Math.abs(wrapDeg(headPitch - geometryAngles.pitch));
        if (yawDiff < 12 && (pitchDiff == null || pitchDiff < 12)) {
          headYaw = clamp(headYaw * 0.9 + geometryAngles.yaw * 0.1, -60, 60);
          if (pitchDiff != null) {
            headPitch = clamp(
              headPitch * 0.9 + geometryAngles.pitch * 0.1,
              -45,
              45
            );
          }
        }
      }
    }
  }

  if (!matrixValid && geometryAngles) {
    headSource = geometryAngles.source;
    headYaw = clamp(geometryAngles.yaw, -60, 60);
    headPitch =
      geometryAngles.pitch == null
        ? 0
        : clamp(geometryAngles.pitch, -45, 45);
  }

  return {
    expr: {
      mouthOpen,
      smile,
      squint,
      brow,
      headTilt: clamp(roll, -45, 45),
      headYaw,
      headPitch,
    },
    headSource,
    matrixValid,
    blendGeometry: {
      mouthOpen: geomMouthOpen,
      smile: geomSmile,
      squint: geomSquint,
    },
    faceBox: { minX, maxX, minY, maxY },
    faceHeight,
    eyeSpan,
    anchors,
    hasBlendshapes: Boolean(blends),
  };
}

function posePoint(poseLm, index, aspect) {
  const point = poseLm[index];
  if (!point) return null;
  const visibility = point.visibility ?? 1;
  return {
    x: (1 - point.x) * aspect,
    y: point.y,
    nx: 1 - point.x,
    ny: point.y,
    z: Number.isFinite(point.z) ? point.z : 0,
    visibility,
    inFrame:
      point.x >= -0.04 &&
      point.x <= 1.04 &&
      point.y >= -0.04 &&
      point.y <= 1.04,
  };
}

/**
 * 躯干朝向。
 *
 * 肩线在屏幕上的宽度做分母，肩膀前后错位（z）做分子：
 * 用户转向自己的右侧时，画面左侧的肩膀会靠近镜头、右侧会后退，
 * 镜像预览里看起来就是「整块身体向右转」，所以正值 = 屏幕向右转。
 *
 * 髋部和肩部都可见时再算前倾：肩膀比髋部更靠近镜头 => 身体前倾。
 * 这两个量都不参与打分，只驱动 3D 骨骼。
 */
function bodyAngles(sL, sR, hL, hR, aspect) {
  const span = sR.nx - sL.nx;
  const dz = sR.z - sL.z;
  const shouldersInFrame = sL.inFrame && sR.inFrame;
  const shouldersValid =
    shouldersInFrame &&
    shoulderVisibilityOf(sL, sR) >= 0.45 &&
    Math.abs(span) >= 0.06 &&
    Math.abs(dz) <= 0.4;

  let shoulderYaw = null;
  let shoulderConfidence = 0;
  if (shouldersValid) {
    shoulderYaw = clamp((Math.atan2(dz, span) * 180) / Math.PI, -40, 40);
    shoulderConfidence =
      Math.min(sL.visibility, sR.visibility) *
      smoothstep(0.06, 0.16, Math.abs(span));
  }

  let hipYaw = null;
  let hipConfidence = 0;
  if (hL && hR && hL.inFrame && hR.inFrame) {
    const hipSpan = hR.nx - hL.nx;
    const hipDz = hR.z - hL.z;
    if (
      Math.min(hL.visibility, hR.visibility) >= 0.45 &&
      Math.abs(hipSpan) >= 0.045 &&
      Math.abs(hipDz) <= 0.4
    ) {
      hipYaw = clamp((Math.atan2(hipDz, hipSpan) * 180) / Math.PI, -40, 40);
      hipConfidence =
        Math.min(hL.visibility, hR.visibility) *
        smoothstep(0.045, 0.12, Math.abs(hipSpan));
    }
  }

  let bodyYaw = 0;
  let bodyYawSource = 'none';
  let bodyYawConfidence = 0;
  if (shoulderYaw != null && hipYaw != null) {
    bodyYaw = shoulderYaw * 0.75 + hipYaw * 0.25;
    bodyYawSource = 'shoulder+hip';
    bodyYawConfidence = Math.min(shoulderConfidence, 1) * 0.75 +
      Math.min(hipConfidence, 1) * 0.25;
  } else if (shoulderYaw != null) {
    bodyYaw = shoulderYaw;
    bodyYawSource = 'shoulder';
    bodyYawConfidence = shoulderConfidence;
  } else if (hipYaw != null) {
    bodyYaw = hipYaw;
    bodyYawSource = 'hip';
    bodyYawConfidence = hipConfidence;
  }

  let bodyPitch = 0;
  let bodyPitchValid = false;
  if (
    hL &&
    hR &&
    shouldersInFrame &&
    hL.inFrame &&
    hR.inFrame &&
    Math.min(sL.visibility, sR.visibility, hL.visibility, hR.visibility) >= 0.4
  ) {
    const shoulderMid = {
      y: (sL.ny + sR.ny) / 2,
      z: (sL.z + sR.z) / 2,
    };
    const hipMid = {
      y: (hL.ny + hR.ny) / 2,
      z: (hL.z + hR.z) / 2,
    };
    // 归一化 y 是「画面高度」单位，换算成「画面宽度」单位才能和 z 一起求角。
    const vertical = (hipMid.y - shoulderMid.y) / Math.max(0.2, aspect);
    if (vertical > 0.12) {
      bodyPitch = clamp(
        (Math.atan2(hipMid.z - shoulderMid.z, vertical) * 180) / Math.PI,
        -30,
        30
      );
      bodyPitchValid = true;
    }
  }

  return {
    bodyYaw,
    bodyYawSource,
    bodyYawConfidence,
    bodyPitch,
    bodyPitchValid,
  };
}

function shoulderVisibilityOf(sL, sR) {
  return Math.min(sL.visibility, sR.visibility);
}

/**
 * 手臂在镜头方向上的前伸 / 后摆角度。
 *
 * 屏幕角度只描述 x/y 平面；MediaPipe 的姿态 z 越小越靠近镜头，所以
 * 肩 → 肘（或肘 → 腕）的 -dz 就是「向镜头前伸」的量。分母用换算到
 * 「画面宽度」单位后的平面长度，这样 16:9 的 y 不会把角度压扁。
 * 正值 = 手臂向镜头前伸，负值 = 向后摆。
 */
function armForwardAngle(from, to, aspect) {
  const planar = Math.hypot(
    to.x - from.x,
    (to.y - from.y) * aspect
  );
  return (
    (Math.atan2(-(to.z - from.z), Math.max(0.001, planar)) * 180) /
    Math.PI
  );
}

/* ---- 单目 3D 重定向 --------------------------------------------------
 *
 * worldLandmarks 是米制、以髋部为原点的 3D 坐标。用真实检测结果核对过：
 *   x 随画面向右增大（解剖学左侧为 +x）；y 向下为正（肩膀 y < 髋部 y = 0）；
 *   z 负数表示靠近镜头。
 * 这里先镜像并翻到奶龙的身体坐标（x 屏幕右、y 上、z 朝镜头），
 * 再用「肩线右轴 + 肩髋上轴 + 前向」组成玩家的躯干坐标系。
 *
 * 注意：人体「右 × 上」得到的是背后方向，因为 (right, up, forward)
 * 本身是左手系；世界坐标又是右手系（x 画面右、y 下、z 远离镜头）。
 * 所以身体前向必须写成 up × right —— 这一条就是玩家「手往前伸」
 * 时奶龙也跟着往前，而不是往后穿进身体的关键。
 *
 * 直接把摄像头坐标喂给角色，会在玩家转身时转两次；把手臂方向
 * 表示成躯干局部坐标后，角色胸口怎么转，手臂都只跟随玩家相对
 * 自己身体的动作，这才是人形机器人常用的 retarget 做法。
 */
function worldPosePoint(poseResult, index) {
  const point = poseResult?.worldLandmarks?.[0]?.[index];
  if (!point) return null;
  const x = -point.x;
  const y = point.y;
  const z = -point.z;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return {
    x,
    y,
    z,
    visibility: Number.isFinite(point.visibility) ? point.visibility : 1,
  };
}

function vecSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vecDot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecCross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function vecLength(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function vecNormalize(v) {
  const length = vecLength(v);
  if (length < 1e-6) return null;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function retargetFrame(poseResult) {
  const sL = worldPosePoint(poseResult, POSE_LM.leftShoulder);
  const sR = worldPosePoint(poseResult, POSE_LM.rightShoulder);
  if (!sL || !sR || Math.min(sL.visibility, sR.visibility) < 0.5) return null;
  if (vecLength(vecSub(sR, sL)) < 0.12) return null;

  const hL = worldPosePoint(poseResult, POSE_LM.leftHip);
  const hR = worldPosePoint(poseResult, POSE_LM.rightHip);
  const hipsValid = Boolean(
    hL &&
      hR &&
      Math.min(hL.visibility, hR.visibility) >= 0.25 &&
      vecLength(vecSub(hR, hL)) > 0.08
  );
  const shoulderMid = {
    x: (sL.x + sR.x) / 2,
    y: (sL.y + sR.y) / 2,
    z: (sL.z + sR.z) / 2,
  };
  const hipMid = hipsValid
    ? {
        x: (hL.x + hR.x) / 2,
        y: (hL.y + hR.y) / 2,
        z: (hL.z + hR.z) / 2,
      }
    : null;

  // MediaPipe 的 world y 向下为正，所以「身体上轴」的兜底必须是 -y。
  // 写反会让 forward 翻转，玩家把手往前伸时奶龙的手臂反而穿到背后。
  const WORLD_UP = { x: 0, y: -1, z: 0 };
  let up = hipMid ? vecSub(shoulderMid, hipMid) : { ...WORLD_UP };
  if (vecLength(up) < 0.08) up = { ...WORLD_UP };
  up = vecNormalize(up);
  if (!up) return null;

  // 镜像后，用户解剖学右侧出现在屏幕右侧，sR - sL 就是身体右轴。
  let right = vecSub(sR, sL);
  const upComponent = vecDot(right, up);
  right = {
    x: right.x - up.x * upComponent,
    y: right.y - up.y * upComponent,
    z: right.z - up.z * upComponent,
  };
  right = vecNormalize(right);
  if (!right) {
    // 极端侧面时肩线可能几乎和身体上轴重合；用摄像机的 -Z 做一个稳定兜底。
    right = vecNormalize(vecCross(up, { x: 0, y: 0, z: 1 }));
  }
  if (!right) return null;

  // 人体右 × 上 = 背后。奶龙的 +Z 是「朝镜头」＝玩家的身体前方，
  // 所以前向要取 up × right，而不是 right × up（见文件头注释）。
  let forward = vecNormalize(vecCross(up, right));
  if (!forward) return null;
  right = vecNormalize(vecCross(forward, up));
  if (!right) return null;

  return { right, up, forward };
}

/**
 * 肩 → 腕在躯干坐标里的位置，按玩家自己的手臂总长归一化。
 * 这样肘弯得越厉害，目标离肩越近，奶龙也会用同样的弯曲程度。
 * 副产物是肩 → 肘方向，用作 IK 的肘部朝向（pole）。
 */
function armRetarget(poseResult, frame, shoulderIndex, elbowIndex, wristIndex) {
  if (!frame) return null;
  const shoulder = worldPosePoint(poseResult, shoulderIndex);
  const elbow = worldPosePoint(poseResult, elbowIndex);
  const wrist = worldPosePoint(poseResult, wristIndex);
  if (!shoulder || !elbow || !wrist) return null;
  if (Math.min(shoulder.visibility, elbow.visibility, wrist.visibility) < 0.5) return null;

  const upper = vecSub(elbow, shoulder);
  const fore = vecSub(wrist, elbow);
  const wristVec = vecSub(wrist, shoulder);
  const upperLength = vecLength(upper);
  const foreLength = vecLength(fore);
  const wristLength = vecLength(wristVec);
  const total = upperLength + foreLength;
  if (upperLength < 0.06 || foreLength < 0.06 || total < 0.16) return null;
  if (total > 1.5 || upperLength / foreLength > 2.5 || foreLength / upperLength > 2.5) return null;
  // 世界坐标偶尔会在遮挡时把腕拉到离谱的位置，直接退回 2D。
  if (wristLength < total * 0.03 || wristLength > total * 1.25) return null;

  const toLocal = (vector) => ({
    x: vecDot(vector, frame.right) / total,
    y: vecDot(vector, frame.up) / total,
    z: vecDot(vector, frame.forward) / total,
  });
  return {
    target: toLocal(wristVec),
    elbow: toLocal(upper),
  };
}

function armMetrics(
  poseLm,
  poseResult,
  frame,
  shoulderIndex,
  elbowIndex,
  wristIndex,
  aspect
) {
  const shoulder = posePoint(poseLm, shoulderIndex, aspect);
  const elbow = posePoint(poseLm, elbowIndex, aspect);
  const wrist = posePoint(poseLm, wristIndex, aspect);
  if (!shoulder || !elbow || !wrist) return { available: false };
  const visibility = Math.min(
    shoulder.visibility,
    elbow.visibility,
    wrist.visibility
  );
  if (visibility < 0.25 || !shoulder.inFrame || !elbow.inFrame || !wrist.inFrame) {
    return { available: false, visibility };
  }
  const upper = angleFromDown(elbow.x - shoulder.x, elbow.y - shoulder.y);
  const fore = angleFromDown(wrist.x - elbow.x, wrist.y - elbow.y);
  const retarget = armRetarget(
    poseResult,
    frame,
    shoulderIndex,
    elbowIndex,
    wristIndex
  );
  return {
    available: true,
    upper: wrapDeg(upper),
    fore: wrapDeg(fore),
    // z 噪声比 x/y 大，角度限幅后交给 app 做较慢的平滑。
    upperForward: clamp(armForwardAngle(shoulder, elbow, aspect), -75, 75),
    foreForward: clamp(armForwardAngle(elbow, wrist, aspect), -75, 75),
    // 有 worldLandmarks 时，app 用这个 3D 落点接管手臂 IK。
    target: retarget?.target ?? null,
    elbow: retarget?.elbow ?? null,
    visibility,
  };
}

function legMetrics(poseLm, hipIndex, kneeIndex, ankleIndex, aspect) {
  const hip = posePoint(poseLm, hipIndex, aspect);
  const knee = posePoint(poseLm, kneeIndex, aspect);
  const ankle = posePoint(poseLm, ankleIndex, aspect);
  if (!hip || !knee || !ankle) return { available: false };
  const visibility = Math.min(hip.visibility, knee.visibility, ankle.visibility);
  if (visibility < 0.25 || !knee.inFrame || !ankle.inFrame) {
    return { available: false, visibility };
  }
  return {
    available: true,
    hip: wrapDeg(angleFromDown(knee.x - hip.x, knee.y - hip.y)),
    knee: wrapDeg(angleFromDown(ankle.x - knee.x, ankle.y - knee.y)),
    visibility,
  };
}

/**
 * 前臂方向（worldLandmarks 版）。
 *
 * 归一化 landmarks 的 z 在单目下非常不稳：实测一张静止画面里，腕部 z 会在
 * 0.8 的范围内来回跳，用它算出来的「手腕角度」自然一直甩。worldLandmarks
 * 是米制 3D，深度稳定得多（同一段画面里腕部 z 的标准差只有 0.1）。
 *
 * 坐标要和手部关键点保持一致：x 镜像、y 向下、z 不取反——MediaPipe 的两种
 * 坐标都是数值越小越靠近镜头。返回单位向量；数据不可靠时返回 null。
 */
function worldForearm(poseResult, elbowIndex, wristIndex) {
  const elbow = poseResult?.worldLandmarks?.[0]?.[elbowIndex];
  const wrist = poseResult?.worldLandmarks?.[0]?.[wristIndex];
  if (!elbow || !wrist) return null;
  if ((elbow.visibility ?? 1) < 0.3 || (wrist.visibility ?? 1) < 0.3) {
    return null;
  }
  const dir = v3(
    -(wrist.x - elbow.x),
    wrist.y - elbow.y,
    wrist.z - elbow.z
  );
  return v3Normalize(dir);
}

function poseMetrics(poseResult, aspect) {
  const poseLm = poseResult?.landmarks?.[0];
  if (!poseLm || poseLm.length < 29) return null;

  const sL = posePoint(poseLm, POSE_LM.leftShoulder, aspect);
  const sR = posePoint(poseLm, POSE_LM.rightShoulder, aspect);
  if (!sL || !sR) return null;

  const shoulderVisibility = Math.min(sL.visibility, sR.visibility);
  const shoulderMid = { x: (sL.nx + sR.nx) / 2, y: (sL.ny + sR.ny) / 2 };

  // 肩线倾斜：屏幕右侧更低时为正，与 Canvas 顺时针方向一致。
  const torsoLean = lineTiltDeg(sL.x - sR.x, sL.y - sR.y);
  const hL = posePoint(poseLm, POSE_LM.leftHip, aspect);
  const hR = posePoint(poseLm, POSE_LM.rightHip, aspect);
  const body = bodyAngles(sL, sR, hL, hR, aspect);
  const frame = retargetFrame(poseResult);

  return {
    armL: armMetrics(
      poseLm,
      poseResult,
      frame,
      POSE_LM.leftShoulder,
      POSE_LM.leftElbow,
      POSE_LM.leftWrist,
      aspect
    ),
    armR: armMetrics(
      poseLm,
      poseResult,
      frame,
      POSE_LM.rightShoulder,
      POSE_LM.rightElbow,
      POSE_LM.rightWrist,
      aspect
    ),
    legL: legMetrics(poseLm, POSE_LM.leftHip, POSE_LM.leftKnee, POSE_LM.leftAnkle, aspect),
    legR: legMetrics(poseLm, POSE_LM.rightHip, POSE_LM.rightKnee, POSE_LM.rightAnkle, aspect),
    torsoLean: clamp(torsoLean, -35, 35),
    shoulderVisibility,
    shoulderMid,
    wristL: posePoint(poseLm, POSE_LM.leftWrist, aspect),
    wristR: posePoint(poseLm, POSE_LM.rightWrist, aspect),
    elbowL: posePoint(poseLm, POSE_LM.leftElbow, aspect),
    elbowR: posePoint(poseLm, POSE_LM.rightElbow, aspect),
    // 手腕角优先用稳定的米制前臂方向；不可用时才退回归一化坐标。
    forearmL: worldForearm(poseResult, POSE_LM.leftElbow, POSE_LM.leftWrist),
    forearmR: worldForearm(poseResult, POSE_LM.rightElbow, POSE_LM.rightWrist),
    hipL: hL,
    hipR: hR,
    hasShoulders: shoulderVisibility >= 0.25 && sL.inFrame && sR.inFrame,
    hasHips: Boolean(
      hL && hR && Math.min(hL.visibility, hR.visibility) >= 0.25 && hL.inFrame && hR.inFrame
    ),
    ...body,
  };
}

const HAND_FINGERS = [
  [5, 8], // index
  [9, 12], // middle
  [13, 16], // ring
  [17, 20], // pinky
];

function handPoint(landmarks, index, aspect) {
  const point = landmarks[index];
  if (!point) return null;
  return { x: (1 - point.x) * aspect, y: point.y };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---- 三维向量小工具（统一用「画面宽度」单位，避免 aspect 污染角度） ----
const v3 = (x, y, z) => ({ x, y, z });
const v3Sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const v3Dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const v3Cross = (a, b) =>
  v3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
const v3Length = (a) => Math.hypot(a.x, a.y, a.z);
const v3Normalize = (a) => {
  const length = v3Length(a);
  if (!Number.isFinite(length) || length < 1e-8) return null;
  return v3(a.x / length, a.y / length, a.z / length);
};
const CAMERA_Z = v3(0, 0, 1);

function handPoint3(landmarks, index, aspect) {
  const point = landmarks[index];
  if (!point || !Number.isFinite(point.z)) return null;
  return v3(
    1 - point.x,
    point.y / Math.max(0.2, aspect),
    point.z
  );
}

function posePoint3(point, aspect) {
  if (!point || !Number.isFinite(point.z)) return null;
  return v3(point.nx, point.ny / Math.max(0.2, aspect), point.z);
}

function rotateAboutAxis(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = v3Cross(axis, v);
  const d = v3Dot(axis, v);
  return v3(
    v.x * c + k.x * s + axis.x * d * (1 - c),
    v.y * c + k.y * s + axis.y * d * (1 - c),
    v.z * c + k.z * s + axis.z * d * (1 - c)
  );
}

/**
 * 手腕的「相对增量」：手掌相对参考手型多转了多少度。
 *
 * 直接读绝对腕角，在托腮 / 捧腹这类手相对前臂本来就弯了 60° 以上的姿势里
 * 会一直顶在 ±60 的钳位边界：手腕再抬 / 压，输出都是同一个数，看起来就像
 * 没跟上。这里先抵消整条手臂的转动，再看手掌比参考手型多转了多少，不做
 * 绝对角度分解，所以不会饱和，也不会在 90° 附近翻符号。
 *
 * 符号与 wristOrientation 的 flex / dev 一致。twist 恒为 0：前臂旋转在单目下
 * 噪声最大，又最容易顶到钳位，手型交给每个挑战的预设。
 *
 * @param {{h:object, fore:object}} ref   手出现时记录的手掌 / 前臂方向
 * @param {{h:object, l:object, fore:object}} basis 当前帧的手掌 / 掌宽 / 前臂方向
 * @param {'screenLeft'|'screenRight'} side
 * @returns {{flex:number, dev:number, twist:number}} 单位：度
 */
export function wristDeltas(ref, basis, side) {
  const zero = { flex: 0, dev: 0, twist: 0 };
  if (!ref?.h || !ref?.fore || !basis?.h || !basis?.l || !basis?.fore) {
    return zero;
  }
  // 先把参考手掌方向跟着前臂转到当前帧，抵消抬手 / 转胳膊带来的整体旋转。
  let h0 = ref.h;
  const armAxis = v3Cross(ref.fore, basis.fore);
  const armSin = v3Length(armAxis);
  if (armSin > 1e-6) {
    const axis = v3(
      armAxis.x / armSin,
      armAxis.y / armSin,
      armAxis.z / armSin
    );
    const armAngle = Math.atan2(
      armSin,
      clamp(v3Dot(ref.fore, basis.fore), -1, 1)
    );
    h0 = rotateAboutAxis(ref.h, axis, armAngle);
  }
  // 剩下的旋转就是手腕自己转的量，投影到掌宽轴 / 掌面法线上。
  const rot = v3Cross(h0, basis.h);
  const sin = v3Length(rot);
  const cos = clamp(v3Dot(h0, basis.h), -1, 1);
  if (sin < 1e-9) return zero;
  const theta = Math.atan2(sin, cos);
  const axis = v3(rot.x / sin, rot.y / sin, rot.z / sin);
  const sideSign = side === 'screenLeft' ? 1 : -1;
  const palmNormal = v3Normalize(v3Cross(basis.h, basis.l));
  const toDeg = 180 / Math.PI;
  return {
    flex: -theta * v3Dot(axis, basis.l) * sideSign * toDeg,
    dev: palmNormal ? theta * v3Dot(axis, palmNormal) * toDeg : 0,
    twist: 0,
  };
}

/**
 * 手腕三自由度。角度单位是度：
 * - flex 正 = 手掌方向屈腕
 * - dev  正 = 拇指一侧偏腕
 * - twist 正 = 绕前臂旋转
 *
 * 手部关键点只给出手掌朝向；前臂方向必须来自 Pose。看不到前臂时
 * 只给 null，让动画层保持上一帧 / 回中，不能拿手掌姿态冒充手腕角度。
 *
 * 返回值里的 basis 是这一帧的方向基向量，配合 wristFlexDelta 算相对增量。
 */
function wristOrientation(landmarks, pose, side, aspect) {
  const p0 = handPoint3(landmarks, 0, aspect);
  const p5 = handPoint3(landmarks, 5, aspect);
  const p9 = handPoint3(landmarks, 9, aspect);
  const p17 = handPoint3(landmarks, 17, aspect);
  if (!p0 || !p5 || !p9 || !p17) return null;

  const hRaw = v3Sub(p9, p0);
  const lRaw = v3Sub(p5, p17);
  const handLength = v3Length(hRaw);
  const palmSpan = v3Length(lRaw);
  if (handLength < 0.03 || palmSpan < 0.02) return null;
  const h = v3Normalize(hRaw);
  const l = v3Normalize(lRaw);
  if (!h || !l) return null;

  // 纯 2D 输入（z 全为 0）时只修一个「上下弯」也够用，至少手腕不会僵死。
  const zSpread = Math.max(
    Math.abs(landmarks[0].z ?? 0),
    Math.abs(landmarks[5].z ?? 0),
    Math.abs(landmarks[9].z ?? 0),
    Math.abs(landmarks[17].z ?? 0)
  );
  const isFlat = zSpread < 0.002;

  const poseWrist = side === 'screenLeft' ? pose?.wristL : pose?.wristR;
  const poseElbow = side === 'screenLeft' ? pose?.elbowL : pose?.elbowR;
  const wristPoint = posePoint3(poseWrist, aspect);
  const elbowPoint = posePoint3(poseElbow, aspect);
  const poseUsable =
    poseWrist &&
    poseElbow &&
    poseWrist.inFrame &&
    poseElbow.inFrame &&
    ((poseWrist.visibility ?? 0) >= 0.35 || (poseElbow.visibility ?? 0) >= 0.35);

  const worldFore = side === 'screenLeft' ? pose?.forearmL : pose?.forearmR;
  let fore = null;
  let source = 'hand';
  if (worldFore) {
    // 米制前臂方向（worldLandmarks）最稳，优先用它；归一化 z 只做兜底。
    fore = worldFore;
    source = 'pose+hand';
  } else if (poseUsable && wristPoint && elbowPoint) {
    const rawFore = v3Sub(wristPoint, elbowPoint);
    if (v3Length(rawFore) >= 0.05) {
      fore = v3Normalize(rawFore);
      source = 'pose+hand';
    }
  } else if (elbowPoint && poseElbow.inFrame) {
    // Pose 的手腕点被手挡住时，用手部的 H0 当终点；肘部仍然可靠。
    const rawFore = v3Sub(p0, elbowPoint);
    if (v3Length(rawFore) >= 0.05) {
      fore = v3Normalize(rawFore);
      source = 'elbow+hand';
    }
  }
  if (!fore && !isFlat) {
    return {
      flex: null,
      dev: null,
      twist: null,
      bend2D: null,
      basis: null,
      source: 'hand',
      confidence: 0,
    };
  }

  if (isFlat) {
    const f2 = posePoint3(poseWrist, aspect);
    const e2 = posePoint3(poseElbow, aspect);
    if (!f2 || !e2) {
      return {
        flex: null,
        dev: null,
        twist: null,
        bend2D: null,
        basis: null,
        source: 'hand',
        confidence: 0,
      };
    }
    // 这里只用屏幕平面，y 已经换算成宽度单位；叉积的符号仍以「向下为 0」为准。
    const arm2 = v3(f2.x - e2.x, f2.y - e2.y, 0);
    const hand2 = v3(p9.x - p0.x, p9.y - p0.y, 0);
    const bend2D =
      (Math.atan2(
        arm2.x * hand2.y - arm2.y * hand2.x,
        Math.max(1e-8, v3Dot(arm2, hand2))
      ) *
        180) /
      Math.PI;
    return {
      flex: clamp(bend2D, -45, 45),
      dev: 0,
      twist: 0,
      bend2D: clamp(bend2D, -90, 90),
      // 没有 z 时算不出稳定的手掌基向量，增量路径退回到上面的绝对弯腕角。
      basis: null,
      source: '2d',
      confidence: 0.45,
    };
  }

  // 用左右手指数方向建立「掌面法线」，避免左右手镜像后符号反掉：
  // 左手 index→pinky 朝 +x，右手朝 -x；乘 sideSign 后两只手都得到 +z。
  const sideSign = side === 'screenLeft' ? 1 : -1;
  // 两手的 index→pinky 方向相反；乘 sideSign 后掌面法线在自然姿势都朝 +z。
  const nRaw = v3Cross(h, l);
  const palmNormal = v3Normalize(nRaw);
  if (!palmNormal) return null;
  const n = v3(
    palmNormal.x * sideSign,
    palmNormal.y * sideSign,
    palmNormal.z * sideSign
  );

  const cosA = clamp(v3Dot(fore, h), -1, 1);
  const axis = v3Cross(fore, h);
  const flex =
    -(
      (Math.atan2(v3Dot(axis, l), cosA) * 180) /
      Math.PI
    ) * sideSign;
  const dev =
    ((Math.atan2(v3Dot(axis, n), cosA) * 180) / Math.PI) * sideSign;

  // 前臂方向在像平面上的垂直方向，作为 twist 的零位。
  // 手臂自然下垂时它正好是水平方向，手掌正对镜头 twist = 0。
  let lateralRef = v3Normalize(v3Cross(fore, CAMERA_Z));
  if (!lateralRef) lateralRef = v3Normalize(v3Cross(fore, v3(1, 0, 0)));
  let twist = 0;
  if (lateralRef) {
    lateralRef = v3(
      lateralRef.x * -sideSign,
      lateralRef.y * -sideSign,
      lateralRef.z * -sideSign
    );
    twist =
      (Math.atan2(
        v3Dot(v3Cross(lateralRef, l), fore),
        v3Dot(lateralRef, l)
      ) *
        180) /
      Math.PI;
  }

  const confidence =
    clamp01(Math.min(1, palmSpan / 0.12)) *
    clamp01(Math.min(1, handLength / 0.18)) *
    (poseUsable ? 1 : 0.6);
  return {
    flex: clamp(flex, -60, 60),
    dev: clamp(dev, -45, 45),
    twist: clamp(twist, -60, 60),
    bend2D: null,
    basis: { h, l, fore },
    source,
    confidence,
  };
}

function handFingerState(landmarks, aspect) {
  const wrist = handPoint(landmarks, 0, aspect);
  if (!wrist) {
    return { openness: null, fingers: null, thumb: null };
  }
  const fingers = HAND_FINGERS.map(([mcpIndex, tipIndex]) => {
    const mcp = handPoint(landmarks, mcpIndex, aspect);
    const tip = handPoint(landmarks, tipIndex, aspect);
    if (!mcp || !tip) return 0;
    const base = Math.max(1e-4, distance(mcp, wrist));
    const reach = distance(tip, wrist);
    // 张开时指尖离手腕约为掌指距离的 2 倍；握拳时接近 1 倍。
    return smoothstep(1.15, 2.0, reach / base);
  });

  const thumbBase = handPoint(landmarks, 2, aspect);
  const thumbTip = handPoint(landmarks, 4, aspect);
  let thumb = 0;
  if (thumbBase && thumbTip) {
    const base = Math.max(1e-4, distance(thumbBase, wrist));
    thumb = smoothstep(1.05, 1.8, distance(thumbTip, wrist) / base);
  }

  const openness = clamp01(
    fingers.reduce((sum, value) => sum + value, 0) / fingers.length
  );
  return { openness, fingers, thumb };
}

function handAnchors(center, face) {
  if (!face?.anchors) {
    return {
      distChin: null,
      distBelly: null,
      distHeadLeft: null,
      distHeadRight: null,
    };
  }
  const { chin, belly, headLeft, headRight, faceHeight } = face.anchors;
  const scale = Math.max(1e-4, faceHeight);
  return {
    distChin: distance(center, chin) / scale,
    distBelly: distance(center, belly) / scale,
    distHeadLeft: distance(center, headLeft) / scale,
    distHeadRight: distance(center, headRight) / scale,
  };
}

function makeHand(center, face, side, extra = {}) {
  const anchors = handAnchors(center, face);
  return {
    present: true,
    fromPose: false,
    side,
    center,
    ...anchors,
    distHead: side === 'screenLeft' ? anchors.distHeadLeft : anchors.distHeadRight,
    openness: null,
    fingers: null,
    thumb: null,
    wrist: null,
    ...extra,
  };
}

function extractHands(handResult, pose, face, aspect) {
  const detected = [];
  for (const landmarks of handResult?.landmarks ?? []) {
    if (!Array.isArray(landmarks) || landmarks.length < 21) continue;
    const palmIndices = [0, 5, 9, 13, 17];
    const points = palmIndices
      .map((index) => handPoint(landmarks, index, aspect))
      .filter(Boolean);
    if (!points.length) continue;
    const center = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
    const fingerState = handFingerState(landmarks, aspect);
    detected.push({ center, ...fingerState, landmarks });
  }

  detected.sort((a, b) => a.center.x - b.center.x);
  const midX = face?.anchors?.center?.x ?? 0.5 * aspect;
  let screenLeft = null;
  let screenRight = null;

  const makeDetectedHand = (hand, side) => {
    const { landmarks, ...visible } = hand;
    return makeHand(hand.center, face, side, {
      ...visible,
      wrist: wristOrientation(landmarks, pose, side, aspect),
    });
  };

  // Use pose wrist identity, so crossing the body midline never swaps fingers.
  const wristCost = (hand, wrist) => {
    if (!wrist?.inFrame || wrist.visibility < 0.5) return null;
    const point = handPoint(hand.landmarks, 0, aspect);
    return point ? Math.hypot(point.x - wrist.x, point.y - wrist.y) : null;
  };
  const assignmentCost = (left, right) => {
    const costs = [wristCost(left, pose?.wristL), wristCost(right, pose?.wristR)]
      .filter((value) => value != null);
    return costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
  };

  if (detected.length >= 2) {
    const direct = assignmentCost(detected[0], detected[1]);
    const crossed = assignmentCost(detected[1], detected[0]);
    if (direct != null && crossed + 0.02 < direct) detected.reverse();
    screenLeft = makeDetectedHand(detected[0], 'screenLeft');
    screenRight = makeDetectedHand(detected[1], 'screenRight');
  } else if (detected.length === 1) {
    const hand = detected[0];
    const leftCost = wristCost(hand, pose?.wristL);
    const rightCost = wristCost(hand, pose?.wristR);
    let side = hand.center.x < midX ? 'screenLeft' : 'screenRight';
    if (leftCost != null && rightCost != null && Math.abs(leftCost - rightCost) > 0.02) {
      side = leftCost < rightCost ? 'screenLeft' : 'screenRight';
    } else if (leftCost != null && leftCost < 0.12 && rightCost == null) {
      side = 'screenLeft';
    } else if (rightCost != null && rightCost < 0.12 && leftCost == null) {
      side = 'screenRight';
    }
    if (side === 'screenLeft') {
      screenLeft = makeDetectedHand(hand, side);
    } else {
      screenRight = makeDetectedHand(hand, side);
    }
  }

  // 手部模型看不到手时，用姿态里的手腕位置兜底定位；
  // 这种情况下只有位置分，没有手指开合分。
  if (!screenLeft && pose?.wristL?.inFrame && pose.wristL.visibility >= 0.3) {
    const center = { x: pose.wristL.x, y: pose.wristL.y };
    screenLeft = makeHand(center, face, 'screenLeft', {
      fromPose: true,
    });
  }
  if (!screenRight && pose?.wristR?.inFrame && pose.wristR.visibility >= 0.3) {
    const center = { x: pose.wristR.x, y: pose.wristR.y };
    screenRight = makeHand(center, face, 'screenRight', {
      fromPose: true,
    });
  }

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

/**
 * @param {object|null} faceResult FaceLandmarker.detectForVideo 的返回
 * @param {object|null} poseResult PoseLandmarker.detectForVideo 的返回
 * @param {object|null} handResult HandLandmarker.detectForVideo 的返回
 * @param {number} aspect videoWidth / videoHeight
 */
export function extractMetrics(
  faceResult,
  poseResult,
  handResult = null,
  aspect = 16 / 9
) {
  const face = faceMetrics(faceResult, aspect);
  const pose = poseMetrics(poseResult, aspect);
  const hands = extractHands(handResult, pose, face, aspect);

  const expr = face?.expr ?? {
    mouthOpen: 0,
    smile: 0,
    squint: 0,
    brow: 0,
    headTilt: 0,
    headYaw: 0,
    headPitch: 0,
  };

  // 躯干朝向：肩/髋 3D 有效就用姿态，否则若脸可见就按头部的 35% 做弱代理。
  // 头部代理可以避免「人只露脸时身体永远像一块木板」，但幅度必须小。
  let bodyYaw = 0;
  let bodyYawSource = 'none';
  if (pose?.bodyYawSource && pose.bodyYawSource !== 'none') {
    bodyYaw = pose.bodyYaw;
    bodyYawSource = pose.bodyYawSource;
  } else if (face) {
    bodyYaw = clamp(expr.headYaw * 0.35, -20, 20);
    bodyYawSource = 'headProxy';
  }
  const bodyPitchValid = Boolean(pose?.bodyPitchValid);
  const bodyPitch = bodyPitchValid ? pose.bodyPitch : 0;

  const wristLeft = hands?.screenLeft?.wrist ?? null;
  const wristRight = hands?.screenRight?.wrist ?? null;

  return {
    face,
    pose,
    hands,
    hasFace: Boolean(face),
    hasPose: Boolean(pose?.hasShoulders),
    expr,
    poseValues: {
      armL: pose?.armL?.available ? pose.armL.upper : 0,
      foreL: pose?.armL?.available ? pose.armL.fore : 0,
      armLForward: pose?.armL?.available ? pose.armL.upperForward : 0,
      foreLForward: pose?.armL?.available ? pose.armL.foreForward : 0,
      armLTarget: pose?.armL?.target ?? null,
      armLElbow: pose?.armL?.elbow ?? null,
      armR: pose?.armR?.available ? pose.armR.upper : 0,
      foreR: pose?.armR?.available ? pose.armR.fore : 0,
      armRForward: pose?.armR?.available ? pose.armR.upperForward : 0,
      foreRForward: pose?.armR?.available ? pose.armR.foreForward : 0,
      armRTarget: pose?.armR?.target ?? null,
      armRElbow: pose?.armR?.elbow ?? null,
      torsoLean: pose?.hasShoulders ? pose.torsoLean : 0,
      legL: pose?.legL?.available ? pose.legL.hip : 0,
      kneeL: pose?.legL?.available ? pose.legL.knee : 0,
      legR: pose?.legR?.available ? pose.legR.hip : 0,
      kneeR: pose?.legR?.available ? pose.legR.knee : 0,
      bodyYaw,
      bodyPitch,
    },
    availability: {
      face: Boolean(face),
      headYaw: Boolean(face?.headSource && face.headSource !== 'none'),
      headPitch: Boolean(
        face?.headSource === 'matrix' || face?.headSource === 'geometry'
      ),
      bodyYaw: bodyYawSource !== 'none',
      bodyPitch: bodyPitchValid,
      wristL: Boolean(wristLeft && wristLeft.flex != null),
      wristR: Boolean(wristRight && wristRight.flex != null),
      armL: Boolean(pose?.armL?.available),
      armR: Boolean(pose?.armR?.available),
      torso: Boolean(pose?.hasShoulders),
      legL: Boolean(pose?.legL?.available),
      legR: Boolean(pose?.legR?.available),
      hands: Boolean(hands?.any),
      handLeft: Boolean(hands?.screenLeft),
      handRight: Boolean(hands?.screenRight),
    },
    bodyYawSource,
    bodyPitchValid,
    raw: {
      faceResult,
      poseResult,
      handResult,
      pose,
      shoulderMid: pose?.shoulderMid ?? { x: 0.5, y: 0.5 },
    },
  };
}

/** 指数平滑，dt 单位秒；tau 越大越平滑。 */
export class Smoother {
  constructor(tau = 0.14) {
    this.tau = tau;
    this.values = new Map();
  }

  update(key, value, dt, tau = this.tau) {
    if (!Number.isFinite(value)) return this.get(key, 0);
    const alpha = 1 - Math.exp(-Math.max(0, dt) / Math.max(0.001, tau));
    const previous = this.values.get(key);
    const next =
      previous == null || !Number.isFinite(previous)
        ? value
        : previous + (value - previous) * alpha;
    this.values.set(key, next);
    return next;
  }

  updateAngle(key, value, dt, tau = this.tau) {
    if (!Number.isFinite(value)) return this.get(key, 0);
    const previous = this.values.get(key);
    if (previous == null || !Number.isFinite(previous)) {
      this.values.set(key, value);
      return value;
    }
    const alpha = 1 - Math.exp(-Math.max(0, dt) / Math.max(0.001, tau));
    const delta = wrapDeg(value - previous);
    const next = wrapDeg(previous + delta * alpha);
    this.values.set(key, next);
    return next;
  }

  // Keep tiny tremors quiet but let deliberate arm movements catch up quickly.
  updateMotionAngle(key, value, dt, tau = this.tau) {
    const previous = this.get(key, value);
    const delta = Math.abs(wrapDeg(value - previous));
    const response = tau + (0.055 - tau) * smoothstep(4, 35, delta);
    return this.updateAngle(key, value, dt, response);
  }

  get(key, fallback = 0) {
    return this.values.has(key) ? this.values.get(key) : fallback;
  }

  reset() {
    this.values.clear();
  }
}
