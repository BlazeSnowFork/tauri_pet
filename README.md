# tauri-desktop-pet 🐱

基于 **Tauri 2.x + Vue 3 + TypeScript + Pinia** 的桌面小宠物：透明、无边框、始终置顶的小窗口，多套 SVG 形象（默认"毛绒小熊"）与十几种闲置小动作随机轮换，支持拖拽（含甩动回弹）、眼睛跟随鼠标、喂食、玩耍、说话、睡觉等互动，带系统托盘、本地持久化、整点报时、连续用机休息提醒、省电模式，以及四边四角的**贴边探头姿态**（多显示器感知）。

## 文件结构

```
tauri-desktop-pet/
├── index.html                     # Vite 入口 HTML
├── package.json                   # npm 依赖与脚本
├── vite.config.ts                 # Vite 配置（@ 别名指向 src，固定 5174 端口）
├── tsconfig.json
├── scripts/
│   ├── gen-icons.mjs              # 纯 Node 生成应用图标（PNG/ICO，无第三方依赖）
│   └── add-user-path.ps1          # 将 cargo/mingw 加入用户 PATH（Windows 辅助脚本）
├── src/
│   ├── main.ts                    # 应用入口：按窗口 label 挂载不同根组件
│   ├── App.vue                    # 宠物主窗口根组件
│   ├── components/
│   │   ├── Pet.vue                # 宠物本体：三套 SVG 形象 + 拖拽/单击/双击/右键
│   │   ├── SpeechBubble.vue       # 语音气泡
│   │   ├── ContextMenu.vue        # 右键菜单窗口根组件
│   │   └── SettingsPanel.vue      # 设置窗口根组件
│   ├── stores/
│   │   └── pet.ts                 # Pinia store：状态机、定时器、持久化、贴边隐藏/探头、跨窗口同步
│   ├── logic/
│   │   ├── edge.ts                # 贴边/角落吸附的纯几何函数（物理像素、无副作用，可直接单测）
│   │   ├── settings.ts            # 存档版本 SETTINGS_VERSION 与 mergeSettings 前向兼容合并
│   │   └── __tests__/             # Vitest 单元测试（npm run test）
│   ├── types/
│   │   └── index.ts               # 全部 TypeScript 类型定义
│   └── styles/
│       ├── main.css               # 全局样式（透明窗口、事件穿透）
│       ├── pet.css                # 形象皮肤、状态/闲置动作、贴边探头与四角姿态动画（纯 CSS）
│       └── ui.css                 # 气泡 / 右键菜单 / 设置面板样式
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json            # 三个窗口：main / pet-menu / pet-settings
    ├── capabilities/default.json  # 权限：窗口几何与设置、store、通知、自启
    ├── .cargo/config.toml         # 本项目 crates.io 国内镜像（RsProxy）
    ├── icons/                     # 应用图标（npm run icons 可重新生成）
    └── src/
        ├── main.rs                # 入口
        └── lib.rs                 # 插件注册、系统托盘、窗口命令
```

## 三个窗口的分工（重要设计）

单窗口方案下，右键菜单和设置面板都被宠物窗口裁剪，显示不全。现在拆成三个窗口：

| 窗口 | 用途 | 关键配置 |
| --- | --- | --- |
| `main` | 宠物本体 | 透明、无边框、置顶、跳过任务栏、`shadow: false`；初始 300×300，运行时 = 宠物大小 × `WINDOW_PAD(1.25)` |
| `pet-menu` | 右键菜单（按光标位置弹出，自动贴边收敛，失焦自动关闭） | 透明、无边框、置顶、跳过任务栏、固定 176×282 |
| `pet-settings` | 设置面板（原生标题栏，可移动/缩放，点关闭只隐藏） | 普通窗口，380×640，非置顶 |

三者在同一份前端产物里，`src/main.ts` 根据 `getCurrentWindow().label` 挂载不同根组件。菜单与设置窗口是**独立 JS 上下文**，配置通过 Tauri 事件双向同步：

- `settings://request` → 宠物窗口回 `settings://sync`（设置一项即生效并持久化）
- `settings://changed` ← 设置窗口改动时发出
- `menu://action` ← 菜单窗口选中动作后广播

## 形象与动作

