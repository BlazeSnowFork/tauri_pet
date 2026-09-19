请从零实现一个可运行、可构建的 Tauri 2.x 桌面宠物项目，项目名称为 `tauri-desktop-pet`。请输出完整项目代码、文件结构、依赖配置、运行说明和注意事项，不要只给伪代码或片段。

一、项目目标
开发一个桌面小宠物应用：宠物以透明、无边框、始终置顶的小窗口显示在桌面上，支持基础鼠标交互、状态养成、系统托盘、本地持久化和定时提醒。

二、技术栈
- 桌面框架：Tauri 2.x 最新稳定版
- 前端：Vue 3 + TypeScript + Vite + Pinia
- 后端：Rust
- 状态持久化：tauri-plugin-store 或 Rust 命令写入本地 JSON
- 系统通知：tauri-plugin-notification
- 开机自启：tauri-plugin-autostart
- 系统托盘：Tauri 2 的 TrayIconBuilder
- 包管理器：npm
- 动画资源：优先使用 CSS/SVG/Canvas 绘制或内联占位图，不要引用需要付费或登录的外部素材

三、窗口要求
- 主窗口透明：`transparent: true`
- 无边框：`decorations: false`
- 始终置顶：`alwaysOnTop: true`
- 不显示在任务栏：`skipTaskbar: true`
- 初始大小约 300x300，可调整
- 支持鼠标左键拖拽移动窗口，可使用 `data-tauri-drag-region` 或 `startDragging`
- 右键点击宠物时弹出前端自定义菜单
- 点击菜单外部关闭菜单
- 如果平台需要，请在 `tauri.conf.json` 和 capabilities 中正确配置透明窗口、通知、托盘、自启等权限

四、基础交互功能
1. 左键单击宠物：随机播放一个动作，并显示气泡文字，例如“你好呀”“今天也要加油”“摸摸我”。
2. 左键双击宠物：播放开心动画，心情值 +5。
3. 左键拖拽：移动宠物窗口位置，松开后保存窗口坐标。
4. 右键菜单包含：
   - 喂食：饱食度 +20，心情 +5，播放吃东西动画
   - 玩耍：心情 +15，精力 -10，播放玩耍动画
   - 睡觉：进入睡眠动画 5 秒，精力 +30
   - 设置：打开设置窗口或设置面板
   - 隐藏宠物：隐藏主窗口
   - 退出：退出应用
5. 宠物状态：
   - 饱食度 hunger：0-100
   - 心情 mood：0-100
   - 精力 energy：0-100
   - 每 10 秒按可配置速率衰减
   - 根据数值切换动画状态：idle、happy、hungry、tired、sleep
   - 状态过低时显示气泡提醒
6. 定时提醒：
   - 默认每 60 分钟发送一次系统通知，提醒喝水/休息
   - 可在设置中开启或关闭
7. 设置面板：
   - 宠物大小
   - 是否始终置顶
   - 是否开机自启
   - 动画速度
   - 状态衰减速度
   - 定时提醒开关
   - 重置宠物状态
8. 系统托盘：
   - 显示/隐藏宠物
   - 暂停/恢复动画与状态衰减
   - 打开设置
   - 退出应用

五、数据与持久化
- 宠物状态、窗口位置、设置项需要持久化
- 应用重启后恢复上次状态
- 使用 Pinia 管理前端状态
- 通过 Tauri `invoke` 调用 Rust 命令或插件完成读写
- 所有 TypeScript 类型必须完整，Rust 代码必须可编译

六、项目结构要求
请输出类似以下结构，并给出每个关键文件的完整代码：
- `package.json`
- `vite.config.ts`
- `index.html`
- `src/main.ts`
- `src/App.vue`
- `src/components/Pet.vue`
- `src/components/ContextMenu.vue`
- `src/components/SettingsPanel.vue`
- `src/components/SpeechBubble.vue`
- `src/stores/pet.ts`
- `src/types/index.ts`
- `src/styles/*.css`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/default.json`
- `README.md`

七、输出要求
1. 先给出完整文件树。
2. 然后按文件路径逐个给出完整代码，不要省略。
3. 给出安装依赖、开发运行、构建打包命令。
4. 说明 Windows、macOS、Linux 下的注意事项。
5. 如果某些 Tauri 2 API 与旧版不同，请以 Tauri 2 官方文档为准。
6. 代码要整洁、可维护，组件拆分合理。
7. 不要使用付费 API、登录服务或外部版权素材。
8. 如果动画素材缺失，请用 CSS/SVG 或内联 base64 占位，并保证项目能直接运行。

八、验收标准
- 执行 `npm install && npm run tauri dev` 可以启动。
- 桌面出现透明、无边框、置顶的小宠物。
- 可以拖拽、单击、双击、右键交互。
- 右键菜单功能正常。
- 宠物状态会变化并持久化。
- 系统托盘和系统通知可用。
- 设置面板可修改并保存配置。
- 项目代码完整，README 说明清晰。