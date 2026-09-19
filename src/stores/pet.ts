import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";
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
/** 单击/双击区分窗口（毫秒） */
const SLEEP_DURATION_MS = 5_000;

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

export const usePetStore = defineStore("pet", {
  state: () => ({
    stats: { ...DEFAULT_STATS },
    settings: { ...DEFAULT_SETTINGS },
    /** 临时动作动画（吃东西/玩耍/被摸等），结束后回落到基础状态 */
    tempAnimation: null as PetAnimation | null,
    bubble: { visible: false, text: "" },
    contextMenu: { visible: false, x: 0, y: 0 },
    settingsOpen: false,
    paused: false,
    sleeping: false,
    ready: false,
    lastWarnAt: {} as Record<"hunger" | "mood" | "energy", number>,
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
        await win.setSize(new LogicalSize(this.settings.petSize, this.settings.petSize));
        await win.setAlwaysOnTop(this.settings.alwaysOnTop);
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
        await win.onMoved(({ payload }) => {
          this.scheduleSaveWindowPos({ x: payload.x, y: payload.y });
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
    // 右键菜单
    // ------------------------------------------------------------------
    openContextMenu(x: number, y: number): void {
      this.contextMenu = { visible: true, x, y };
    },

    closeContextMenu(): void {
      if (this.contextMenu.visible) {
        this.contextMenu = { ...this.contextMenu, visible: false };
      }
    },

    handleMenuAction(action: MenuAction): void {
      this.closeContextMenu();
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
    // 设置
    // ------------------------------------------------------------------
    async openSettings(): Promise<void> {
      if (this.settingsOpen) return;
      this.settingsOpen = true;
      const win = getCurrentWindow();
      try {
        await win.show();
        await win.setFocus();
        await win.setSize(new LogicalSize(360, 620));
      } catch (err) {
        console.warn("打开设置窗口失败:", err);
      }
    },

    async closeSettings(): Promise<void> {
      if (!this.settingsOpen) return;
      this.settingsOpen = false;
      try {
        await getCurrentWindow().setSize(
          new LogicalSize(this.settings.petSize, this.settings.petSize),
        );
      } catch (err) {
        console.warn("恢复窗口大小失败:", err);
      }
      await this.saveSettings();
    },

    /** 设置面板内任意一项变化后立即生效（窗口大小在关闭面板时应用） */
    async onSettingsChanged(): Promise<void> {
      const win = getCurrentWindow();
      try {
        await win.setAlwaysOnTop(this.settings.alwaysOnTop);
      } catch (err) {
        console.warn("切换置顶失败:", err);
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
  },
});
