import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { disable, enable } from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { load, type Store } from "@tauri-apps/plugin-store";
import { defineStore } from "pinia";

import type {
  MenuAction,
  PetAnimation,
  PetSettings,
  PetStats,
  ScreenEdge,
  SettingsSyncPayload,
  WindowPosition,
} from "@/types";

const STORE_FILE = "pet-store.json";
const STATS_KEY = "stats";
const SETTINGS_KEY = "settings";
const WINDOW_POS_KEY = "windowPosition";

/** 每次衰减的基础速率（每 10 秒），实际值会乘以设置中的 decaySpeed */
const DECAY_PER_TICK = { hunger: 1, mood: 0.8, energy: 0.6 };
/** 数值低于该阈值时弹出气泡提醒 */
const LOW_THRESHOLD = 20;
/** 低状态提醒的冷却时间（毫秒） */
const WARN_COOLDOWN_MS = 60_000;
/** 睡觉持续时间（毫秒） */
const SLEEP_DURATION_MS = 5_000;
/** 拖拽结束位置距屏幕边缘小于该值（逻辑像素）时吸附隐藏 */
const EDGE_SNAP_THRESHOLD = 12;
/** 窗口停止移动多久后判定拖拽结束（毫秒） */
const DRAG_END_DEBOUNCE_MS = 400;
/** 吸附隐藏后仍保留可见的窗口比例 */
const EDGE_VISIBLE_RATIO = 0.42;
/** 滑出 / 滑入动画时长（毫秒） */
const EDGE_ANIM_MS = 200;

export const DEFAULT_STATS: PetStats = { hunger: 80, mood: 80, energy: 80 };

export const DEFAULT_SETTINGS: PetSettings = {
  petSize: 300,
  alwaysOnTop: true,
  autostart: false,
  animationSpeed: 1,
  decaySpeed: 1,
  reminderEnabled: true,
  reminderIntervalMin: 60,
};

const CLICK_PHRASES = [
  "你好呀~",
  "今天也要加油哦!",
  "摸摸我嘛~",
  "嘿嘿，好痒~",
  "想我了没？",
  "陪你工作真好~",
];

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

// 模块级资源：持久化句柄、定时器与事件反注册函数
let db: Store | null = null;
let unlistenFns: UnlistenFn[] = [];
let decayTimer: number | null = null;
let reminderTimer: number | null = null;
let bubbleTimer: number | null = null;
let animTimer: number | null = null;
let sleepTimer: number | null = null;
let statsSaveTimer: number | null = null;
let posSaveTimer: number | null = null;
let dragEndTimer: number | null = null;

