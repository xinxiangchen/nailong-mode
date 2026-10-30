/**
 * 奶龙 3D 形象。
 *
 * 参考用户提供的三张奶龙图重新建模：
 * - 一个连续的、上窄下宽的黄色软糖身体，没有角和尾巴；
 * - 正面一块柔边的奶白色肚皮（顶点色，跟着身体一起变形）；
 * - 大号绿色眼睛、闭眼时变成弯弯的笑眼；
 * - 小嘴一条线，张嘴时变成大嘴、上排牙 + 舌头；
 * - 灰绿色的双手，四指 + 拇指可随 MediaPipe 的开合度抓握；
 * - 短腿和圆脚掌。
 *
 * 身体是 SkinnedMesh：髋、脊柱、胸、颈、头五根骨骼控制身体和头；
 * 脸挂在头骨上，手臂挂在胸骨上，腿挂在根节点上，
 * 因此表情、歪头、弯腰、挥手、抬脚都会真正带动整个 3D 模型。
 *
 * 只在浏览器里运行；Three.js 已放在 vendor/three/。
 */

import * as THREE from '../vendor/three/three.module.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const damp = (current, target, rate, dt) =>
  current + (target - current) * (1 - Math.exp(-Math.max(0.001, dt) * rate));

// 颜色直接从三张参考图上取样再往亮处提一点：参考图的身体是奶油柠檬黄，
// 肚子是偏暖的米茶色，手是带绿调的橄榄棕。旧版的灰绿手和接近纯白的
// 肚子是「不像」最扎眼的两处。
const COLORS = {
  // ACES 色调映射会把颜色整体往白里拉，所以基础色要比参考图的成品色更浓：
  // 直接拿取样色 #efc24e 当材质色，渲出来会变成发灰的奶油白。
  body: '#F7BC22',
  bodyTop: '#FFD648',
  bodyBottom: '#D4961C',
  // 参考图的肚皮是一整块很亮的奶白，不是偏茶的土黄；旧色叠上阴影
  // 以后整只奶龙发灰，看着像没洗干净。保留一点暖黄，别调成冷白。
  belly: '#E9CE96',
  hand: '#6F6045',
  eyeRim: '#3D3A19',
  sclera: '#91B156',
  iris: '#7A9A45',
  pupil: '#0A0904',
  mouthRim: '#24070B',
  mouthInner: '#1E0508',
  tongue: '#451016',
  teeth: '#FBF3DC',
  mouthLine: '#5A3A12',
};

/* ------------------------------------------------------------------ */
/* 小工具                                                             */
/* ------------------------------------------------------------------ */

function sphere(radius, material, width = 28, height = 18) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, width, height),
    material
  );
}

function capsule(radius, length, material, radialSegments = 18) {
  return new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, length, 6, radialSegments),
    material
  );
}

function setOpacity(material, opacity) {
  const next = clamp01(opacity);
  if (Math.abs(material.opacity - next) < 0.001) return;
  material.opacity = next;
  const transparent = next < 0.999;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.depthWrite = next > 0.55;
}

function radialTexture(size, stops) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* ------------------------------------------------------------------ */
/* 灯光和环境                                                         */
/* ------------------------------------------------------------------ */

function makeStudioEnvironment(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#fffdf4');
  sky.addColorStop(0.46, '#fff3cd');
  sky.addColorStop(1, '#d9b778');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 几块柔和的摄影棚灯，让黄色表面有圆润的高光。
  const lights = [
    [300, 130, 190, 'rgba(255,255,255,0.95)'],
    [760, 90, 150, 'rgba(255,250,225,0.72)'],
    [880, 310, 210, 'rgba(255,236,190,0.5)'],
    [170, 380, 180, 'rgba(255,239,205,0.28)'],
  ];
  for (const [x, y, radius, color] of lights) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, color);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromEquirectangular(texture);
  pmrem.dispose();
  texture.dispose();
  return target.texture;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff6dd, 0xb8893d, 0.4));

  const key = new THREE.DirectionalLight(0xfff0cc, 2.65);
  key.position.set(-3.4, 5.0, 4.4);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xd9e8ff, 0.55);
  fill.position.set(4.0, 2.2, 2.8);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd889, 1.0);
  rim.position.set(1.4, 3.6, -4.4);
  scene.add(rim);

  const face = new THREE.PointLight(0xfff4d8, 0.5, 8, 2);
  face.position.set(0.4, 2.2, 4.0);
  scene.add(face);
}

function addGroundShadow(scene) {
  const texture = radialTexture(256, [
    [0, 'rgba(77, 50, 13, 0.32)'],
    [0.45, 'rgba(77, 50, 13, 0.16)'],
    [1, 'rgba(77, 50, 13, 0)'],
  ]);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 0.95,
    color: 0x3a2a15,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.7), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.012, 0.13);
  mesh.renderOrder = -1;
  scene.add(mesh);
  return mesh;
}

/* ------------------------------------------------------------------ */
/* 身体几何与蒙皮                                                     */
/* ------------------------------------------------------------------ */

/**
 * 融合身体的截面控制线：(高度, 半宽, 半深, 截面前后偏移)。
 *
 * 参考图里奶龙不是一颗球：肚子往下坠、胸口略收、脸是一块偏方的圆角
 * 软糖，头顶又轻轻收圆。旧版只按「半径」旋转成 Lathe，所以每个高度
 * 都是正圆，正面和侧面看都太像气球。这里改成逐环放样，横向、纵深和
 * 前后位置都能独立变化，头和肚子才会连成一只「豆」。高度 0.34 是身体
 * 底缘，下面留出短腿；2.22 是头顶。
 */
const BODY_PROFILE = [
  [0.34, 0.0, 0.0, 0.05],
  [0.36, 0.24, 0.22, 0.06],
  [0.4, 0.38, 0.33, 0.07],
  [0.46, 0.49, 0.42, 0.08],
  [0.52, 0.57, 0.475, 0.09],
  [0.58, 0.615, 0.505, 0.095],
  [0.64, 0.635, 0.525, 0.1],
  [0.7, 0.66, 0.545, 0.105],
  [0.78, 0.7, 0.57, 0.11],
  [0.86, 0.73, 0.59, 0.112],
  [0.93, 0.75, 0.6, 0.112],
  [1.0, 0.75, 0.6, 0.108],
  [1.08, 0.735, 0.59, 0.1],
  [1.16, 0.72, 0.575, 0.088],
  [1.24, 0.7, 0.555, 0.072],
  [1.32, 0.675, 0.53, 0.055],
  [1.4, 0.655, 0.51, 0.04],
  // 颈根不再收紧成一圈「雪人接缝」：肩膀到脸颊的宽度连续变化，
  // 头顶则收得更早、更高，避免一颗又矮又宽的圆扣子。
  [1.46, 0.645, 0.5, 0.032],
  [1.52, 0.63, 0.48, 0.026],
  // 下半张脸略微向前鼓出，做出奶龙的短吻，而不是把五官贴在平面上。
  // 鼓包要很缓：前移量一大，嘴上那圈皮肤就会折出一道横贯整张脸的
  // 硬边，像脸皮裂开。
  [1.58, 0.6, 0.485, 0.034],
  [1.64, 0.565, 0.49, 0.05],
  [1.7, 0.555, 0.495, 0.064],
  [1.76, 0.55, 0.492, 0.066],
  [1.82, 0.542, 0.486, 0.06],
  [1.88, 0.53, 0.476, 0.05],
  [1.94, 0.512, 0.462, 0.044],
  [2.0, 0.487, 0.45, 0.037],
  // 头顶要有圆拱，不能顺着控制点收成尖帽。
  [2.06, 0.455, 0.43, 0.028],
  [2.11, 0.415, 0.4, 0.019],
  [2.16, 0.362, 0.357, 0.011],
  [2.2, 0.292, 0.295, 0.006],
  [2.23, 0.185, 0.19, 0.003],
  [2.26, 0.0, 0.0, 0.0],
];

const BODY_RINGS = 160;
const BODY_SIDES = 112;

// 三张参考共同的比例：小头、宽肩、圆腹。用头骨统一缩放脸皮与五官，
// 蒙皮权重将变化平滑接入肩胸，不能单独缩眼睛或把整个身体压瘦。
const HEAD_SCALE = 0.78;
const HEAD_PIVOT_Y = 1.6;
const NECK_Y = 1.42;
const CHEST_Y = 1.14;
const SHOULDER_Y = 1.47;

/**
 * 单调三次 Hermite 插值。普通的 Catmull-Rom/SplineCurve 会在控制点之间
 * 过冲，肚子或头侧面就容易鼓出一个不属于参考图的包。这里用 Fritsch–
 * Carlson 方式限制切线，保证半宽、半深和前后偏移都不会越过控制值。
 */
function monotoneInterpolator(values) {
  const n = values.length;
  const delta = new Array(n - 1);
  const slope = new Array(n);
  for (let i = 0; i < n - 1; i += 1) delta[i] = values[i + 1] - values[i];

  slope[0] = delta[0] ?? 0;
  slope[n - 1] = delta[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i += 1) {
    const before = delta[i - 1];
    const after = delta[i];
    if (before * after <= 0) {
      slope[i] = 0;
    } else {
      const average = (before + after) * 0.5;
      slope[i] =
        Math.sign(average) *
        Math.min(
          Math.abs(average),
          Math.abs(before) * 3,
          Math.abs(after) * 3
        );
    }
  }

  return (u) => {
    if (u <= 0) return values[0];
    if (u >= n - 1) return values[n - 1];
    const index = Math.min(n - 2, Math.floor(u));
    const t = u - index;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return (
      h00 * values[index] +
      h10 * slope[index] +
      h01 * values[index + 1] +
      h11 * slope[index + 1]
    );
  };
}

// 脸颊两侧比正圆更「方」一点，眼窝和嘴角所在的正面则保持饱满。
// 指数只增加一点点，避免真的变成方盒子。
function bodySectionExponent(y) {
  let exponent = 2;
  exponent +=
    0.12 *
    smoothstep(1.58, 1.66, y) *
    (1 - smoothstep(1.9, 2.0, y));
  exponent +=
    0.12 *
    smoothstep(1.34, 1.42, y) *
    (1 - smoothstep(1.54, 1.62, y));
  return exponent;
}

