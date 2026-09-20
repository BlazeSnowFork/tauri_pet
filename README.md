# tauri-desktop-pet 🐱

基于 **Tauri 2.x + Vue 3 + TypeScript + Pinia** 的桌面小宠物：透明、无边框、始终置顶的小窗口，支持拖拽、喂食、玩耍、睡觉等养成交互，带系统托盘、本地持久化、定时提醒与**贴边隐藏**。

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
│   │   ├── Pet.vue                # 宠物本体：SVG 形象 + 拖拽/单击/双击/右键
│   │   ├── SpeechBubble.vue       # 语音气泡
│   │   ├── ContextMenu.vue        # 右键菜单窗口根组件
│   │   └── SettingsPanel.vue      # 设置窗口根组件
│   ├── stores/
│   │   └── pet.ts                 # Pinia store：状态机、定时器、持久化、贴边隐藏、跨窗口同步
│   ├── types/
│   │   └── index.ts               # 全部 TypeScript 类型定义
│   └── styles/
│       ├── main.css               # 全局样式（透明窗口、事件穿透）
│       ├── pet.css                # 宠物外观与 8 种状态动画（纯 CSS）
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

单窗口方案下，右键菜单和设置面板都被 200×200 的宠物窗口裁剪，显示不全。现在拆成三个窗口：

| 窗口 | 用途 | 关键配置 |
| --- | --- | --- |
| `main` | 宠物本体 | 透明、无边框、置顶、跳过任务栏、`shadow: false` |
| `pet-menu` | 右键菜单（按光标位置弹出，自动贴边收敛，失焦自动关闭） | 透明、无边框、置顶、跳过任务栏、固定 176×244 |
| `pet-settings` | 设置面板（原生标题栏，可移动/缩放，点关闭只隐藏） | 普通窗口，380×640，非置顶 |

三者在同一份前端产物里，`src/main.ts` 根据 `getCurrentWindow().label` 挂载不同根组件。菜单与设置窗口是**独立 JS 上下文**，配置与数值通过 Tauri 事件双向同步：

- `settings://request` → 宠物窗口回 `settings://sync`（设置一项即生效并持久化）
- `settings://changed` / `settings://reset-stats` ← 设置窗口改动时发出
- `settings://stats` → 每 10 秒刷新设置面板里的数值预览
- `menu://action` ← 菜单窗口选中动作后广播

## 贴边隐藏行为

1. 把宠物拖到屏幕边缘（距可用区域边界 ≤12 逻辑像素）并松开 → 窗口滑动到屏幕外，**只保留 42% 可见**。
2. **点击露出的那部分** → 宠物完整滑回屏幕内（不会触发随机动作）。
3. 松开时没有贴到边缘 → 不触发隐藏，并把窗口收回到可用区域内，**不会出现"半截挂在屏幕外"的状态**。
4. 拖拽结束的判定**不依赖 `startDragging` 的返回时机**（各平台语义不一致）：由窗口移动事件去抖动得出——连续 400ms 没有新的移动即视为拖拽结束。

阈值、可见比例、去抖动时长、动画时长都在 `src/stores/pet.ts` 顶部常量里（`EDGE_SNAP_THRESHOLD` / `EDGE_VISIBLE_RATIO` / `DRAG_END_DEBOUNCE_MS` / `EDGE_ANIM_MS`），可自行调整。

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

其他脚本：`npm run dev`（仅前端）、`npm run build`（类型检查 + 打包）、`npm run typecheck`、`npm run icons`。

## 功能速览

| 交互 | 效果 |
| --- | --- |
| 左键单击 | 随机动作 + 气泡文字 |
| 左键双击 | 开心动画，心情 +5 |
| 左键拖拽 | 移动窗口，松开后保存坐标；靠近屏幕边缘则贴边隐藏 |
| 点击贴边的宠物 | 从边缘完整滑回 |
| 右键 | 独立菜单窗口：喂食(+20 饱食 +5 心情) / 玩耍(+15 心情 -10 精力) / 睡觉(5 秒后 +30 精力) / 设置 / 隐藏 / 退出 |
| 托盘菜单 | 显示/隐藏、暂停/恢复衰减、打开设置、退出 |
| 每 10 秒 | 三项数值按可配置速率衰减；过低时气泡提醒 |
| 定时提醒 | 默认每 60 分钟系统通知"喝水/休息"，可开关 |

设置项：宠物大小、始终置顶、开机自启、动画速度、衰减速度、定时提醒开关与间隔、重置宠物状态。数据通过 `tauri-plugin-store` 持久化到应用配置目录的 `pet-store.json`。

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
- 宠物形象为纯 SVG+CSS 绘制（耳朵/脸/腮红/眨眼/睡觉 Zzz），无任何外部素材。
- 单击通过 260ms 定时器与双击区分，单击动作有该时延。
