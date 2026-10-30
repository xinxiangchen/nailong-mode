# 第三方组件与素材说明

## MediaPipe Tasks Vision

- 组件：`@mediapipe/tasks-vision` 1.1.1
- 文件：`vendor/vision_bundle.mjs`、`vendor/wasm/vision_wasm_internal.*`、`vendor/wasm/vision_wasm_nosimd_internal.*`
- 版权：Copyright 2023 The MediaPipe Authors
- 许可：Apache License 2.0（全文见 `licenses/Apache-2.0.txt`）
- 来源：<https://www.npmjs.com/package/@mediapipe/tasks-vision>
- 项目主页：<https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker>

## MediaPipe 模型

- `models/face_landmarker.task`：MediaPipe Face Landmarker（float16, version 1）
- `models/pose_landmarker_lite.task`：MediaPipe Pose Landmarker Lite（float16, version 1）
- `models/hand_landmarker.task`：MediaPipe Hand Landmarker（float16, version 1）
- 版权：Copyright 2023 The MediaPipe Authors
- 许可：Apache License 2.0（全文见 `licenses/Apache-2.0.txt`）
- 来源：<https://storage.googleapis.com/mediapipe-models/>

## Three.js

- 组件：three.js r160
- 文件：`vendor/three/three.module.js`
- 版本来源：<https://github.com/mrdoob/three.js>
- 版权：Copyright © 2010-2023 three.js authors
- 许可：MIT License（全文见 `licenses/three-LICENSE.txt`）
- 用途：在浏览器里渲染 3D 奶龙（SkinnedMesh、骨骼、相机、光照、环境贴图），只在本地加载。

## 角色形象与目标图片

- `js/nailong3d.js` 中的 3D 奶龙是受「奶龙」风格启发的**原创程序化建模同人形象**，由本项目自行搭建几何、材质、骨骼和 IK，不包含任何外部角色模型或贴图。
- `js/avatar.js` 中的实时小黄龙是受「奶龙」风格启发的**原创 Canvas 矢量同人形象**，由本项目自行绘制，作为 WebGL 不可用时的兜底。
- `assets/targets/` 里的三张目标图片由用户提供，用于个人本地的模仿挑战。图片版权归原权利人所有，本项目不声称拥有这些图片，也没有将其纳入任何开源许可；公开分发或商用前请先取得授权。
- 「奶龙」相关权利归其版权方所有。本项目为个人、非商业的粉丝作品，与版权方无关联。

## 字体

页面使用系统字体（Microsoft YaHei / PingFang SC / system-ui），不加载外部字体文件。