/**
 * 脸的表面：五官不能再是一块贴在球前面的平板。
 *
 * 这里复用身体的逐环控制线，按高度反查半宽、半深和前后偏移，
 * 再代入超椭圆截面的正面公式。嘴巴的每个顶点都贴着这张曲面走，
 * 因此大嘴会自然地绕过脸颊，而不是像贴纸一样翘边。
 */
const bodySurface = (() => {
  const heights = monotoneInterpolator(BODY_PROFILE.map((row) => row[0]));
  const widths = monotoneInterpolator(BODY_PROFILE.map((row) => row[1]));
  const depths = monotoneInterpolator(BODY_PROFILE.map((row) => row[2]));
  const forwards = monotoneInterpolator(BODY_PROFILE.map((row) => row[3]));
  return { heights, widths, depths, forwards };
})();

function bodyProfileAt(y) {
  const maxU = BODY_PROFILE.length - 1;
  let low = 0;
  let high = maxU;
  // 高度控制线是单调递增的，二分就能找到对应的插值参数 u。
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) * 0.5;
    if (bodySurface.heights(mid) < y) low = mid;
    else high = mid;
  }
  const u = (low + high) * 0.5;
  return {
    halfWidth: Math.max(0, bodySurface.widths(u)),
    halfDepth: Math.max(0, bodySurface.depths(u)),
    centerZ: bodySurface.forwards(u),
    exponent: bodySectionExponent(y),
  };
}

function faceSurfaceZ(x, worldY) {
  const profile = bodyProfileAt(worldY);
  if (profile.halfWidth < 1e-5 || profile.halfDepth < 1e-5) {
    return profile.centerZ;
  }
  const ratio = Math.min(1, Math.abs(x) / profile.halfWidth);
  const exponent = profile.exponent;
  const power = 2 / exponent;
  // x = halfWidth * sin(θ)^power，反推出 θ 后取正面 z。
  const sinTheta = Math.pow(ratio, exponent / 2);
  const cosTheta = Math.sqrt(Math.max(0, 1 - sinTheta * sinTheta));
  return profile.centerZ + profile.halfDepth * Math.pow(cosTheta, power);
}

/**
 * 五段蒙皮权重：髋 → 脊柱 → 胸 → 颈 → 头。
 *
 * 肩线 (1.47) 落在胸口，保证手臂挂在胸骨上时和身体同进同退；
 * 侧后方使用宽过渡带分散颈部弯曲，避免拉长后在肩颈形成折角。
 * 每段只保留最大四个影响，再归一化——这是 three.js 蒙皮属性的硬限制。
 *
 * frontness：0 = 侧后方，1 = 正脸。正脸的过渡带会往下降，理由见下面。
 */
function bodyWeights(y, frontness = 0) {
  const toSpine = smoothstep(0.52, 0.76, y);
  const toChest = smoothstep(0.9, 1.08, y);
  // 正面单独一套过渡：下巴和嘴连成一块，头颈到胸口连续衔接。五官刚
  // 性挂在头骨上，脸皮要是还留在胸口，一仰头脸皮就比嘴巴少转十几度，
  // 黑的嘴会被黄的脸顶穿，正面看就是嘴里漏出一片黄。所以越靠正脸，
  // 越早把这块皮肤交给头骨。侧后方保持原样，肩膀才不会被转头拧走。
  const toNeck = smoothstep(
    lerp(1.34, 1.06, frontness),
    lerp(1.70, 1.2, frontness),
    y
  );
  const toHead = smoothstep(
    lerp(1.45, 1.14, frontness),
    lerp(1.86, 1.32, frontness),
    y
  );
  const raw = [
    1 - toSpine,
    toSpine * (1 - toChest),
    toChest * (1 - toNeck),
    toNeck * (1 - toHead),
    toHead,
  ];

  return raw
    .map((weight, bone) => ({ bone, weight }))
    .filter((entry) => entry.weight > 1e-5)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
}