- **三套皮肤**（设置面板切换，默认"毛绒小熊"）：毛绒小熊 `bear-full`（径向渐变绒毛 + feTurbulence 毛边滤镜 + 毛发纹理叠层，站姿全身造型）、大头小熊 `bear`、小猫 `cat`。全部为内联 SVG + CSS 绘制，无外部素材。
- **皮肤专属微动画**：毛绒小熊有耳朵抽动、肚皮呼吸、双臂交替轻摆、腿部重心交换、嘴巴咕哝、鼻子轻颤等，周期互为错拍（负延迟相移），不会机械同步。
- **闲置动作轮换**：随机模式下每 6~13 秒换一种小动作（起伏/伸懒腰/张望/小跳/抖擞/歪倚/晃悠/转圈/跳舞/点头/蠕扭/挥手/拍拍肚/踢腿/扭扭，共 15 种）；固定模式保持轻微起伏。动作池只存于运行时状态，不入库。
- **贴边时的"专注式"动作**：吸附在边缘/角落后随机轮换只从低幅度池（起伏/歪倚/晃悠/点头/张望）中选取，且脱离边缘时不再播放旋转动作，避免打扰使用者。
- **视线跟随**：闲置时眼睛（三层皮肤的 `.eyes` 组）随鼠标方向小幅注视，范围 ±260 逻辑像素内归一化，220ms 节流、0.25s 缓动；窗口隐藏（托盘）、睡觉或暂停动画时停止。
- **甩动回弹**：拖拽松手前 250ms 内平均速度 ≥1 px/ms 判定为"甩"，宠物朝甩动方向做一次挤压弹跳（0.62s，作用于 `.pet-wrap`，不与身体/探头动画抢通道）。

## 贴边隐藏与探头姿态

1. 把宠物拖到屏幕边缘（距可用区域边界 ≤12 逻辑像素）并松开 → 窗口滑出屏幕，只保留一部分可见：左/右缘 42%、上缘 50%、下缘 30%。
2. **探头姿态**（作用于内层 `.pet-svg`，与外层身体动画叠加）：左右缘朝桌面可见一侧歪头 22°~36° 轻摆、单手撑边；上缘整个倒挂 180°、头朝向屏幕内；下缘藏身只露头、双手扒底边。
3. **四角吸附**：同时贴近两条边（容差 40 逻辑像素）判定为角落，横竖偏移叠加且露出比例加大到 58%。左上/右上角以约 135°（倒挂再斜 45°）垂挂、头朝桌面内侧浮动；左下/右下角以约 45° 斜靠着底边偷看。
4. **点击露出的那部分** → 宠物完整滑回屏幕内（不触发随机动作）。
5. 松开时没有贴到边缘 → 不触发隐藏，并把窗口收回到可用区域内，**不会出现"半截挂在屏幕外"的状态**。
6. 拖拽结束的判定**不依赖 `startDragging` 的返回时机**（各平台语义不一致）：由窗口移动事件去抖动得出——连续 400ms 没有新的移动即视为拖拽结束。
7. **多显示器**：贴边/滑回按"窗口中心点落在哪块屏"选择显示器（`pickMonitor`），跨屏松手瞬间不会误用旧屏的可用区。

几何计算（gap 计算、最近边、角落判定、吸附/滑回目标、clamp）全部抽在 `src/logic/edge.ts` 的纯函数里，参数与返回值均为物理像素，`src/logic/__tests__/edge.test.ts` 对其逐项断言。阈值、各边/角落可见比例仍集中在 `src/stores/pet.ts` 顶部常量（`EDGE_SNAP_THRESHOLD` / `EDGE_RATIOS` / `CORNER_SNAP_TOLERANCE` / `WINDOW_PAD`）与 `src/styles/pet.css` 的 `peek-*` 关键帧里，角度/位移均为单处可调数值；edge.ts 文件头注释给出了"露出比例 ↔ 画面内容线"的换算公式，与 CSS 数值互相引用。

## 环境准备

- **Node.js ≥ 18**、npm
- **Rust ≥ 1.77**（stable）
- WebView2 Runtime（Windows 11 自带）

### Windows 工具链说明

Tauri 官方推荐 **MSVC 工具链**，本机已验证可用的是 **GNU 工具链 + MSYS2 MinGW**（无需安装数 GB 的 Visual Studio Build Tools）：

```powershell
# 1. 安装 rustup（国内镜像加速）
$env:RUSTUP_DIST_SERVER = "https://rsproxy.cn"
$env:RUSTUP_UPDATE_ROOT = "https://rsproxy.cn/rustup"
rustup default stable-x86_64-pc-windows-gnu

# 2. 安装 MSYS2 后补 MinGW 工具（windres 嵌入图标需要 gcc 预处理器）
#    https://mirrors.tuna.tsinghua.edu.cn/msys2/distrib/
pacman -S --noconfirm --needed mingw-w64-x86_64-binutils mingw-w64-x86_64-gcc

# 3. 把以下目录加入 PATH
#    %USERPROFILE%\.cargo\bin
#    C:\msys64\mingw64\bin
```

## 安装与运行

```bash
npm install          # 安装前端依赖
npm run tauri dev    # 开发模式：热重载，桌面出现小宠物
```

## 构建打包

