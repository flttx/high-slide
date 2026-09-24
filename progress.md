# 进度记录 · MEGALODON DROP（高空滑梯）

更新：2026-09-24

## 已完成

- 游戏主体可完整游玩：开放式滑梯、6 段轨道和 5 处断口、空中调整方向、巨齿鲨在预计落点张嘴等待、Game Over、4 个检查点复活、HUD、音效、暂停和静音。
- 鲨鱼模型：Tripo 生成，Blender 绑骨并制作游动和张嘴动画，导出到 `public/models/megalodon.glb`。
- 按反馈「两侧太高 / 坡度太小 / 看不出高度」调整：
  - 起点抬高到 1680 m，全程 5870 m，终点在 27 m。
  - 前半程加入 -46° ~ -52° 的俯冲段。
  - 横截面边缘角 `lipAngle` 改为 36°（半径 4.5 m），侧墙只有约 0.9 m 高，能越过侧墙看到下方的海面。
  - 弯道倾斜角提高到 68°。
- 修复滑梯三角形绕序反了的问题：之前内表面被剔除，整条滑梯只显示出橙色外壳。
- 平衡验证（`npm run sim`）：
  - neutral、tuck、wobbly、hands-off 四种风格都能跑完全程。
  - brake 在第 0 段坠海，符合设计。
  - 最大 G 值 3.0 ~ 3.5，hands-off 的最大横向偏角 7°（上限 36°）。
- 骑手模型已生成：`tools/tripo/rider.json` → `tools/tripo/out/rider_a.glb`（本地文件，未入库），坐姿写实，预览效果可用。

## 待办（对应最新反馈「画面质感 / 人物姿态 / 滑梯真实感」）

1. **骑手**：
   - 用 Blender 处理 `rider_a.glb`：朝向、缩放到 1.75 m、去掉头部、减面，贴图不超过 2048。
   - 加简易骨骼（髋、大腿、小腿、脚、上臂、前臂）并导出为 `public/models/rider.glb`。
   - 在 `src/game/cameraRig.ts` 中加载，替换胶囊身体。眼高约 0.8 m（`head.position` 在构造函数和 `update()` 两处都要改）；骨骼继续由程序驱动（空中挣扎、手扶滑梯）；加载失败时回退到胶囊身体。
2. **滑梯真实感**（`src/world/trackMesh.ts`、`src/world/textures.ts`）：
   - 改用带清漆层（clearcoat）的 MeshPhysicalMaterial。
   - 引导线调淡，增加接缝和磨损。
   - 外壳加法兰肋。
   - 边缘灯缩小、调暗。
3. **支柱**：现在每 42 m 一根，金属材质发白，远看像一道发光的帘子。改成约 110 ~ 120 m 一根，换哑光混凝土材质。
4. **画面**：
   - 雾密度调到约 0.00016 ~ 0.0002，做出空气透视。
   - 海面颜色和反光更通透。
   - 云层改柔和，并下移到 780 ~ 870 m，让第 2 段俯冲穿过云层（`src/world/clouds.ts`）。
5. **文案**：`src/game/game.ts:76` 和 `index.html:72`、`index.html:113` 里的「1100 米」改为 1680。
6. **验证**：
   - `npx tsc --noEmit -p .`、`npm run sim`、`npm run build`。
   - 截图：
     - `node tools/shots.mjs auto autopilot`
     - `miss=0`（长距离下坠被鲨鱼吞）
     - `cp=2&miss=2&respawn`
     - `cp=3&miss=4`
   - `node tools/keys.mjs`：侧墙变矮后，按住 D 1.2 s / A 2 s 可能直接飞出滑梯，可能需要调整这个测试。

## 常用命令

```
npm run dev | npm run sim | npm run build
node tools/shots.mjs <name> "<query>" [maxSeconds]   # 截图输出到 tools/shots/（不入库）
node tools/keys.mjs                                   # 键盘冒烟测试
node tools/tripo/tripo.mjs gen <body.json> <name>     # 密钥从 TRIPO_API_KEY 或 ~/.tripo/config.json 读取
```

调试 URL 参数：`?debug`、`?autopilot`、`?miss=N`、`?cp=N`

## 备注

- `tools/tripo/out`（Tripo 原始下载，其中 task.json 含带签名的下载链接）和 `tools/tripo/views`（Blender 调试渲染图）已加入 gitignore。