function buildBodyGeometry() {
  const rows = BODY_PROFILE.length;
  const interpolateWidth = monotoneInterpolator(
    BODY_PROFILE.map((row) => row[1])
  );
  const interpolateDepth = monotoneInterpolator(
    BODY_PROFILE.map((row) => row[2])
  );
  const interpolateForward = monotoneInterpolator(
    BODY_PROFILE.map((row) => row[3])
  );
  const interpolateHeight = monotoneInterpolator(
    BODY_PROFILE.map((row) => row[0])
  );

  const rowCount = BODY_RINGS + 1;
  const vertexCount = rowCount * BODY_SIDES;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const skinIndices = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);

  const bodyColor = new THREE.Color(COLORS.body);
  const topColor = new THREE.Color(COLORS.bodyTop);
  const bottomColor = new THREE.Color(COLORS.bodyBottom);
  const bellyColor = new THREE.Color(COLORS.belly);

  for (let ring = 0; ring < rowCount; ring += 1) {
    const u = (ring / BODY_RINGS) * (rows - 1);
    const y = interpolateHeight(u);
    const halfWidth = Math.max(0, interpolateWidth(u));
    const halfDepth = Math.max(0, interpolateDepth(u));
    const centerZ = interpolateForward(u);
    const exponent = bodySectionExponent(y);
    const power = 2 / exponent;

    for (let side = 0; side < BODY_SIDES; side += 1) {
      const angle = (side / BODY_SIDES) * TAU;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      // θ = 0 在正面：先绕 Y 轴走一圈，再用超椭圆把圆截面往圆角方形推。
      const x = halfWidth * Math.sign(sin) * Math.pow(Math.abs(sin), power);
      const z =
        centerZ + halfDepth * Math.sign(cos) * Math.pow(Math.abs(cos), power);
      // 正面的顶点是「下巴」，权重按 frontness 提前交给头骨。
      // 过渡带拉得很宽（从后侧就开始给），转头时这一圈是慢慢拧过去的，
      // 不会在腮帮子上折出一道硬边。
      const weights = bodyWeights(y, smoothstep(-0.3, 0.5, z));
      const vertex = ring * BODY_SIDES + side;
      const offset = vertex * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;

      const color = bodyColor.clone();
      color.lerp(topColor, smoothstep(1.5, 2.08, y) * 0.26);
      color.lerp(bottomColor, (1 - smoothstep(0.34, 0.76, y)) * 0.46);

      // 奶米色肚皮：前侧一块柔软的竖椭圆。参考图的肚子几乎铺满整个
      // 正面、从胸口一直垂到腿根，颜色也比身体亮一大截；早先收得太小，
      // 远看只是肚子上一团灰印子。
      const dx = x / 0.6;
      const dy = (y - 0.82) / 0.6;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const front = smoothstep(-0.16, 0.28, z);
      const bellyMask =
        (1 - smoothstep(0.78, 1.06, distance)) *
        front *
        smoothstep(0.3, 0.4, y);
      color.lerp(bellyColor, bellyMask * 0.97);

      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;

      const base = vertex * 4;
      let total = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const entry = weights[slot];
        skinIndices[base + slot] = entry ? entry.bone : 0;
        const weight = entry ? entry.weight : 0;
        skinWeights[base + slot] = weight;
        total += weight;
      }
      if (total > 0) {
        for (let slot = 0; slot < 4; slot += 1) {
          skinWeights[base + slot] /= total;
        }
      }
    }
  }

  const indices = [];
  for (let ring = 0; ring < BODY_RINGS; ring += 1) {
    for (let side = 0; side < BODY_SIDES; side += 1) {
      const nextSide = (side + 1) % BODY_SIDES;
      const a = ring * BODY_SIDES + side;
      const b = ring * BODY_SIDES + nextSide;
      const c = (ring + 1) * BODY_SIDES + nextSide;
      const d = (ring + 1) * BODY_SIDES + side;
      indices.push(a, b, d, c, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute(
    'skinIndex',
    new THREE.BufferAttribute(skinIndices, 4)
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.BufferAttribute(skinWeights, 4)
  );
  geometry.computeVertexNormals();
  return geometry;
}

/* ------------------------------------------------------------------ */
/* 脸                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 贴在脸上的眼睛色块。
 *
 * 奶龙的脸横向曲率很大：从眼中心往外 0.1，皮肤就往后退了 0.05。
 * 用压扁的球做眼珠，外眼角一定会翘出脸皮，屏幕上不是绿眼袋就是
 * 一圈浮起来的边。参考图的绿眼睛本来就是画在皮肤上的平面色块，
 * 所以这里直接按高度取脸皮上的 z，把每层眼睛做成一圈同心圆盘；
 * 眼皮、瞳孔、高光按 lift 一层层垫高，看起来是平的，又不会穿模。
 */
function eyeSurfaceZ(x, y) {
  return faceSurfaceZ(x, HEAD_PIVOT_Y + y);
}

function eyeDiscGeometry(centerX, centerY, rx, ry, tilt, lift) {
  const rings = 5;
  const segments = 56;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const positions = [];
  const indices = [];

  // 圆盘顶点先旋转出「外眼角略低」的倾斜，再贴回脸皮。
  const place = (angle, scale) => {
    const du = Math.cos(angle) * rx * scale;
    const dv = Math.sin(angle) * ry * scale;
    const lx = du * cosTilt - dv * sinTilt;
    const ly = du * sinTilt + dv * cosTilt;
    return [lx, ly, eyeSurfaceZ(centerX + lx, centerY + ly) + lift];
  };

  for (let ring = 0; ring < rings; ring += 1) {
    const scale = 1 - ring / rings;
    for (let i = 0; i < segments; i += 1) {
      const point = place((i / segments) * TAU, scale);
      positions.push(point[0], point[1], point[2]);
    }
  }
  const centerIndex = positions.length / 3;
  const centerZ = eyeSurfaceZ(centerX, centerY) + lift;
  positions.push(0, 0, centerZ);

  for (let ring = 0; ring < rings - 1; ring += 1) {
    const outer = ring * segments;
    const inner = (ring + 1) * segments;
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      indices.push(
        outer + i,
        outer + next,
        inner + next,
        outer + i,
        inner + next,
        inner + i
      );
    }
  }
  const last = (rings - 1) * segments;
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    indices.push(last + i, last + next, centerIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 笑眼是一道细长的黑色弯月，不是两只黑杏仁。
 *
 * 参考图里的闭眼只有眼睛本身那么宽，中间略厚、两端收尖，弧高很浅；
 * 早先按「大浓眉」的尺寸做，一笑就像贴了两条黑香蕉在脸上。
 * 弧线同样按高度贴回脸皮，脸上曲率再大也不会有一端翘起来。
 */
function closedEyeArcGeometry(side, centerX, centerY, tilt) {
  const halfWidth = side < 0 ? 0.134 : 0.128;
  const rise = side < 0 ? 0.052 : 0.047;
  const baseY = side < 0 ? -0.004 : -0.007;
  const thickness = side < 0 ? 0.038 : 0.033;
  const samples = 30;
  const positions = [];
  const indices = [];
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const lift = 0.014;

  const push = (du, dv) => {
    const lx = du * cosTilt - dv * sinTilt;
    const ly = du * sinTilt + dv * cosTilt;
    positions.push(
      lx,
      ly,
      eyeSurfaceZ(centerX + lx, centerY + ly) + lift
    );
  };

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const bulge = Math.sin(Math.PI * t);
    const x = lerp(-halfWidth, halfWidth, t);
    const arch = Math.pow(bulge, 0.76);
    const y = baseY + rise * arch;
    // 参考图的闭眼弧两端收得几乎成尖，中间才略微鼓起来；
    // 端头留得太粗会读成眉毛。
    const halfThickness =
      thickness * (0.06 + 0.94 * Math.pow(bulge, 0.55)) * 0.5;
    // 每段先写上面一点，再写下面一点，扫成一条带子。
    push(x, y + halfThickness * 1.04);
    push(x, y - halfThickness);
    if (i > 0) {
      const a = (i - 1) * 2;
      // 逆时针绕序，正面朝外；反过来会被背面剔除掉，笑眼整条消失。
      indices.push(a, a + 3, a + 2, a, a + 1, a + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const EYE_X = 0.224;
const EYE_LOCAL_Y = 0.288;
// 外眼角略低，带一点困倦；反方向会立刻读成怒气。
const eyeTilt = (side) => -side * 0.045;

function createEye(side, materials) {
  const group = new THREE.Group();
  const centerX = side * EYE_X;
  const centerY = EYE_LOCAL_Y;
  group.position.set(centerX, centerY, 0);
  const tilt = eyeTilt(side);

  const open = new THREE.Group();
  group.add(open);

  // 参考图的眼白其实是一整块浅草绿的圆盘，没有白色巩膜；
  // 黑色瞳孔约占整只眼睛的一半，外面再套一圈更深的绿。
  //
  // 五官与头骨一起缩放，保留参考图的草绿色眼盘。早先按
  // 「大眼萌」放大到占头宽四分之一，整张脸立刻变成另一种角色；
  // 现在收到头宽五分之一左右，瞳孔别铺满，留一圈浅草绿，再配一圈
  // 很细的深橄榄边。
  const rim = new THREE.Mesh(
    eyeDiscGeometry(centerX, centerY, 0.1025, 0.1065, tilt, 0.004),
    materials.eyeRim
  );
  const sclera = new THREE.Mesh(
    eyeDiscGeometry(centerX, centerY, 0.099, 0.103, tilt, 0.007),
    materials.sclera
  );
  const iris = new THREE.Mesh(
    eyeDiscGeometry(centerX, centerY, 0.075, 0.079, tilt, 0.0095),
    materials.iris
  );
  const pupil = new THREE.Mesh(
    eyeDiscGeometry(centerX, centerY, 0.048, 0.052, tilt, 0.012),
    materials.pupil
  );

  // 参考图瞳孔几乎全黑，只有一点点反光；两颗大白高光会立刻变回
  // 塑料玩具的眼睛。高光是两颗贴着瞳孔的极小圆点。
  const highlightA = sphere(0.005, materials.highlight, 12, 8);
  highlightA.position.set(
    -0.015,
    0.022,
    eyeSurfaceZ(centerX - 0.015, centerY + 0.022) + 0.016
  );

  const highlightB = sphere(0.0028, materials.highlightSoft, 10, 8);
  highlightB.position.set(
    0.014,
    -0.019,
    eyeSurfaceZ(centerX + 0.014, centerY - 0.019) + 0.016
  );

  open.add(rim, sclera, iris, pupil, highlightA, highlightB);

  // 笑眼：细弯月，压在眼睛本身的高度上，眯眼时整只眼睛被吞掉。
  const arc = new THREE.Mesh(
    closedEyeArcGeometry(side, centerX, centerY, tilt),
    materials.arc
  );
  arc.userData.baseTilt = 0;
  arc.userData.baseY = 0;
  arc.userData.side = side;
  arc.visible = false;
  group.add(arc);

  return { group, open, arc };
}

const CLOSED_MOUTH_Y = -0.03;

function createClosedMouthLine(material) {
  const group = new THREE.Group();
  // 参考图里「思考」的嘴是一条离眼睛很远的细弧线，不是紧贴眼睛的
  // 一张小嘴。曲线上的每个点都取了脸皮在该高度的 z，整条线才会
  // 贴着圆脸绕过去；固定 z 的直管会有一端翘在脸外，像插了一根木棍。
  const points = [
    [-0.145, 0.004],
    [0, -0.005],
    [0.145, 0.016],
  ].map(
    ([x, y]) =>
      new THREE.Vector3(
        x,
        y,
        faceSurfaceZ(x, HEAD_PIVOT_Y + CLOSED_MOUTH_Y + y) + 0.003
      )
  );
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.QuadraticBezierCurve3(points[0], points[1], points[2]),
      20,
      0.0068,
      8,
      false
    ),
    material
  );
  group.add(mesh);
  group.position.set(0, CLOSED_MOUTH_Y, 0);
  group.rotation.z = 0.018;
  return group;
}

const MOUTH_GROUP_Y = 0.148;
const MOUTH_GROUP_Z = 0.552;
const MOUTH_WORLD_Y = HEAD_PIVOT_Y + MOUTH_GROUP_Y;
// 参考图的大笑嘴是一张横着的「豆形」：比旧版更宽、上下更扁，
// 嘴角往上提，上唇几乎贴着笑眼。
const MOUTH_WIDTH = 0.345;
const MOUTH_TOP = 0.195;
const MOUTH_BOTTOM = 0.205;
// 深色唇边很细：参考图里牙齿和口腔直接顶到嘴的轮廓上，
// 只有下唇一圈略厚的唇肉。
const MOUTH_INNER_SCALE = 0.945;
const MOUTH_INNER_CENTER_Y = -0.196;

// 把嘴的二维坐标贴回身体曲面。lift 是离开脸表面的距离。
//
// 这里不需要再给下半张嘴补偿额外的高度：脸皮在正面已经跟着头骨走
// （见 bodyWeights 的 frontness），嘴巴和底下的皮肤是同一个角度，
// 贴着曲面放就够，任何仰角都不会被脸顶穿。
function mouthLocalZ(x, localY, lift = 0) {
  const worldY = MOUTH_WORLD_Y + localY;
  return faceSurfaceZ(x, worldY) + lift - MOUTH_GROUP_Z;
}

function mouthOutline(scale, centerY) {
  const count = 72;
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const bottom = Math.max(0, -sin);
    // 下缘收得比上缘窄，笑嘴才是「倒蛋形」，不是一颗黑圆球。
    const halfWidth = MOUTH_WIDTH * (1 - 0.1 * bottom) * scale;
    // 轻微的不对称，避免笑嘴像机器刻出来的标准椭圆。
    const asymX = 0.009 * Math.sin(angle * 2 + 0.4) + 0.005 * Math.cos(angle);
    const asymY =
      0.014 * Math.cos(angle) - 0.004 * Math.cos(angle * 3 + 0.5);
    // 嘴角明显往上提：参考图里笑到两颊都堆起来，嘴是一条弯月，
    // 不是竖着的一张黑椭圆。
    const cornerLift = 0.042 * cos * cos;
    const radiusY = sin >= 0 ? MOUTH_TOP : MOUTH_BOTTOM;
    const x = cos * halfWidth + asymX;
    const y = centerY + sin * radiusY * scale + asymY + cornerLift * scale;
    points.push({ x, y });
  }
  return points;
}

// 一圈有厚度的深色嘴唇：外轮廓和嘴唇内洞之间铺三角形。
function mouthRingGeometry(outer, inner, outerLift, innerLift) {
  const positions = [];
  const indices = [];
  const count = outer.length;
  for (let i = 0; i < count; i += 1) {
    const outerPoint = outer[i];
    const innerPoint = inner[i];
    positions.push(
      outerPoint.x,
      outerPoint.y,
      mouthLocalZ(outerPoint.x, outerPoint.y, outerLift)
    );
    positions.push(
      innerPoint.x,
      innerPoint.y,
      mouthLocalZ(innerPoint.x, innerPoint.y, innerLift)
    );
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const outerA = i * 2;
    const innerA = outerA + 1;
    const outerB = next * 2;
    const innerB = outerB + 1;
    indices.push(outerA, outerB, innerB, outerA, innerB, innerA);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 深色口腔底面。
 *
 * 不能只用「中心点 + 一圈边界」的大扇形：每个三角形会横跨整个弧形
 * 脸颊，三角形的弦缩在脸里面，黄色的脸就会从黑色口腔中间穿出来。
 * 这里做八圈同心顶点，每一圈都重新贴回曲面，口腔才会干净地黑下去。
 */
function mouthDiscGeometry(points, centerY, lift) {
  const rings = 8;
  const count = points.length;
  const positions = [];
  const indices = [];

  for (let ring = 0; ring < rings; ring += 1) {
    const scale = 1 - ring / rings;
    for (const point of points) {
      const x = point.x * scale;
      const y = centerY + (point.y - centerY) * scale;
      positions.push(x, y, mouthLocalZ(x, y, lift));
    }
  }
  const centerIndex = positions.length / 3;
  positions.push(0, centerY, mouthLocalZ(0, centerY, lift));

  for (let ring = 0; ring < rings - 1; ring += 1) {
    const outer = ring * count;
    const inner = (ring + 1) * count;
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count;
      indices.push(
        outer + i,
        outer + next,
        inner + next,
        outer + i,
        inner + next,
        inner + i
      );
    }
  }
  const last = (rings - 1) * count;
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    indices.push(last + i, last + next, centerIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 一条连着的奶油色牙带，而不是一颗颗分开的小球。
 *
 * 参考图里露出来的只是上颌一排又宽又圆的牙，下缘的缺口也很浅；
 * 旧版用很窄的尖峰做出「锯齿」，看起来像鲨鱼而不是奶龙。
 */
function toothBandGeometry(lift) {
  // 牙带的横向范围跟着嘴宽一起缩放，缩小嘴之后牙齿才不会穿出嘴角。
  // 参考图上半张嘴几乎被一整排宽而圆的牙填满。
  const edgeScale = MOUTH_WIDTH / 0.34;
  const edges = [
    -0.265, -0.159, -0.053, 0.053, 0.159, 0.265,
  ].map((value) => value * edgeScale);
  const heights = [0.006, 0.01, 0.012, 0.009, 0.005];
  const baseBand = 0.062;
  const samples = 200;
  const positions = [];
  const indices = [];

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = lerp(edges[0], edges[edges.length - 1], t);
    let toothIndex = 0;
    while (
      toothIndex < heights.length - 1 &&
      x > edges[toothIndex + 1]
    ) {
      toothIndex += 1;
    }
    const span = edges[toothIndex + 1] - edges[toothIndex];
    const local = Math.min(1, Math.max(0, (x - edges[toothIndex]) / span));
    // 指数调大以后每个齿形更宽、更圆，缺口只是浅浅的弧。
    const envelope =
      Math.pow(Math.sin(Math.PI * local), 1.55) *
      (1 + 0.04 * Math.sin(Math.PI * 2 * local + toothIndex));
    const wobble =
      0.0014 * Math.sin(x * 53 + toothIndex * 1.9) * envelope;
    // 牙带顶边压回嘴洞里一点点，不能探到深色唇边上：贴着内洞边缘
    // 会和大嘴的暗色底面互相穿插，屏幕上看就是牙上破了个洞。
    const top = mouthInnerTopY(x) - 0.008;
    const bottom =
      top - baseBand - heights[toothIndex] * envelope - wobble;
    positions.push(x, top, mouthLocalZ(x, top, lift));
    positions.push(x, bottom, mouthLocalZ(x, bottom, lift));
  }

  for (let i = 0; i < samples; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, d, a, d, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mouthInnerTopY(x) {
  const halfWidth = MOUTH_WIDTH * MOUTH_INNER_SCALE;
  const ratio = Math.min(1, Math.abs(x) / halfWidth);
  // 嘴角的上提也要算进来：只按内圈椭圆取上半边，牙带两侧会比
  // 真实嘴洞低一大截，嘴角上方就留出两块黑三角。
  return (
    MOUTH_INNER_CENTER_Y +
    MOUTH_TOP * MOUTH_INNER_SCALE * Math.sqrt(1 - ratio * ratio) +
    0.042 * MOUTH_INNER_SCALE * ratio * ratio
  );
}

function createMouth(materials) {
  const group = new THREE.Group();
  // 嘴巴以「上唇」为支点，张大时向下张开，不会顶到眼睛。
  // 下半张脸有短吻，嘴也要跟着向前挪，不能陷进脸里。
  group.position.set(0, MOUTH_GROUP_Y, MOUTH_GROUP_Z);

  const open = new THREE.Group();
  group.add(open);

  const outer = mouthOutline(1, -0.2);
  const inner = mouthOutline(MOUTH_INNER_SCALE, MOUTH_INNER_CENTER_Y);
  // 口腔底面比嘴唇内洞稍微大一圈，塞到嘴唇后面，斜着看也不会
  // 从接缝里漏出一线黄色的脸。
  const innerBacking = mouthOutline(
    MOUTH_INNER_SCALE * 1.12,
    MOUTH_INNER_CENTER_Y
  );

  // 外唇是一圈厚边，口腔底面在它后面；牙和舌头再往前一点。
  const rim = new THREE.Mesh(
    mouthRingGeometry(outer, inner, 0.028, 0.021),
    materials.mouthRim
  );
  const innerMouth = new THREE.Mesh(
    mouthDiscGeometry(innerBacking, MOUTH_INNER_CENTER_Y, 0.02),
    materials.mouthInner
  );
  open.add(rim, innerMouth);

  const teeth = new THREE.Mesh(
    toothBandGeometry(0.037),
    materials.teeth
  );
  open.add(teeth);

  // 参考图的下唇只是一道很细的浅色高光，不是一整条厚嘴唇。
  // 这里半径收得很小、贴得更平，避免嘴底变成一圈白色香肠。
  //
  // 沿嘴的下缘取出许多点、每个点单独贴回脸皮，再用 Catmull-Rom
  // 串起来。只画一条三点的二次曲线时，管子中段会缩进弧形的脸里，
  // 屏幕上下唇就断成左右两截。
  const lipPoints = [];
  const lipSamples = 16;
  for (let i = 0; i <= lipSamples; i += 1) {
    const t = i / lipSamples;
    const x = lerp(-0.15, 0.15, t);
    const curve = Math.pow(t * 2 - 1, 2);
    const y = -0.368 + 0.05 * curve;
    lipPoints.push(new THREE.Vector3(x, y, mouthLocalZ(x, y, 0.022)));
  }
  const lowerLip = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(lipPoints),
      40,
      0.0145,
      10,
      false
    ),
    materials.lowerLip
  );
  open.add(lowerLip);

  // 舌头压在嘴的最深处，只当一团暗色，不抢镜。
  const tongue = sphere(1, materials.tongue, 24, 16);
  tongue.scale.set(0.068, 0.02, 0.012);
  tongue.position.set(0.012, -0.332, mouthLocalZ(0.012, -0.332, 0.006));
  tongue.rotation.set(-0.08, 0, 0.035);
  open.add(tongue);

  return { group, open };
}

function buildFace(headBone) {
  const materials = {
    eyeRim: new THREE.MeshStandardMaterial({
      color: COLORS.eyeRim,
      roughness: 0.62,
    }),
    sclera: new THREE.MeshPhysicalMaterial({
      color: COLORS.sclera,
      roughness: 0.32,
      clearcoat: 0.25,
      clearcoatRoughness: 0.4,
    }),
    iris: new THREE.MeshPhysicalMaterial({
      color: COLORS.iris,
      roughness: 0.34,
      clearcoat: 0.2,
      clearcoatRoughness: 0.4,
    }),
    pupil: new THREE.MeshStandardMaterial({
      color: COLORS.pupil,
      roughness: 0.2,
    }),
    highlight: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    highlightSoft: new THREE.MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.55,
    }),
    arc: new THREE.MeshBasicMaterial({
      color: '#1a0f08',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
    mouthRim: new THREE.MeshStandardMaterial({
      color: COLORS.mouthRim,
      roughness: 0.8,
      side: THREE.DoubleSide,
    }),
    mouthInner: new THREE.MeshStandardMaterial({
      color: COLORS.mouthInner,
      roughness: 0.9,
      emissive: new THREE.Color('#0D0203'),
      emissiveIntensity: 0.14,
      side: THREE.DoubleSide,
    }),
    tongue: new THREE.MeshPhysicalMaterial({
      color: COLORS.tongue,
      roughness: 0.7,
      clearcoat: 0.06,
      side: THREE.DoubleSide,
    }),
    teeth: new THREE.MeshStandardMaterial({
      color: COLORS.teeth,
      roughness: 0.44,
      side: THREE.DoubleSide,
    }),
    lowerLip: new THREE.MeshPhysicalMaterial({
      color: '#EBD6BC',
      roughness: 0.48,
      clearcoat: 0.08,
      clearcoatRoughness: 0.5,
      side: THREE.DoubleSide,
    }),
    mouthLine: new THREE.MeshStandardMaterial({
      color: COLORS.mouthLine,
      roughness: 0.5,
      transparent: true,
      opacity: 1,
    }),
  };

  const root = new THREE.Group();
  // 眼睛的每个顶点都按所在高度的脸皮取 z，不再需要单独的 z 偏移。
  const eyes = [createEye(-1, materials), createEye(1, materials)];
  for (const eye of eyes) root.add(eye.group);

  const mouth = createMouth(materials);
  root.add(mouth.group);

  const closedMouth = createClosedMouthLine(materials.mouthLine);
  root.add(closedMouth);

  headBone.add(root);

  return { root, eyes, mouth, closedMouth, materials };
}

/* ------------------------------------------------------------------ */
/* 手                                                                 */
/* ------------------------------------------------------------------ */

function buildHand(side, material) {
  const group = new THREE.Group();
  // 参考图里的手是四指几乎并拢的大肉垫，比旧模型更厚、更宽。
  group.scale.setScalar(1.2);

  // group 负责「手掌该朝哪」的整体姿态；joint 是真正的腕关节，
  // 只叠加用户手腕的屈/伸/侧偏/旋转。手腕数据为零时 joint 是单位
  // 旋转，三张参考图的预设手型完全不受影响。
  const joint = new THREE.Group();
  group.add(joint);

  const palm = sphere(1, material, 26, 18);
  palm.scale.set(0.13, 0.124, 0.082);
  palm.position.y = -0.068;
  joint.add(palm);

  const fingers = [];
  const xs = [-0.082, -0.027, 0.027, 0.082];
  for (let i = 0; i < 4; i += 1) {
    const base = new THREE.Group();
    base.position.set(xs[i], -0.155, 0.004);
    joint.add(base);

    const proximal = capsule(0.028, 0.054, material, 14);
    proximal.position.y = -0.045;
    base.add(proximal);

    const middle = new THREE.Group();
    middle.position.y = -0.09;
    base.add(middle);

    const distal = capsule(0.023, 0.046, material, 14);
    distal.position.y = -0.035;
    middle.add(distal);

    const tip = sphere(0.024, material, 14, 10);
    tip.position.y = -0.066;
    middle.add(tip);

    fingers.push({ base, middle, index: i });
  }

  // 拇指在内侧，用两截小胶囊拼成。
  const thumb = new THREE.Group();
  thumb.position.set(-side * 0.096, -0.06, 0.022);
  thumb.rotation.z = -side * 0.58;
  joint.add(thumb);

  const thumbRoot = new THREE.Group();
  thumb.add(thumbRoot);
  const thumbProximal = capsule(0.033, 0.05, material, 14);
  thumbProximal.position.y = -0.039;
  thumbRoot.add(thumbProximal);

  const thumbMiddle = new THREE.Group();
  thumbMiddle.position.y = -0.078;
  thumbRoot.add(thumbMiddle);
  const thumbTip = capsule(0.027, 0.04, material, 14);
  thumbTip.position.y = -0.031;
  thumbMiddle.add(thumbTip);

  // 腕球只负责盖住手臂软管末端；缩小并往掌心收，避免读成第二颗手掌。
  const wrist = sphere(1, material, 22, 14);
  wrist.scale.set(0.094, 0.084, 0.081);
  wrist.position.y = 0.012;
  joint.add(wrist);

  return { group, joint, fingers, thumb, thumbRoot, thumbMiddle };
}

/* ------------------------------------------------------------------ */
/* 四肢                                                               */
/* ------------------------------------------------------------------ */

const ARM = {
  upper: 0.42,
  lower: 0.38,
  shoulderY: SHOULDER_Y - CHEST_Y,
  // 肩根放在身体前半侧：手臂向前环抱肚子时仍能弯肘，
  // 不会从身体中心直直穿出来。
  shoulderX: 0.52,
  shoulderZ: 0.28,
  // 软管起点往胸腔里收：收口藏在体内，肩部只剩手臂和躯干的自然相交。
  embedX: 0.17,
  embedZ: 0.11,
  embedY: 0.02,
};

const ARM_RINGS = 34;
const ARM_SIDES = 20;
// 肩根用半球收口，不再拿一颗球去堵平口。
const ARM_CAP_RINGS = 10;

/**
 * 手臂是一整块实时重建的软管：肩 → 肘 → 腕沿一条二次曲线过渡，
 * 没有圆柱接口和肘关节球，所以弯起来像参考图里连续的软糖手臂。
 * 顶点很少，每帧重写位置和法线开销可以忽略。
 */
function createArmSkin(material) {
  const ringSize = ARM_SIDES + 1;
  const vertexCount = (ARM_RINGS + 1) * ringSize;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3)
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3)
  );

  const indices = [];
  for (let i = 0; i < ARM_RINGS; i += 1) {
    for (let j = 0; j < ARM_SIDES; j += 1) {
      const a = i * ringSize + j;
      const b = (i + 1) * ringSize + j;
      // 从管子外面看是逆时针，背面剔除时不会漏。
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  geometry.setIndex(indices);

  const mesh = new THREE.Mesh(geometry, material);
  // 顶点每帧在本地重写，包围球会过时，直接关掉视锥剔除。
  mesh.frustumCulled = false;
  return mesh;
}

function armRadius(t) {
  // 配合收窄的腹部减小臂围，仍保留圆润的肘部与手腕过渡。
  const upper = 0.205;
  const elbow = 0.166;
  const wrist = 0.128;
  if (t < 0.5) {
    return lerp(upper, elbow, smoothstep(0, 0.5, t));
  }
  const forearm = lerp(elbow, wrist, smoothstep(0.5, 1, t));
  const swell = Math.sin(Math.PI * clamp01((t - 0.46) / 0.54)) * 0.018;
  return forearm + swell;
}

const armScratch = {
  start: new THREE.Vector3(),
  elbow: new THREE.Vector3(),
  wrist: new THREE.Vector3(),
  control: new THREE.Vector3(),
  point: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  sideA: new THREE.Vector3(),
  sideB: new THREE.Vector3(),
  axisN: new THREE.Vector3(),
  axisB: new THREE.Vector3(),
  reference: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  capTangent: new THREE.Vector3(),
  capN: new THREE.Vector3(),
  capB: new THREE.Vector3(),
};

function updateArmSkin(arm, elbowPos, wristPos, upperDir) {
  const s = armScratch;
  const shoulder = arm.shoulder.position;

  // 肩根埋进胸腔，让身体自己完成「手臂从躯干长出来」的并集。
  // 以前把软管起点摆在肩点上（正好贴着胸面），半球收口会有一小片
  // 从肩膀上方探出来，像一片掀起来的皮。
  s.start
    .copy(upperDir)
    .multiplyScalar(-0.02);
  s.start.x -= arm.side * ARM.embedX;
  s.start.z -= ARM.embedZ;
  s.start.y += ARM.embedY;
  s.elbow.copy(elbowPos).sub(shoulder);
  s.wrist.copy(wristPos).sub(shoulder);

  // 二次 Bézier 的肘部控制点：t = 0.5 时正好经过 IK 算出的肘。
  s.control
    .copy(s.elbow)
    .multiplyScalar(2)
    .addScaledVector(s.start, -0.5)
    .addScaledVector(s.wrist, -0.5);

  const geometry = arm.skin.geometry;
  const position = geometry.attributes.position;
  const normalAttr = geometry.attributes.normal;
  const ringSize = ARM_SIDES + 1;

  // 肩根是软的半球收口：曲线起点处的切线就是半球的轴向，
  // 收口半径和软管半径完全相等，接缝处曲率连续、看不出接口。
  // 以前用一颗半径相近的球去堵平口，两个面几乎贴在一起，
  // 会闪出一条锯齿状的缝，看着像手臂被撕开。
  s.capTangent.copy(s.control).sub(s.start);
  if (s.capTangent.lengthSq() < 1e-8) s.capTangent.copy(upperDir);
  s.capTangent.normalize();
  s.reference.set(0, 0, 1);
  if (Math.abs(s.capTangent.z) > 0.92) s.reference.set(1, 0, 0);
  s.capN.crossVectors(s.reference, s.capTangent).normalize();
  s.capB.crossVectors(s.capTangent, s.capN).normalize();

  const capRadius = armRadius(0);
  for (let i = 0; i <= ARM_CAP_RINGS; i += 1) {
    const phi = (i / ARM_CAP_RINGS) * (Math.PI / 2);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let j = 0; j <= ARM_SIDES; j += 1) {
      const angle = (j / ARM_SIDES) * TAU;
      s.normal
        .copy(s.capN)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(s.capB, Math.sin(angle));
      const base = i * ringSize + j;
      position.setXYZ(
        base,
        s.start.x -
          s.capTangent.x * capRadius * sinPhi +
          s.normal.x * capRadius * cosPhi,
        s.start.y -
          s.capTangent.y * capRadius * sinPhi +
          s.normal.y * capRadius * cosPhi,
        s.start.z -
          s.capTangent.z * capRadius * sinPhi +
          s.normal.z * capRadius * cosPhi
      );
      // 收口处法线朝球心外侧，和软管第一圈径向法线正好接上。
      normalAttr.setXYZ(
        base,
        s.normal.x * cosPhi - s.capTangent.x * sinPhi,
        s.normal.y * cosPhi - s.capTangent.y * sinPhi,
        s.normal.z * cosPhi - s.capTangent.z * sinPhi
      );
    }
  }

  for (let i = ARM_CAP_RINGS + 1; i <= ARM_RINGS - ARM_CAP_RINGS; i += 1) {
    const t =
      (i - ARM_CAP_RINGS) / (ARM_RINGS - ARM_CAP_RINGS * 2);
    const inv = 1 - t;

    s.point
      .copy(s.start)
      .multiplyScalar(inv * inv)
      .addScaledVector(s.control, 2 * inv * t)
      .addScaledVector(s.wrist, t * t);

    s.sideA.copy(s.control).sub(s.start).multiplyScalar(2 * inv);
    s.sideB.copy(s.wrist).sub(s.control).multiplyScalar(2 * t);
    s.tangent.copy(s.sideA).add(s.sideB);
    if (s.tangent.lengthSq() < 1e-8) s.tangent.set(0, -1, 0);
    s.tangent.normalize();

    // 用固定的参考方向搭圆环，弯肘时不会像 TubeGeometry 那样扭麻花。
    s.reference.set(0, 0, 1);
    if (Math.abs(s.tangent.z) > 0.92) s.reference.set(1, 0, 0);
    s.axisN.crossVectors(s.reference, s.tangent).normalize();
    s.axisB.crossVectors(s.tangent, s.axisN).normalize();

    const radius = armRadius(t);
    for (let j = 0; j <= ARM_SIDES; j += 1) {
      const angle = (j / ARM_SIDES) * TAU;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      s.normal
        .copy(s.axisN)
        .multiplyScalar(cos)
        .addScaledVector(s.axisB, sin);
      const base = i * ringSize + j;
      position.setXYZ(
        base,
        s.point.x + s.normal.x * radius,
        s.point.y + s.normal.y * radius,
        s.point.z + s.normal.z * radius
      );
      // 法线直接取圆环径向，接缝处的两个重复顶点也完全一致。
      normalAttr.setXYZ(base, s.normal.x, s.normal.y, s.normal.z);
    }
  }

  // 腕口同样收成半球。以前腕口是敞开的平口，靠手掌里一颗小球去堵，
  // 球比软管细一圈，交界处就会露出一圈锯齿状的黄色。
  s.capTangent.copy(s.wrist).sub(s.control);
  if (s.capTangent.lengthSq() < 1e-8) s.capTangent.copy(upperDir);
  s.capTangent.normalize();
  s.reference.set(0, 0, 1);
  if (Math.abs(s.capTangent.z) > 0.92) s.reference.set(1, 0, 0);
  s.capN.crossVectors(s.reference, s.capTangent).normalize();
  s.capB.crossVectors(s.capTangent, s.capN).normalize();

  const wristRadius = armRadius(1);
  for (
    let i = ARM_RINGS - ARM_CAP_RINGS + 1;
    i <= ARM_RINGS;
    i += 1
  ) {
    const u = (i - (ARM_RINGS - ARM_CAP_RINGS)) / ARM_CAP_RINGS;
    const phi = u * (Math.PI / 2);
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let j = 0; j <= ARM_SIDES; j += 1) {
      const angle = (j / ARM_SIDES) * TAU;
      s.normal
        .copy(s.capN)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(s.capB, Math.sin(angle));
      const base = i * ringSize + j;
      position.setXYZ(
        base,
        s.wrist.x +
          s.capTangent.x * wristRadius * sinPhi +
          s.normal.x * wristRadius * cosPhi,
        s.wrist.y +
          s.capTangent.y * wristRadius * sinPhi +
          s.normal.y * wristRadius * cosPhi,
        s.wrist.z +
          s.capTangent.z * wristRadius * sinPhi +
          s.normal.z * wristRadius * cosPhi
      );
      normalAttr.setXYZ(
        base,
        s.normal.x * cosPhi + s.capTangent.x * sinPhi,
        s.normal.y * cosPhi + s.capTangent.y * sinPhi,
        s.normal.z * cosPhi + s.capTangent.z * sinPhi
      );
    }
  }

  position.needsUpdate = true;
  normalAttr.needsUpdate = true;
}

function buildArm(side, materials) {
  const shoulder = new THREE.Group();
  shoulder.position.set(
    side * ARM.shoulderX,
    ARM.shoulderY,
    ARM.shoulderZ
  );

  const skin = createArmSkin(materials.body);
  shoulder.add(skin);

  // 肩头不再单独放球：软管自己带半球收口，
  // 少一个和软管几乎共面的曲面，就少一条乱闪的接缝。

  // 这三个 pivot 不再挂可见网格，只负责把 IK 结果传给手掌。
  const upperPivot = new THREE.Group();
  shoulder.add(upperPivot);

  const elbow = new THREE.Group();
  elbow.position.y = -ARM.upper;
  upperPivot.add(elbow);

  const lowerPivot = new THREE.Group();
  elbow.add(lowerPivot);

  const wrist = new THREE.Group();
  wrist.position.y = -ARM.lower;
  lowerPivot.add(wrist);

  const hand = buildHand(side, materials.hand);
  wrist.add(hand.group);

  return {
    side,
    shoulder,
    skin,
    upperPivot,
    lowerPivot,
    wrist,
    hand,
  };
}

function buildLeg(side, material) {
  const hip = new THREE.Group();
  hip.position.set(side * 0.235, 0.52, 0.025);

  const upperPivot = new THREE.Group();
  hip.add(upperPivot);

  const thigh = capsule(0.17, 0.1, material, 18);
  thigh.position.y = -0.12;
  upperPivot.add(thigh);

  const knee = new THREE.Group();
  knee.position.y = -0.22;
  upperPivot.add(knee);

  const lowerPivot = new THREE.Group();
  knee.add(lowerPivot);

  const shin = capsule(0.145, 0.055, material, 18);
  shin.position.y = -0.07;
  lowerPivot.add(shin);

  const ankle = new THREE.Group();
  ankle.position.y = -0.17;
  lowerPivot.add(ankle);

  const foot = sphere(1, material, 25, 16);
  foot.scale.set(0.21, 0.105, 0.33);
  foot.position.set(0, -0.005, 0.075);
  ankle.add(foot);

  // 三个小脚趾头，只在正面露出来一点点。
  for (let i = 0; i < 3; i += 1) {
    const toe = sphere(0.058, material, 14, 10);
    toe.scale.set(0.84, 0.7, 1.05);
    toe.position.set(-0.105 + i * 0.105, -0.005, 0.315);
    ankle.add(toe);
  }

  return { side, hip, upperPivot, lowerPivot, ankle, foot };
}

/* ------------------------------------------------------------------ */
/* 整个角色                                                           */
/* ------------------------------------------------------------------ */

function buildCharacter() {
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.7,
    envMapIntensity: 0.32,
  });

  const bodyYellow = new THREE.MeshPhysicalMaterial({
    color: COLORS.body,
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.7,
    envMapIntensity: 0.32,
  });

  const handMaterial = new THREE.MeshPhysicalMaterial({
    color: COLORS.hand,
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.72,
    envMapIntensity: 0.28,
  });

  const bodyGeometry = buildBodyGeometry();
  const bodyMesh = new THREE.SkinnedMesh(bodyGeometry, bodyMaterial);
  bodyMesh.name = 'nailong-body';

  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.set(0, 0.52, 0);

  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.set(0, 0.32, 0);
  hips.add(spine);

  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.set(0, 0.3, 0);
  spine.add(chest);

  const neck = new THREE.Bone();
  neck.name = 'neck';
  neck.position.set(0, NECK_Y - CHEST_Y, 0);
  chest.add(neck);

  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, HEAD_PIVOT_Y - NECK_Y, 0);
  neck.add(head);

  bodyMesh.add(hips);
  bodyMesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([hips, spine, chest, neck, head]);
  bodyMesh.bind(skeleton);
  // 必须放在 bind 之后，才能让蒙皮与挂在头骨上的五官一起缩小。
  head.scale.setScalar(HEAD_SCALE);
  // Extend the weighted neck after binding, retaining the small head and round
  // abdomen. Neck/head weights distribute the lift instead of detaching the face.
  neck.position.y += 0.04;
  head.position.y += 0.16;

  const root = new THREE.Group();
  // 整体轻微收窄，让奶龙从「圆球」变成参考图里更修长的豆形；
  // 只动横向，不拉高，避免把眼睛和脸型压成椭圆。
  root.scale.x = 0.95;
  root.add(bodyMesh);

  const face = buildFace(head);

  const materials = {
    body: bodyYellow,
    hand: handMaterial,
  };
  const arms = {
    left: buildArm(1, materials),
    right: buildArm(-1, materials),
  };
  chest.add(arms.left.shoulder, arms.right.shoulder);

  const legs = {
    left: buildLeg(1, bodyYellow),
    right: buildLeg(-1, bodyYellow),
  };
  root.add(legs.left.hip, legs.right.hip);

  const pose = {
    spinePitch: 0,
    chestPitch: 0,
    neckPitch: 0,
    headPitch: 0,
  };

  return {
    root,
    bodyMesh,
    bones: { hips, spine, chest, neck, head },
    face,
    arms,
    legs,
    pose,
    materials,
  };
}