export const usePetStore = defineStore("pet", {
  state: () => ({
    stats: { ...DEFAULT_STATS },
    settings: { ...DEFAULT_SETTINGS },
    /** 临时动作动画（吃东西/玩耍/被摸等），结束后回落到基础状态 */
    tempAnimation: null as PetAnimation | null,
    bubble: { visible: false, text: "" },
    paused: false,
    sleeping: false,
    /** 当前贴在哪条屏幕边缘（null 表示未贴边） */
    edge: null as ScreenEdge | null,
    /** 是否已部分滑出屏幕 */
    edgeHidden: false,
    /** 滑出/滑入动画进行中，避免重入 */
    sliding: false,
    /** 是否处于"用户拖拽窗口"过程中 */
    dragActive: false,
    ready: false,
    lastWarnAt: { hunger: 0, mood: 0, energy: 0 } as Record<
      "hunger" | "mood" | "energy",
      number
    >,
  }),

  getters: {
    /** 当前应展示的动画：临时动作 > 睡觉 > 依据数值推导的基础状态 */
    displayAnimation(state): PetAnimation {
      if (state.tempAnimation) return state.tempAnimation;
      if (state.sleeping) return "sleep";
      if (state.stats.hunger < 30) return "hungry";
      if (state.stats.energy < 30) return "tired";
      if (state.stats.mood >= 70) return "happy";
      return "idle";
    },
  },

  actions: {
    // ------------------------------------------------------------------
    // 初始化
    // ------------------------------------------------------------------
    async init(): Promise<void> {
      if (this.ready) return;

      db = await load(STORE_FILE, { autoSave: true });

      const savedStats = await db.get<PetStats>(STATS_KEY);
      if (savedStats) this.stats = { ...DEFAULT_STATS, ...savedStats };
      const savedSettings = await db.get<Partial<PetSettings>>(SETTINGS_KEY);
      if (savedSettings) this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
      const savedPos = await db.get<WindowPosition | null>(WINDOW_POS_KEY);

      const win = getCurrentWindow();
      try {
        await win.setAlwaysOnTop(this.settings.alwaysOnTop);
        await this.applyPetSize(this.settings.petSize);
        if (savedPos) {
          await win.setPosition(new PhysicalPosition(savedPos.x, savedPos.y));
        }
      } catch (err) {
        console.warn("应用窗口设置失败:", err);
      }

      unlistenFns.push(
        await listen("tray://toggle-pause", () => this.togglePause()),
        await listen("tray://open-settings", () => {
          void this.openSettings();
        }),
        // 右键菜单与设置面板都在独立窗口里，通过事件与主窗口通信
        await listen<MenuAction>("menu://action", (event) => {
          this.handleMenuAction(event.payload);
        }),
        await listen("settings://request", () => {
          void this.emitSettingsSync();
        }),
        await listen<PetSettings>("settings://changed", (event) => {
          void this.applySettings(event.payload);
        }),
        await listen("settings://reset-stats", () => {
          void this.resetStats();
        }),
        await win.onMoved(({ payload }) => {
          this.scheduleSaveWindowPos({ x: payload.x, y: payload.y });
          this.noteWindowMoved();
        }),
        await win.onCloseRequested(async (event) => {
          // 点关闭按钮时隐藏到托盘而不是退出
          event.preventDefault();
          await this.saveAll();
          await this.hidePet();
        }),
      );

      this.startDecay();
      this.startReminder();
      void this.ensureNotificationPermission();

      this.ready = true;
      this.showBubble("我回来啦~");
    },

    // ------------------------------------------------------------------
    // 定时器
    // ------------------------------------------------------------------
    startDecay(): void {
      if (decayTimer !== null) clearInterval(decayTimer);
      decayTimer = window.setInterval(() => this.decayTick(), 10_000);
    },

    startReminder(): void {
      if (reminderTimer !== null) clearInterval(reminderTimer);
      if (!this.settings.reminderEnabled) return;
      const ms = Math.max(5, this.settings.reminderIntervalMin) * 60_000;
      reminderTimer = window.setInterval(() => {
        void this.sendReminder();
      }, ms);
    },

    async ensureNotificationPermission(): Promise<void> {
      try {
        if (!(await isPermissionGranted())) {
          await requestPermission();
        }
      } catch (err) {
        console.warn("申请通知权限失败:", err);
      }
    },

    async sendReminder(): Promise<void> {
      if (!this.settings.reminderEnabled) return;
      try {
        await sendNotification({
          title: "桌面宠物提醒",
          body: "记得喝水、起来活动一下哦~",
        });
      } catch (err) {
        console.warn("发送通知失败:", err);
      }
    },

    // ------------------------------------------------------------------
    // 状态衰减与低值提醒
    // ------------------------------------------------------------------
    decayTick(): void {
      if (!this.ready || this.paused || this.sleeping) return;
      const d = this.settings.decaySpeed;
      this.stats.hunger = clamp(this.stats.hunger - DECAY_PER_TICK.hunger * d);
      this.stats.mood = clamp(this.stats.mood - DECAY_PER_TICK.mood * d);
      this.stats.energy = clamp(this.stats.energy - DECAY_PER_TICK.energy * d);
      this.checkLowWarnings();
      this.saveStatsSoon();
      // 让设置面板里的数值预览保持最新
      void this.emitStats();
    },

    checkLowWarnings(): void {
      const now = Date.now();
      const warn = (key: "hunger" | "mood" | "energy", text: string): void => {
        if ((this.lastWarnAt[key] ?? 0) + WARN_COOLDOWN_MS > now) return;
        this.lastWarnAt[key] = now;
        this.showBubble(text);
      };
      if (this.stats.hunger <= LOW_THRESHOLD) warn("hunger", "肚子好饿，喂喂我吧…");
      else if (this.stats.mood <= LOW_THRESHOLD) warn("mood", "心情低落，陪我玩玩嘛…");
      else if (this.stats.energy <= LOW_THRESHOLD) warn("energy", "好累呀，让我睡一会…");
    },

    // ------------------------------------------------------------------
    // 交互动作
    // ------------------------------------------------------------------
    poke(): void {
      const phrase = CLICK_PHRASES[Math.floor(Math.random() * CLICK_PHRASES.length)];
      this.showTempAnimation("pet", 1800);
      this.showBubble(phrase);
    },

    doubleClickPoke(): void {
      this.stats.mood = clamp(this.stats.mood + 5);
      this.showTempAnimation("happy", 2500);
      this.showBubble("好开心！");
      this.saveStatsSoon();
    },

    feed(): void {
      this.stats.hunger = clamp(this.stats.hunger + 20);
      this.stats.mood = clamp(this.stats.mood + 5);
      this.showTempAnimation("eat", 3000);
      this.showBubble("真好吃~");
      this.saveStatsSoon();
    },

    play(): void {
      this.stats.mood = clamp(this.stats.mood + 15);
      this.stats.energy = clamp(this.stats.energy - 10);
      this.showTempAnimation("play", 3000);
      this.showBubble("再玩一次嘛~");
      this.saveStatsSoon();
    },

    sleep(): void {
      if (this.sleeping) return;
      this.sleeping = true;
      this.tempAnimation = null;
      if (sleepTimer !== null) clearTimeout(sleepTimer);
      this.showBubble("晚安…zzZ", SLEEP_DURATION_MS);
      sleepTimer = window.setTimeout(() => {
        this.sleeping = false;
        this.stats.energy = clamp(this.stats.energy + 30);
        this.showBubble("睡饱啦，精神满满!");
        this.saveStatsSoon();
      }, SLEEP_DURATION_MS);
    },

    togglePause(): void {
      this.paused = !this.paused;
      this.showBubble(this.paused ? "休息一下~" : "继续营业!");
    },

    async resetStats(): Promise<void> {
      this.stats = { ...DEFAULT_STATS };
      this.sleeping = false;
      this.tempAnimation = null;
      this.lastWarnAt = { hunger: 0, mood: 0, energy: 0 };
      this.showBubble("焕然一新!");
      await this.saveStats();
      await this.emitSettingsSync();
    },

    // ------------------------------------------------------------------
    // 气泡与临时动画
    // ------------------------------------------------------------------
    showBubble(text: string, ms = 3000): void {
      if (bubbleTimer !== null) clearTimeout(bubbleTimer);
      this.bubble = { visible: true, text };
      bubbleTimer = window.setTimeout(() => {
        this.bubble = { visible: false, text: "" };
      }, ms);
    },

    showTempAnimation(anim: PetAnimation, ms: number): void {
      if (animTimer !== null) clearTimeout(animTimer);
      this.tempAnimation = anim;
      const scaled = ms / Math.max(this.settings.animationSpeed, 0.1);
      animTimer = window.setTimeout(() => {
        this.tempAnimation = null;
      }, scaled);
    },

    // ------------------------------------------------------------------
    // 贴边隐藏：拖到屏幕边缘后滑出只留一部分，点击后完整滑回
    // ------------------------------------------------------------------
    /** 用户开始拖拽窗口 */
    beginDrag(): void {
      this.dragActive = true;
    },

    /**
     * 窗口移动事件驱动：拖拽中且连续一段时间没有新的移动，判定拖拽已结束。
     * 不依赖 startDragging 的返回时机（各平台语义不一致）。
     */
    noteWindowMoved(): void {
      if (!this.dragActive || this.sliding) return;
      if (dragEndTimer !== null) clearTimeout(dragEndTimer);
      dragEndTimer = window.setTimeout(() => {
        dragEndTimer = null;
        if (!this.dragActive) return;
        this.dragActive = false;
        void this.handleDragEnd();
      }, DRAG_END_DEBOUNCE_MS);
    },

    /** 鼠标抬起时兜底（Windows 的模态拖拽不一定回传 pointerup） */
    endDrag(): void {
      if (!this.dragActive) return;
      this.dragActive = false;
      if (dragEndTimer !== null) {
        clearTimeout(dragEndTimer);
        dragEndTimer = null;
      }
      void this.handleDragEnd();
    },

    /** 拖拽结束时调用：靠近屏幕边缘则吸附并部分滑出，否则把宠物拉回屏幕内 */
    async handleDragEnd(): Promise<void> {
      if (this.sliding) return;
      const win = getCurrentWindow();
      try {
        // 先校正窗口尺寸：Windows 的 Aero Snap（拖到边缘松手时系统贴靠/最大化）
        // 会擅自改大窗口，导致按百分比绘制的宠物被放大
        await this.ensurePetSize();

        const [pos, size, monitor] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          currentMonitor(),
        ]);
        if (!monitor) return;

        const work = monitor.workArea;
        const left = work.position.x;
        const top = work.position.y;
        const right = left + work.size.width;
        const bottom = top + work.size.height;

        const gaps: Record<ScreenEdge, number> = {
          left: pos.x - left,
          right: right - (pos.x + size.width),
          top: pos.y - top,
          bottom: bottom - (pos.y + size.height),
        };
        const edge = (Object.keys(gaps) as ScreenEdge[]).reduce((a, b) =>
          gaps[b] < gaps[a] ? b : a,
        );

        if (gaps[edge] > EDGE_SNAP_THRESHOLD * monitor.scaleFactor) {
          // 没有贴到边缘：清除贴边状态，并把窗口收回到可用区域内，
          // 避免宠物被拖成"半截挂在屏幕外"
          this.edge = null;
          this.edgeHidden = false;
          const clamped = {
            x: Math.min(Math.max(pos.x, left), right - size.width),
            y: Math.min(Math.max(pos.y, top), bottom - size.height),
          };
          if (clamped.x !== pos.x || clamped.y !== pos.y) {
            await this.slideTo(clamped, 120);
          }
          return;
        }

        const hiddenX = Math.round(size.width * (1 - EDGE_VISIBLE_RATIO));
        const hiddenY = Math.round(size.height * (1 - EDGE_VISIBLE_RATIO));
        const targets: Record<ScreenEdge, { x: number; y: number }> = {
          left: { x: left - hiddenX, y: pos.y },
          right: { x: right - size.width + hiddenX, y: pos.y },
          top: { x: pos.x, y: top - hiddenY },
          bottom: { x: pos.x, y: bottom - size.height + hiddenY },
        };

        this.edge = edge;
        this.edgeHidden = true;
        await this.slideTo(targets[edge]);
      } catch (err) {
        console.warn("贴边隐藏失败:", err);
      }
    },

    /** 点击贴在边缘的宠物：完整滑回屏幕内 */
    async revealFromEdge(): Promise<void> {
      if (!this.edge || this.sliding) return;
      const win = getCurrentWindow();
      const edge = this.edge;
      try {
        const [pos, size, monitor] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
          currentMonitor(),
        ]);
        if (!monitor) return;

        const work = monitor.workArea;
        const targets: Record<ScreenEdge, { x: number; y: number }> = {
          left: { x: work.position.x, y: pos.y },
          right: { x: work.position.x + work.size.width - size.width, y: pos.y },
          top: { x: pos.x, y: work.position.y },
          bottom: {
            x: pos.x,
            y: work.position.y + work.size.height - size.height,
          },
        };

        this.edge = null;
        this.edgeHidden = false;
        await this.slideTo(targets[edge]);
        this.showBubble("我出来啦~", 1500);
      } catch (err) {
        console.warn("滑回屏幕失败:", err);
      }
    },

    /** 逐帧移动窗口，模拟滑出/滑入动画 */
    async slideTo(target: { x: number; y: number }, ms = EDGE_ANIM_MS): Promise<void> {
      const win = getCurrentWindow();
      this.sliding = true;
      try {
        const from = await win.outerPosition();
        const steps = Math.max(1, Math.round(ms / 16));
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          const eased = 1 - Math.pow(1 - t, 3);
          await win.setPosition(
            new PhysicalPosition(
              Math.round(from.x + (target.x - from.x) * eased),
              Math.round(from.y + (target.y - from.y) * eased),
            ),
          );
          if (i < steps) {
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        }
      } finally {
        this.sliding = false;
      }
    },

    // ------------------------------------------------------------------
    // 右键菜单（独立窗口，由 Rust 侧定位并弹出）
    // ------------------------------------------------------------------
    openContextMenu(): void {
      void invoke("show_context_menu").catch((err) => {
        console.warn("弹出菜单失败:", err);
      });
    },

    handleMenuAction(action: MenuAction): void {
      switch (action) {
        case "feed":
          this.feed();
          break;
        case "play":
          this.play();
          break;
        case "sleep":
          this.sleep();
          break;
        case "settings":
          void this.openSettings();
          break;
        case "hide":
          void this.hidePet();
          break;
        case "quit":
          void this.exitApp();
          break;
      }
    },

    // ------------------------------------------------------------------
    // 设置（独立窗口 + 事件同步）
    // ------------------------------------------------------------------
    async openSettings(): Promise<void> {
      try {
        await invoke("show_settings_window");
      } catch (err) {
        console.warn("打开设置窗口失败:", err);
        return;
      }
      await this.emitSettingsSync();
    },

    /** 把当前配置与数值推送给设置窗口 */
    async emitSettingsSync(): Promise<void> {
      const payload: SettingsSyncPayload = {
        settings: JSON.parse(JSON.stringify(this.settings)),
        stats: JSON.parse(JSON.stringify(this.stats)),
      };
      await emit("settings://sync", payload);
    },

    /** 只推送数值（状态衰减时刷新设置面板预览） */
    async emitStats(): Promise<void> {
      await emit("settings://stats", JSON.parse(JSON.stringify(this.stats)));
    },

    /** 设置窗口改动后立即生效 */
    async applySettings(next: PetSettings): Promise<void> {
      this.settings = { ...DEFAULT_SETTINGS, ...next };

      try {
        await getCurrentWindow().setAlwaysOnTop(this.settings.alwaysOnTop);
      } catch (err) {
        console.warn("切换置顶失败:", err);
      }

      try {
        await this.applyPetSize(this.settings.petSize);
      } catch (err) {
        console.warn("调整宠物大小失败:", err);
      }

      try {
        if (this.settings.autostart) {
          await enable();
        } else {
          await disable();
        }
      } catch (err) {
        console.warn("切换开机自启失败:", err);
      }

      this.startReminder();
      await this.saveSettings();
    },

    /** 通过 Rust 命令调整宠物窗口尺寸（Windows 下绕开受 shadow 影响的 resize） */
    async applyPetSize(size: number): Promise<void> {
      await invoke("set_pet_size", { size });
    },

    /** 校验窗口尺寸是否仍与设置一致，不一致则改回来 */
    async ensurePetSize(): Promise<void> {
      try {
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const expected = Math.round(this.settings.petSize * scale);
        const outer = await win.outerSize();
        if (
          Math.abs(outer.width - expected) > 2 ||
          Math.abs(outer.height - expected) > 2
        ) {
          await this.applyPetSize(this.settings.petSize);
        }
      } catch (err) {
        console.warn("校正宠物尺寸失败:", err);
      }
    },

    // ------------------------------------------------------------------
    // 窗口与应用
    // ------------------------------------------------------------------
    async hidePet(): Promise<void> {
      try {
        await getCurrentWindow().hide();
      } catch (err) {
        console.warn("隐藏窗口失败:", err);
      }
    },

    async exitApp(): Promise<void> {
      await this.saveAll();
      try {
        await invoke("exit_app");
      } catch {
        window.close();
      }
    },

    scheduleSaveWindowPos(pos: WindowPosition): void {
      if (posSaveTimer !== null) clearTimeout(posSaveTimer);
      posSaveTimer = window.setTimeout(() => {
        void db?.set(WINDOW_POS_KEY, pos).then(() => db?.save());
      }, 500);
    },

    saveStatsSoon(): void {
      if (statsSaveTimer !== null) clearTimeout(statsSaveTimer);
      statsSaveTimer = window.setTimeout(() => {
        void this.saveStats();
      }, 1000);
    },

    async saveStats(): Promise<void> {
      if (!db) return;
      await db.set(STATS_KEY, JSON.parse(JSON.stringify(this.stats)));
      await db.save();
    },

    async saveSettings(): Promise<void> {
      if (!db) return;
      await db.set(SETTINGS_KEY, JSON.parse(JSON.stringify(this.settings)));
      await db.save();
    },

    async saveAll(): Promise<void> {
      await this.saveStats();
      await this.saveSettings();
    },

    /** 注销事件监听与定时器（组件卸载时调用） */
    dispose(): void {
      for (const fn of unlistenFns) fn();
      unlistenFns = [];
      for (const timer of [
        decayTimer,
        reminderTimer,
        bubbleTimer,
        animTimer,
        sleepTimer,
        statsSaveTimer,
        posSaveTimer,
        dragEndTimer,
      ]) {
        if (timer !== null) clearTimeout(timer);
      }
      decayTimer = null;
      reminderTimer = null;
      bubbleTimer = null;
      animTimer = null;
      sleepTimer = null;
      statsSaveTimer = null;
      posSaveTimer = null;
      dragEndTimer = null;
    },
  },
});
