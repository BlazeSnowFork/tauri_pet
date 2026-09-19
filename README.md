# tauri-desktop-pet 🐱

基于 **Tauri 2.x + Vue 3 + TypeScript + Pinia** 的桌面小宠物：透明、无边框、始终置顶的小窗口，支持拖拽、喂食、玩耍、睡觉等养成交互，带系统托盘、本地持久化与定时提醒。

## 文件结构

```
tauri-desktop-pet/
├── index.html                     # Vite 入口 HTML
├── package.json                   # npm 依赖与脚本
├── vite.config.ts                 # Vite 配置（@ 别名指向 src）
├── tsconfig.json
├── scripts/
│   ├── gen-icons.mjs              # 纯 Node 生成应用图标（PNG/ICO，无第三方依赖）
│   └── add-user-path.ps1          # 将 cargo/mingw 加入用户 PATH（Windows 辅助脚本）
├── src/
│   ├── main.ts                    # 应用入口：创建 Pinia、加载样式
│   ├── App.vue                    # 根组件：初始化 store、组装各组件、菜单外点击关闭
│   ├── components/
│   │   ├── Pet.vue                # 宠物本体：SVG 形象 + 拖拽/单击/双击/右键
│   │   ├── SpeechBubble.vue       # 语音气泡
│   │   ├── ContextMenu.vue        # 右键自定义菜单（喂食/玩耍/睡觉/设置/隐藏/退出）
│   │   └── SettingsPanel.vue      # 设置面板（窗口自动放大显示）
│   ├── stores/
│   │   └── pet.ts                 # Pinia store：状态机、衰减定时器、持久化、提醒、托盘事件
│   ├── types/
│   │   └── index.ts               # 全部 TypeScript 类型定义
│   └── styles/
│       ├── main.css               # 全局样式（透明窗口、事件穿透）
│       ├── pet.css                # 宠物外观与 8 种状态动画（纯 CSS）
│       └── ui.css                 # 气泡/右键菜单/设置面板样式
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json            # 透明/无边框/置顶/跳过任务栏窗口配置
    ├── capabilities/default.json  # 权限：窗口拖拽与设置、store、通知、自启
    ├── .cargo/config.toml         # 本项目 crates.io 国内镜像（RsProxy）
    ├── icons/                     # 应用图标（npm run icons 可重新生成）
    └── src/
        ├── main.rs                # 入口
        └── lib.rs                 # 插件注册、系统托盘、exit_app 命令
```

## 环境准备

- **Node.js ≥ 18**、npm
- **Rust ≥ 1.77**（stable）
- WebView2 Runtime（Windows 11 自带）

### Windows 工具链说明（重要）

Tauri 官方推荐 **MSVC 工具链**，但本机已验证可用的是 **GNU 工具链 + MSYS2 MinGW**（无需安装数 GB 的 Visual Studio Build Tools）。本机已完成的配置：

1. rustup 安装了 `stable-x86_64-pc-windows-gnu` 工具链（RsProxy 镜像加速）；
2. MSYS2 装在 `C:\Users\lenovo\msys64`，已装 `mingw-w64-x86_64-binutils` 和 `mingw-w64-x86_64-gcc`（`windres` 嵌入图标需要 gcc 预处理器）；
3. `C:\Users\lenovo\msys64\mingw64\bin` 已加入用户 PATH。

如需在其他机器复现：

```powershell
# 1. 安装 rustup（国内镜像加速）
$env:RUSTUP_DIST_SERVER = "https://rsproxy.cn"
$env:RUSTUP_UPDATE_ROOT = "https://rsproxy.cn/rustup"
winget install Rustlang.Rustup   # 或下载 rustup-init.exe
rustup default stable-x86_64-pc-windows-gnu

# 2. 安装 MSYS2 + MinGW 工具（TUNA 镜像）
# 从 https://mirrors.tuna.tsinghua.edu.cn/msys2/distrib/ 下载安装器
pacman -S --noconfirm --needed mingw-w64-x86_64-binutils mingw-w64-x86_64-gcc

# 3. 把以下目录加入 PATH
#    %USERPROFILE%\.cargo\bin
#    C:\msys64\mingw64\bin   （按实际安装位置）
```

> 若后续安装了 Visual Studio Build Tools，可改用官方 MSVC 工具链：`rustup default stable-x86_64-pc-windows-msvc`，届时无需 MinGW。`src-tauri/.cargo/config.toml` 中的 crates.io 镜像可按需移除。

## 安装与运行

```bash
npm install          # 安装前端依赖
npm run tauri dev    # 开发模式：热重载，桌面出现小宠物
```

## 构建打包

```bash
npm run tauri build          # 发布构建，产物在 src-tauri/target/release/bundle/
npm run tauri build -- --nsis   # Windows 仅打 NSIS 安装包
```

其他脚本：

```bash
npm run dev        # 仅启动前端（浏览器预览，无 Tauri 外壳）
npm run build      # vue-tsc 类型检查 + vite 打包
npm run typecheck  # 仅类型检查
npm run icons      # 重新生成应用图标
```

## 功能速览

| 交互 | 效果 |
| --- | --- |
| 左键单击 | 随机动作 + 气泡文字 |
| 左键双击 | 开心动画，心情 +5 |
| 左键拖拽 | 移动窗口，松手自动保存坐标（重启恢复） |
| 右键 | 自定义菜单：喂食(+20 饱食 +5 心情) / 玩耍(+15 心情 -10 精力) / 睡觉(5 秒后 +30 精力) / 设置 / 隐藏 / 退出 |
| 托盘菜单 | 显示/隐藏、暂停/恢复衰减、打开设置、退出 |
| 每 10 秒 | 三项数值按可配置速率衰减；过低时气泡提醒 |
| 定时提醒 | 默认每 60 分钟系统通知"喝水/休息"，可开关 |

设置面板可调：宠物大小、始终置顶、开机自启、动画速度、衰减速度、定时提醒间隔、重置状态。数据通过 `tauri-plugin-store` 持久化到应用配置目录的 `pet-store.json`。

## 平台注意事项

### Windows
- 透明窗口依赖 WebView2（系统自带或随安装包分发）。
- GNU 工具链下首次编译较慢，属正常；构建产物已验证可编译链接。

### macOS
- 配置中已开启 `app.macOSPrivateApi: true`（透明窗口所需）。
- 打包前建议用官方图标生成完整 `.icns`：`npm run tauri icon src-tauri/icons/icon.png`（本项目 `bundle.icon` 目前只含 PNG/ICO，macOS bundle 需要 icns）。

### Linux
- 透明窗口需要运行合成器（GNOME/KDE 默认开启）；纯 X11 无合成器时窗口会显示黑底。
- Wayland 下窗口定位恢复可能受限（代码已做容错）。
- 系统通知依赖 `libnotify`。

## 已知设计取舍

- 托盘"暂停/恢复"菜单项文字为静态，当前暂停状态通过宠物气泡提示。
- 宠物形象为纯 SVG+CSS 绘制（耳朵/脸/腮红/眨眼/睡觉 Zzz），无任何外部素材。
- 双击通过 260ms 定时器区分，单击动作会有该时延。