/* ------------------------------------------------------------------ */
/* 每帧更新                                                           */
/* ------------------------------------------------------------------ */

const POSTURE = {
  thinking: { spine: 0.045, chest: 0.03, neck: 0.0, head: -0.06 },
  belly: { spine: 0.06, chest: 0.08, neck: -0.025, head: -0.04 },
  // 仰天：早先四段加起来仰了四十度，再叠上跟踪器给的头就快把脸翻过去了，
  // 画面上只剩头顶和一张从下巴底下看的嘴。参考图里是仰头但整张脸还在，
  // 这里停在约 28°：下巴抬高、嘴朝上，摄影机仍然看得到屏幕里的笑眼。
  head: { spine: -0.06, chest: -0.12, neck: -0.14, head: -0.17 },
};

// 挑战姿势下，把 2D 手臂角度生成的落点再微调一点：
// 捧腹时手往肚子下方放，抱头时把手收到后脑两侧。
const ARM_STYLE = {
  thinking: {
    // 只有屏幕左侧的手要抬到下巴，另一只手只做很小的偏移，免得贴进身体。
    mainSide: -1,
    xIn: -0.24,
    yUp: 0.04,
    zOffset: 0.15,
    fingerScale: 0.52,
    handScale: 1.08,
    elbowOut: 0.3,
    handYaw: 0.8,
    // 参考图是松松握起的拳头托住下巴，不再伸出一根手指。
    // 手腕 1:1 跟随玩家：抬腕 / 压腕要在画面上看得出来。
    wristGain: 1,
    // 有单目 3D 时玩家自己的手已经在下巴附近：水平微调收小，
    // 但 Z 方向仍要保留，否则奶龙的大下巴会把拳头吃掉。
    retargetScale: 0.1,
    retargetZScale: 1,
  },
  belly: {
    xIn: 0.08,
    yUp: 0.02,
    zOffset: 0.32,
    fingerScale: 0.8,
    handScale: 1.1,
    spread: 0.7,
    // 两只手靠得更近、上下错开一点，像真的交叠在肚子下方。
    spreadX: 0,
    // 手掌按在肚皮上，指尖朝下、微微向里合拢，手背朝镜头。
    handDown: 1,
    handOut: -0.16,
    overlap: 0.025,
    staggerY: 0.04,
    elbowOut: 0.22,
    handYaw: 0.25,
    wristGain: 1,
    retargetScale: 0.15,
    retargetZScale: 0.5,
  },
  head: {
    xIn: 0.005,
    yUp: 0.08,
    zOffset: -0.48,
    fingerScale: 0.6,
    handScale: 1.08,
    spreadX: 0.12,
    elbowOut: 0.5,
    handYaw: -0.18,
    wristGain: 1,
    // 小头版本将双手向内、向下收，并减少后送量，使手背贴近头侧。
    retargetScale: 0.9,
    retargetZScale: 0.1,
  },
};

