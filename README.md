# MEGALODON DROP · 高空滑梯

基于 Three.js、TypeScript 和 Vite 的第一人称滑梯游戏。从高空滑行，越过断口并在空中修正方向；失控坠海时巨齿鲨会追猎，可从检查点复活。

## 启动

当前验证环境：Windows、Node.js **24.18.0**、npm **11.16.0**。使用支持 WebGL 的浏览器并开启硬件加速；自动浏览器检查还需要本机 Chrome。Node 版本应支持 `--experimental-strip-types`，这是模拟脚本的运行方式。

在项目根目录运行：

```powershell
npm ci
npm run dev -- --port 5174 --strictPort
```

访问 [本地游戏](http://127.0.0.1:5174/)。`--strictPort` 使端口占用时明确失败，避免 Vite 自动换端口后测试错项目。如果换端口，浏览器检查的 `PORT` 也要同步。`vite.config.ts` 原始默认端口为 5173。

构建与预览：

```powershell
npm run build
npm run preview -- --port 4173 --strictPort
```

预览使用构建后的 `dist/`；下面的自动浏览器回归使用开发服务，部分检查会导入 `/src/` 模块。

## 操作与当前关卡

- A / D 或左右方向键：转向；W / 上方向键：俯身加速；S / 下方向键：张开减速。
- 鼠标：环顾；Esc：暂停。界面提供静音与复活操作。
- 已有手柄与触屏输入实现；手机触控体验尚未完整验收。
- 当前关卡有 **9 段轨道、8 处断口、5 处窄道**，轨道总长约 **5958 m**，从 **1680 m** 降到约 **25 m**。
- 普通轨道内缘宽约 **5.29 m**，最窄约 **1.47 m**；窄道入口、出口各有 60 m 过渡，落地区加宽。
- 起点加 3 个途中检查点，共 4 个复活位置。**允许跨段落地、跳过中间路段的捷径**。

参数来源：[level.ts](src/track/level.ts)、[track.ts](src/track/track.ts)、[config.ts](src/core/config.ts)。正常断口腾空不会仅因离轨就触发坠海警告；已确认无法回到轨道的下坠才进入追猎。

## 验证命令

| 命令 | 检查内容 | 前提 |
| --- | --- | --- |
| `npm run lint` | Oxlint 检查 TypeScript 与 JS 工具脚本 | 安装依赖 |
| `npm run typecheck` | TypeScript 静态检查 | 安装依赖 |
| `npm run build` | 类型检查与生产构建 | 安装依赖 |
| `npm run sim` | 常规通关、捷径、失误风格、窄道过渡和边界碰撞断言 | Node，无需浏览器 |
| `npm run test:gameplay` | 正常断口、跨段捷径、高中低坠海、暂停、复活、GLB 与回退模型嘴部对齐 | 本项目 dev server、Chrome |
| `npm run test:lighting` | 六个高度的泛光上限与前景可读性，保存截图 | 本项目 dev server、Chrome |
| `git diff --check` | 差异中的空白错误 | Git 工作区 |

GitHub Actions 会在每次 push 和 pull request 上运行 lint、类型检查、构建和模拟。浏览器 / WebGL 回归暂不放进 CI；它们需要 Chrome 和图形环境，可在本地按下方步骤运行。不要仅凭构建通过宣称视觉或玩法验收完成。

保持开发服务运行，在另一个 PowerShell 终端执行：

```powershell
$env:PORT = '5174'
# Chrome 不在默认安装位置时设置实际路径：
$env:CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
npm run test:gameplay
npm run test:lighting
```

截图输出到 `tools/shots/`，不入库。浏览器回归按固定物理步长加速推进，不能作为实时性能数据。关卡变化后，应重新检查截图采样点确实覆盖目标视角。

旧工具 `node tools/keys.mjs` 和 `node tools/shots.mjs <name> "<query>" [maxSeconds]` 仍固定连接 **5173**，不读取 `PORT`；可用 `CHROME` 指定浏览器。使用前必须确认该端口属于本项目；它们不替代上面的回归入口。

## 调试入口

参数可组合，加载后仍需点击开始游戏。段号与检查点索引都从 0 开始。

| 参数 | 行为 |
| --- | --- |
| `?debug` | 将游戏实例暴露为 `window.__game`，可调用 `debugState()` |
| `?autopilot` | 使用自动驾驶 |
| `?autopilot&miss=4` | 在第 4 段减速并在对应飞行中偏离落地区，构造失误 |
| `?autopilot&cp=2` | 首次开局从检查点 2 出发，当前对应 seg4 |

`cp` 当前限制为 0–3。增加检查点时，需要同时核对 `src/main.ts` 的范围和回归脚本预期。`miss` 在自动驾驶下使用。

## 代码与文档入口

| 路径 | 内容 |
| --- | --- |
| `src/track/` | 关卡配置、轨道采样、落地检测 |
| `src/physics/`、`src/core/` | 骑手运动、预测、物理常量 |
| `src/game/` | 游戏状态、输入、镜头、自动驾驶 |
| `src/world/`、`src/fx/` | 轨道网格、环境、材质、后处理 |
| `src/sharks/`、`public/models/` | 鲨鱼行为与模型资产 |
| `src/ui/`、`src/audio/` | HUD、弹窗与音效 |
| `tools/` | 模拟、浏览器检查及资产处理脚本 |

- [AGENTS.md](AGENTS.md)：修改规范、玩法约束与按范围选择的验证要求。
- [docs/backlog.md](docs/backlog.md)：当前未完成项与带日期的历史审计。
- [progress.md](progress.md)：最近验证结果和历史进度。
- [task_plan.md](task_plan.md)：当前任务状态；[findings.md](findings.md)：诊断依据和测量记录。

Tripo / Blender 工具用于资产制作，运行游戏无需调用生成服务或配置生成服务密钥。原始下载、签名链接及实验截图不应提交，目录规则见 [.gitignore](.gitignore)。