```bash
npm run tauri build            # 发布构建，产物在 src-tauri/target/release/bundle/
npm run tauri build -- --nsis  # Windows 仅打 NSIS 安装包
```

其他脚本：`npm run dev`（仅前端）、`npm run build`（类型检查 + 打包）、`npm run typecheck`、`npm run test`（Vitest 单测，覆盖 `src/logic/` 纯函数）、`npm run icons`。

## 功能速览

> 饱食/心情/精力数值系统已在 2026-09 整体移除，宠物不再有"养死"压力，互动只给反馈。

| 交互 / 时机 | 效果 |
| --- | --- |
| 左键单击 | 随机反应动作 + 气泡文字；800ms 内连点 3 次触发"被戳晕"彩蛋 |
| 左键双击 | 开心动画 |
| 左键拖拽 | 移动窗口，松开后保存坐标；快速甩动会触发回弹挤压；靠近屏幕边缘/角落则贴边探头（见上文） |
| 点击贴边的宠物 | 从边缘完整滑回 |
| 右键菜单 | 喂食（30 秒内投喂 4 次触发"吃撑了"彩蛋）/ 玩耍 / 说话 / 睡觉 / 设置 / 隐藏 / 退出 |
| 托盘菜单 | 显示/隐藏宠物、暂停/恢复动画、打开设置、退出 |
| 睡觉 | 最长 60 秒自动醒；期间点一下会带"起床气"提前叫醒 |
| 主动行为 | 每 40~100 秒随机搭话、求陪玩或自言自语（可开关，贴边/睡觉/忙动作时不打扰） |
| 整点报时 | 每到整点气泡报时（可开关） |
| 休息提醒 | 依据 Rust `get_idle_ms`（Win32 `GetLastInputInfo`）统计连续用机时长，默认 45 分钟气泡 + 系统通知提醒；离开 ≥5 分钟自动清零重计（可开关） |
| 闲置注视 | 眼睛跟随鼠标方向小幅环视（见"形象与动作"） |

设置项：宠物形象、闲置动作模式（固定/随机）、宠物大小、始终置顶、开机自启、动画速度、主动互动开关、整点报时开关、休息提醒开关与间隔分钟、**省电模式**（关闭绒毛滤镜与四肢微动画，仅保留主体动作，适合低功耗设备）。数据通过 `tauri-plugin-store` 持久化到应用配置目录的 `pet-store.json`（含皮肤 `bear-full` 等稳定 key，勿随意改名）；读取时经 `mergeSettings` 合并默认值并夹取合法区间，老存档缺新 key 不会出错（`SETTINGS_VERSION` 预留迁移锚点）。

定时策略：宠物窗口被托盘隐藏时调用 `parkTimers()` 停掉闲置轮换/主动搭话/视线跟随等全部定时器，重新聚焦后幂等重启，不空转耗电。

## 平台注意事项与已知取舍

### 窗口尺寸相关的取舍（Windows）

无边框宠物窗口做了两项特殊处理，都是被 Windows 行为逼出来的：

1. **`"shadow": false`** —— 去掉无边框窗口那圈阴影（在浅色桌面上看起来像"黑色外框"）。副作用：Windows 上禁用窗口阴影会让窗口变成"不可调整大小"，Tauri 的 `setSize` 随之失效。
2. **`"resizable": false` + `"maximizable": false`** —— 禁用 Windows 的 **Aero Snap**。否则把窗口拖到屏幕边缘松手时，系统会擅自把窗口贴靠/最大化（改大尺寸），而宠物是按窗口百分比绘制的，于是会"先放大再贴边"。

因此宠物窗口尺寸统一走 Rust 命令 `set_pet_size`，内部直接调用 Win32 `SetWindowPos`，不受上述两项影响（非 Windows 平台回退到 `set_size`）。另外 `handleDragEnd` 在贴边前会调用 `ensurePetSize()` 校核一次尺寸，即便尺寸被外部改动也会先改回配置值——这是兜底，双保险。

### Windows / macOS / Linux

- **Windows**：透明窗口依赖 WebView2（系统自带或随包分发）；首次编译较慢属正常。
- **macOS**：已开启 `app.macOSPrivateApi`（透明窗口所需）；打包前建议 `npm run tauri icon src-tauri/icons/icon.png` 生成 `.icns`。
- **Linux**：透明窗口需要合成器（GNOME/KDE 默认开启），无合成器时会显示黑底；系统通知依赖 `libnotify`。

### 其他

- 托盘"暂停/恢复"菜单项文字为静态，当前状态通过宠物气泡提示。
- 宠物形象为纯 SVG+CSS 绘制（渐变绒毛、毛边滤镜、毛发纹理、眨眼/腮红/睡觉 Zzz 均由状态驱动），无任何外部素材。
- 单击通过 260ms 定时器与双击区分，单击动作有该时延。