function applyHand(hand, values, time, style, side) {
  const fingers = values?.fingers ?? [0.35, 0.35, 0.35, 0.35];
  const thumb = values?.thumb ?? 0.4;
  const id = Math.round(time * 10);
  const scale = values?.tracked ? 1 : style?.fingerScale ?? 1;
  const pointing = style?.pointSide === side;
  const spread = (style?.spread ?? 0) * (side > 0 ? -1 : 1);

  for (const finger of hand.fingers) {
    let extension = clamp01((fingers[finger.index] ?? 0.35) * scale);
    if (pointing) {
      extension =
        finger.index === (style.pointFinger ?? 3) ? 1 : style.pointCurl ?? 0.12;
    }
    const curl = 1 - extension;
    const wobble = Math.sin(id * 0.7 + finger.index) * 0.012 * extension;
    finger.base.rotation.x = 0.1 + curl * 1.2 + wobble;
    finger.middle.rotation.x = 0.06 + curl * 1.45;
    finger.base.rotation.z = spread * (finger.index - 1.5) * 0.16;
  }

  const thumbCurl = pointing
    ? 0.9
    : 1 - clamp01(thumb * scale);
  hand.thumbRoot.rotation.x = 0.08 + thumbCurl * 0.95;
  hand.thumbMiddle.rotation.x = 0.05 + thumbCurl * 1.0;
}

const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const CAMERA_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * 用两节骨骼 IK 把手臂从肩部接到目标手腕。
 *
 * 两条输入路径：
 * 1. 有单目 3D retarget 时（targetMix > 0），目标来自玩家躯干局部坐标，
 *    肘部朝向也来自真实的肩→肘方向，前后、左右、抬手都会一起跟；
 * 2. 没有 worldLandmarks 时，用 2D 屏幕角度 + 前后深度角拼出落点。
 *
 * 最后都统一到胸口局部坐标，所以玩家转身不会让手臂转两次。
 */
function applyArm(arm, values, time, style) {
  const upper = values?.upper ?? (arm.side > 0 ? 14 : -14);
  const fore = values?.fore ?? (arm.side > 0 ? 6 : -6);
  const forward = THREE.MathUtils.clamp(
    Number.isFinite(values?.forward) ? values.forward : 0,
    -75,
    75
  );
  const foreForward = THREE.MathUtils.clamp(
    Number.isFinite(values?.foreForward) ? values.foreForward : 0,
    -75,
    75
  );

  const shoulder = arm.shoulder.position;
  const a1 = upper * DEG;
  const a2 = fore * DEG;
  const d1 = forward * DEG;
  const d2 = foreForward * DEG;
  const plane1 = Math.cos(d1);
  const plane2 = Math.cos(d2);

  // 屏幕平面用 cos(前后角) 缩短，镜头方向用 sin(前后角) 伸出。
  const elbowOffset = new THREE.Vector3(
    Math.sin(a1) * ARM.upper * plane1,
    -Math.cos(a1) * ARM.upper * plane1,
    Math.sin(d1) * ARM.upper
  );
  const foreOffset = new THREE.Vector3(
    Math.sin(a2) * ARM.lower * plane2,
    -Math.cos(a2) * ARM.lower * plane2,
    Math.sin(d2) * ARM.lower
  );

  const fold = smoothstep(55, 115, Math.abs(fore));
  // 2D 路径需要额外的镜头方向让位；3D 目标自带玩家身体厚度的比例，
  // 只需很小一点余量，否则捧腹时手会飘到肚子前面。
  const baseForward = 0.14 + 0.12 * fold;
  const baseForward3D = 0.03;
  const planarTarget = new THREE.Vector3()
    .copy(shoulder)
    .add(elbowOffset)
    .add(foreOffset);
  planarTarget.z += baseForward;

  let target = planarTarget;
  let pole = elbowOffset.clone();
  // 2D 路径保留原来「手肘往镜头方向让一点」的偏置。
  pole.z += baseForward * 0.55 + 0.08;

  // 3D 目标按玩家手臂总长归一化，这里乘回奶龙的手臂长度。
  // 肘弯得越厉害，目标离肩越近；IK 会自然复现同样的弯曲。
  const mix = clamp01(
    Number.isFinite(values?.targetMix) ? values.targetMix : 0
  );
  const target3D = values?.target;
  if (
    mix > 0.002 &&
    target3D &&
    Number.isFinite(target3D.x) &&
    Number.isFinite(target3D.y) &&
    Number.isFinite(target3D.z)
  ) {
    const reach = ARM.upper + ARM.lower;
    const retargeted = new THREE.Vector3(
      shoulder.x + target3D.x * reach,
      shoulder.y + target3D.y * reach,
      shoulder.z + target3D.z * reach + baseForward3D
    );
    target.lerp(retargeted, mix);

    const elbow3D = values?.elbow;
    if (
      elbow3D &&
      Number.isFinite(elbow3D.x) &&
      Number.isFinite(elbow3D.y) &&
      Number.isFinite(elbow3D.z)
    ) {
      const retargetedPole = new THREE.Vector3(
        elbow3D.x,
        elbow3D.y,
        elbow3D.z
      );
      if (retargetedPole.lengthSq() > 1e-6) {
        pole.lerp(retargetedPole, mix);
      }
    }
  }

  if (style) {
    const focus =
      style.mainSide == null || style.mainSide === arm.side ? 1 : 0.18;
    // 3D 落点来自玩家本人，挑战预设的位移只做小修正。头部的 Z 偏移
    // 例外：奶龙头比真人大，抱头必须继续往脑后送。
    const lateralScale =
      1 - (1 - (style.retargetScale ?? 1)) * mix;
    const depthScale =
      1 - (1 - (style.retargetZScale ?? style.retargetScale ?? 1)) * mix;
    target.x -= arm.side * (style.xIn ?? 0) * focus * lateralScale;
    target.x += arm.side * (style.spreadX ?? 0) * focus * lateralScale;
    target.y += (style.yUp ?? 0) * focus * lateralScale;
    target.z += (style.zOffset ?? 0) * focus * depthScale;

    const overlap = (style.overlap ?? 0) * focus;
    target.z += arm.side * overlap * depthScale;
    target.y += arm.side * overlap * 0.6 * lateralScale;
    target.y += arm.side * (style.staggerY ?? 0) * focus * lateralScale;
  }

  // 目标超出手臂能够到的范围时，沿肩 → 目标方向收回来。
  let delta = new THREE.Vector3().subVectors(target, shoulder);
  const maxReach = (ARM.upper + ARM.lower) * 0.995;
  let distance = delta.length();
  if (distance > maxReach) {
    target.copy(shoulder).addScaledVector(delta.normalize(), maxReach);
    delta = new THREE.Vector3().subVectors(target, shoulder);
    distance = maxReach;
  }
  if (distance < 0.06) {
    target.set(
      shoulder.x + arm.side * 0.06,
      shoulder.y - 0.06,
      shoulder.z + 0.12
    );
    delta = new THREE.Vector3().subVectors(target, shoulder);
    distance = Math.max(0.001, delta.length());
  }

  const dir = delta.clone().normalize();

  // 肘部朝向：保留 2D 路径的平面肘方向，或使用 3D 的真实肩→肘方向。
  pole.x += arm.side * (style?.elbowOut ?? 0);
  pole.addScaledVector(dir, -pole.dot(dir));
  if (pole.lengthSq() < 1e-6) {
    pole.set(arm.side * 0.7, -0.5, 0.4);
  }
  pole.normalize();

  const along =
    (ARM.upper * ARM.upper - ARM.lower * ARM.lower + distance * distance) /
    (2 * distance);
  const height = Math.sqrt(
    Math.max(0, ARM.upper * ARM.upper - along * along)
  );
  const elbowPos = new THREE.Vector3()
    .copy(shoulder)
    .addScaledVector(dir, along)
    .addScaledVector(pole, height);

  const upperDir = new THREE.Vector3()
    .subVectors(elbowPos, shoulder)
    .normalize();
  const foreDir = new THREE.Vector3()
    .subVectors(target, elbowPos)
    .normalize();

  const qUpper = new THREE.Quaternion().setFromUnitVectors(
    DOWN_AXIS,
    upperDir
  );
  const qFore = new THREE.Quaternion().setFromUnitVectors(
    DOWN_AXIS,
    foreDir
  );

  arm.upperPivot.quaternion.copy(qUpper);
  // lowerPivot 在 upperPivot 的局部坐标里。
  arm.lowerPivot.quaternion
    .copy(qUpper)
    .invert()
    .multiply(qFore);

  // 一整条软管手臂在这里根据 IK 结果重建。
  updateArmSkin(arm, elbowPos, target, upperDir);

  // 手背（局部 +Z）尽量朝镜头，手指向内弯，看起来像真的按在肚子/脸上。
  // 捧腹时手腕额外往下折：指尖贴着肚皮朝下，而不是顺着前臂朝里戳。
  let fingerDir = foreDir;
  if (style?.handDown) {
    fingerDir = new THREE.Vector3(
      arm.side * (style.handOut ?? 0),
      -1,
      0
    ).normalize();
  }
  const handY = fingerDir.clone().negate();
  const handZ = CAMERA_AXIS.clone().addScaledVector(
    handY,
    -CAMERA_AXIS.dot(handY)
  );
  if (handZ.lengthSq() < 1e-4) {
    handZ.set(1, 0, 0).addScaledVector(handY, -handY.x);
  }
  if (handZ.lengthSq() < 1e-4) handZ.set(0, 0, 1);
  handZ.normalize();
  const handX = new THREE.Vector3()
    .crossVectors(handY, handZ)
    .normalize();
  const handBasis = new THREE.Matrix4().makeBasis(handX, handY, handZ);
  const qHandDesired = new THREE.Quaternion().setFromRotationMatrix(
    handBasis
  );
  arm.hand.group.quaternion
    .copy(qFore)
    .invert()
    .multiply(qHandDesired);

  arm.hand.group.scale.setScalar(1.08 * (style?.handScale ?? 1));

  // 手腕的细微跟随。
  arm.hand.group.rotateX(Math.sin(time * 1.4 + arm.side) * 0.015);
  if (style?.handYaw) {
    arm.hand.group.rotateY(style.handYaw * arm.side);
  }

  // 腕关节：在「手该朝哪」的整体姿态之后，再叠加用户自己的
  // 屈伸 / 侧偏 / 前臂旋转。挑战里 wristGain 为 1，抬腕 / 压腕 1:1
  // 跟随玩家；增益留在这里是为了以后还能按姿势单独调弱。
  const wrist = values?.hand?.wrist ?? null;
  const wristGain = clamp01(style?.wristGain ?? 1);
  const wristFlex = THREE.MathUtils.clamp(
    Number.isFinite(wrist?.flex) ? wrist.flex : 0,
    -60,
    60
  );
  const wristDev = THREE.MathUtils.clamp(
    Number.isFinite(wrist?.dev) ? wrist.dev : 0,
    -45,
    45
  );
  const wristTwist = THREE.MathUtils.clamp(
    Number.isFinite(wrist?.twist) ? wrist.twist : 0,
    -60,
    60
  );
  const qFlex = new THREE.Quaternion().setFromAxisAngle(
    X_AXIS,
    -wristFlex * DEG * wristGain
  );
  const qDev = new THREE.Quaternion().setFromAxisAngle(
    Z_AXIS,
    -wristDev * arm.side * DEG * wristGain
  );
  const qTwist = new THREE.Quaternion().setFromAxisAngle(
    Y_AXIS,
    wristTwist * arm.side * DEG * wristGain
  );
  arm.hand.joint.quaternion
    .copy(qTwist)
    .multiply(qFlex)
    .multiply(qDev);

  applyHand(arm.hand, values?.hand, time, style, arm.side);
}

function updateCharacter(character, state, time, dt) {
  const expr = state.expr ?? {};
  const mouthOpen = clamp01(expr.mouthOpen ?? 0);
  const smile = clamp01(expr.smile ?? 0);
  const squint = clamp01(expr.squint ?? 0);
  const laugh = clamp01(state.laugh ?? 0);
  const active = Boolean(state.active);
  const challengeId = active ? state.challengeId || 'belly' : 'idle';

  const pose = character.pose;
  const posture = (state.rig?.tracked ? null : POSTURE[challengeId]) ?? {
    spine: 0,
    chest: 0,
    neck: 0,
    head: 0,
  };

  pose.spinePitch = damp(pose.spinePitch, posture.spine, 4.2, dt);
  pose.chestPitch = damp(pose.chestPitch, posture.chest, 4.2, dt);
  pose.neckPitch = damp(pose.neckPitch, posture.neck, 4.2, dt);
  pose.headPitch = damp(pose.headPitch, posture.head, 4.2, dt);

  const idleSway = Math.sin(time * 1.35);
  const breathing = Math.sin(time * 2.15) * 0.004;
  const headTilt = state.headTilt ?? 0;
  const lean = state.torsoLean ?? 0;
  const rig = state.rig ?? null;
  const body = rig?.body ?? null;
  const neck = rig?.neck ?? null;
  const headRig = rig?.head ?? null;

  const bodyYaw = Number.isFinite(body?.yaw) ? body.yaw : 0;
  const bodyPitch = Number.isFinite(body?.pitch) ? body.pitch : 0;
  const bodyRoll = Number.isFinite(body?.roll) ? body.roll : lean;

  // 没有新的 rig 数据（旧调用/降级路径）时，用原来的 headTilt 和
  // torsoLean 拆出颈部与头部残余，保持旧的歪头观感。
  const neckYaw = Number.isFinite(neck?.yaw) ? neck.yaw : 0;
  const headYaw = Number.isFinite(headRig?.yaw) ? headRig.yaw : 0;
  const neckPitch = Number.isFinite(neck?.pitch) ? neck.pitch : 0;
  const headPitch = Number.isFinite(headRig?.pitch) ? headRig.pitch : 0;
  const neckRoll = Number.isFinite(neck?.roll)
    ? neck.roll
    : (headTilt - lean) * 0.4;
  const headRoll = Number.isFinite(headRig?.roll)
    ? headRig.roll
    : (headTilt - lean) * 0.6;

  const bones = character.bones;

  // 身体旋转自由度：从髋到胸逐步分配，脚一直留在地面上，不跟着根节点
  // 转。旧版只在根节点上偷转 8% 的侧倾，脚会一起滑走；这里删掉。
  bones.hips.rotation.y = bodyYaw * DEG * 0.25;
  bones.hips.rotation.x = bodyPitch * DEG * 0.15;
  bones.hips.rotation.z = -bodyRoll * DEG * 0.2;

  bones.spine.rotation.y = bodyYaw * DEG * 0.35;
  bones.spine.rotation.x =
    pose.spinePitch + bodyPitch * DEG * 0.5 + breathing + laugh * 0.012;
  bones.spine.rotation.z = -bodyRoll * DEG * 0.45;

  bones.chest.rotation.y = bodyYaw * DEG * 0.4;
  bones.chest.rotation.x =
    pose.chestPitch +
    bodyPitch * DEG * 0.35 +
    Math.sin(time * 2.15 + 0.4) * 0.004;
  bones.chest.rotation.z = -bodyRoll * DEG * 0.35;

  // 颈部：先把绝对头部朝向拆成「身体 + 颈 + 头」三段。app 传来的
  // pitch 是残余量（已把身体前倾算进去），这里按向上的正角取负 X。
  bones.neck.rotation.y = neckYaw * DEG;
  bones.neck.rotation.x =
    pose.neckPitch - neckPitch * DEG + laugh * 0.006;
  bones.neck.rotation.z = -neckRoll * DEG;

  const laughShake = Math.sin(time * 9.2) * (0.012 + laugh * 0.015);
  bones.head.rotation.y =
    headYaw * DEG +
    Math.sin(time * 1.1) * 0.012 +
    (active ? 0 : idleSway * 0.008);
  bones.head.rotation.x =
    pose.headPitch -
    headPitch * DEG +
    mouthOpen * 0.008 -
    laugh * 0.012;
  bones.head.rotation.z = -headRoll * DEG + laughShake;

  // 手臂：屏幕左侧的 state.arms.right 驱动画面左侧的 3D 手臂。
  const armStyle = active ? ARM_STYLE[challengeId] ?? null : null;
  applyArm(character.arms.right, state.arms?.right, time, armStyle);
  applyArm(character.arms.left, state.arms?.left, time, armStyle);

  // 腿：髋/膝角度是相对竖直方向的绝对角度。
  for (const [key, leg] of Object.entries(character.legs)) {
    const values = state.legs?.[key] ?? { hip: 0, knee: 0 };
    const hip = values.hip ?? 0;
    const knee = values.knee ?? 0;
    leg.upperPivot.rotation.z = hip * DEG;
    leg.lowerPivot.rotation.z = (knee - hip) * DEG;
    leg.ankle.rotation.z = -knee * DEG * 0.45;
  }

  // 脸：嘴巴、笑眼、闭眼弧线。低开合度算「闭嘴」，只显示一条线。
  const openAmount = smoothstep(0.16, 0.42, mouthOpen);
  const openGroup = character.face.mouth.open;
  openGroup.visible = openAmount > 0.012;
  // 张得越大，嘴越宽、越向下掉；笑到最狠时再横向咧开一点。
  openGroup.scale.set(
    (0.2 + 0.8 * Math.pow(openAmount, 0.66)) * (1 + laugh * 0.07),
    0.11 + 0.89 * Math.pow(openAmount, 0.76),
    1
  );

  const mouthLine = character.face.closedMouth;
  const lineAlpha = 1 - smoothstep(0.15, 0.24, mouthOpen);
  mouthLine.visible = lineAlpha > 0.015;
  setOpacity(character.face.materials.mouthLine, lineAlpha);
  mouthLine.scale.x = 0.94 + smile * 0.22;
  mouthLine.position.y = CLOSED_MOUTH_Y - smile * 0.01;

  const eyeOpen = 1 - smoothstep(0.3, 0.72, squint) * 0.96;
  const arcOpacity = smoothstep(0.3, 0.58, squint);
  character.face.eyes.forEach((eye) => {
    eye.open.visible = eyeOpen > 0.16;
    eye.open.scale.y = Math.max(0.12, eyeOpen);
    eye.open.position.y = (1 - eyeOpen) * 0.03;
    eye.arc.visible = arcOpacity > 0.02;
    const side = eye.arc.userData.side ?? 1;
    const wild = 0.97 + laugh * 0.11;
    eye.arc.scale.set(wild, wild * (0.96 + laugh * 0.16), 1);
    eye.arc.rotation.z =
      eye.arc.userData.baseTilt - side * laugh * 0.018;
    eye.arc.position.y =
      (eye.arc.userData.baseY ?? -0.052) +
      laugh * (side < 0 ? 0.012 : -0.004);
    setOpacity(character.face.materials.arc, arcOpacity);
  });

  // 整个角色跟着摄像头里的肩部位置轻微左右移动。
  character.root.position.x = THREE.MathUtils.clamp(
    (state.offsetX ?? 0) * 0.0036,
    -0.1,
    0.1
  );
  character.root.position.y = THREE.MathUtils.clamp(
    -(state.offsetY ?? 0) * 0.0025,
    -0.04,
    0.04
  );
  const bounce = laugh * Math.abs(Math.sin(time * 7.5)) * 0.012;
  character.root.position.y += bounce;

  if (active) {
    character.root.position.y += Math.sin(time * 2.1) * 0.004;
  }
}

/* ------------------------------------------------------------------ */
/* 入口                                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{onError?: (error: Error) => void}} [options]
 */
export function createNailong3D(canvas, options = {}) {
  const onError = typeof options.onError === 'function' ? options.onError : null;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(640, 640, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.environment = makeStudioEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 40);
  // 三分之四机位：能同时看到正面五官和侧面纵深，避免把新模型又看成气球。
  camera.position.set(2.35, 1.35, 4.85);
  camera.lookAt(0.02, 1.15, 0);

  addLights(scene);

  const character = buildCharacter();
  scene.add(character.root);
  const shadow = addGroundShadow(scene);

  let lost = false;
  const handleContextLost = (event) => {
    event.preventDefault();
    if (lost) return;
    lost = true;
    onError?.(new Error('WebGL context lost'));
  };
  canvas.addEventListener('webglcontextlost', handleContextLost, false);

  let disposed = false;

  return {
    get ready() {
      return !disposed && !lost;
    },
    render(state, time = 0, dt = 1 / 60) {
      if (disposed) return;
      if (lost) throw new Error('WebGL context lost');
      updateCharacter(character, state, time, dt);
      shadow.position.x = character.root.position.x * 0.72;
      shadow.material.opacity = 0.82 - Math.min(0.18, Math.abs(character.root.position.y) * 2);
      renderer.render(scene, camera);
    },
    // 开发预览用：靠近看五官，不影响正式游戏的固定机位。
    setView(position, target) {
      if (position) camera.position.set(position.x, position.y, position.z);
      if (target) camera.lookAt(target.x, target.y, target.z);
    },
    // 开发预览用：检查骨骼/五官在世界坐标里的实际位置。
    get debugCharacter() {
      return character;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          for (const material of materials) {
            if (material.map) material.map.dispose();
            material.dispose();
          }
        }
      });
      renderer.dispose();
    },
  };
}
