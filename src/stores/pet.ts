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
  IdleVariant,
  MenuAction,
  PetAnimation,
  PetSettings,
  ScreenCorner,
  ScreenEdge,
  WindowPosition,
} from "@/types";

const STORE_FILE = "pet-store.json";
const SETTINGS_KEY = "settings";
const WINDOW_POS_KEY = "windowPosition";

/** 睡觉的最长持续时间（毫秒），期间点一下可以提前叫醒 */
const SLEEP_MAX_MS = 60_000;
/** 休息提醒：离开电脑超过该时长（毫秒）视为已休息，连续用机计时归零 */
const USER_AWAY_MS = 5 * 60_000;
/** 健康提醒的巡检周期（毫秒） */
const HEALTH_TICK_MS = 30_000;
/** 主动行为的最小 / 最大间隔（毫秒） */
const PROACTIVE_MIN_MS = 40_000;
const PROACTIVE_MAX_MS = 100_000;
/** 拖拽结束位置距屏幕边缘小于该值（逻辑像素）时吸附隐藏 */
const EDGE_SNAP_THRESHOLD = 12;
/** 距两条边都小于该值（逻辑像素）时判定为卡在屏幕角落 */
const CORNER_SNAP_TOLERANCE = 40;
/** 窗口停止移动多久后判定拖拽结束（毫秒） */
const DRAG_END_DEBOUNCE_MS = 400;
/** 吸附隐藏后仍保留可见的窗口比例 */
const EDGE_VISIBLE_RATIO = 0.42;
/** 上缘单独的比例：倒挂探头时吸附深度更浅，露出更多 */
const EDGE_TOP_VISIBLE_RATIO = 0.55;
/** 滑出 / 滑入动画时长（毫秒） */
const EDGE_ANIM_MS = 200;
/** 随机模式下两种闲置动作之间的最小 / 最大间隔（毫秒） */
const IDLE_SWITCH_MIN_MS = 6_000;
const IDLE_SWITCH_MAX_MS = 13_000;
/** 随机轮换的闲置动作池 */
const IDLE_VARIANTS: IdleVariant[] = [
  "bob",
  "stretch",
  "look",
  "hop",
  "shake",
  "lean",
  "sway",
  "spin",
  "dance",
  "nod",
  "squirm",
];
/** 连续快速点击达到该次数时触发"被戳晕"彩蛋反应 */
const COMBO_CLICKS = 3;
/** 判定连点的相邻点击间隔（毫秒） */
const COMBO_WINDOW_MS = 800;
/** 30 秒内投喂达到次数上限会触发"吃撑了"反应 */
const FEED_BURST_WINDOW_MS = 30_000;
const FEED_BURST_LIMIT = 4;

export const DEFAULT_SETTINGS: PetSettings = {
  petSkin: "bear",
  idleMode: "random",
  petSize: 300,
  alwaysOnTop: true,
  autostart: false,
  animationSpeed: 1,
  proactiveEnabled: true,
  timeReportEnabled: true,
  breakReminderEnabled: true,
  breakAfterMin: 45,
};

const CLICK_PHRASES = [
  "你好呀~",
  "今天也要加油哦!",
  "摸摸我嘛~",
  "嘿嘿，好痒~",
  "想我了没？",
  "陪你工作真好~",
];

const COMBO_PHRASES = [
  "别戳啦，要晕了~",
  "戳戳戳，是不是喜欢我呀",
  "好啦好啦，头晕头晕!",
];

const FEED_PHRASES = [
  "真好吃~",
  "啊呜啊呜……太香了!",
  "还要还要!",
  "这个是我最喜欢的!",
];

const FEED_TOO_MUCH_PHRASE = "唔…吃不下了，要撑啦!";

const PLAY_PHRASES = [
  "耶，一起玩~",
  "再玩一次嘛~",
  "和你玩最开心啦!",
  "我扔出去，你接住!",
];

const SLEEP_START_PHRASES = ["晚安…zzZ", "就睡一小会儿…"];

const WOKEN_UP_PHRASES = [
  "呜…干嘛叫醒我…",
  "再睡五分钟嘛，求求了?",
  "睡得正香呢…哼。",
];

const WAKE_UP_PHRASES = ["睡饱啦，精神满满!", "起来活动一下~"];

const TALK_PHRASES = [
  "你知道吗，发呆其实很累的",
  "盯着屏幕太久啦，看我放松一下眼睛 👀",
  "等下想吃点什么呀？帮你拿个主意!",
  "今天天气不错，好想出门晒太阳",
  "我给你表演一个原地转圈…算了，晕",
];

const PROACTIVE_PHRASES = [
  "在忙吗？记得喝口水~",
  "陪你待一会儿真好",
  "累了就摸我两下嘛~",
  "专注的你最有帅气啦!",
  "要不要站起来伸个懒腰？",
];

const DRAG_PHRASES = ["兜风咯~", "诶诶，轻点晃!", "这次搬到哪儿呀？"];

function randomFrom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function hourGreeting(hour: number): string {
  if (hour < 6) return "夜猫子，早点睡呀";
  if (hour < 9) return "早上好，新的一天开始啦!";
  if (hour < 12) return "上午适合专注做事，加油!";
  if (hour < 14) return "到点吃午饭啦!";
  if (hour < 18) return "下午也容易犯困，起来动动?";
  if (hour < 22) return "晚上啦，辛苦一天了";
  return "夜深了，别熬太晚哦";
}

// 模块级资源：持久化句柄、定时器与事件反注册函数
let db: Store | null = null;
let unlistenFns: UnlistenFn[] = [];
let bubbleTimer: number | null = null;
let animTimer: number | null = null;
let sleepTimer: number | null = null;
let posSaveTimer: number | null = null;
let dragEndTimer: number | null = null;
let idleTimer: number | null = null;
let proactiveTimer: number | null = null;
let healthTimer: number | null = null;
let spinTimer: number | null = null;
/** 连点判定 */
let lastClickAt = 0;
let clickCombo = 0;
/** 最近投喂的时间戳列表（吃撑彩蛋用） */
let recentFeeds: number[] = [];
/** 整点报时防重复 */
let lastReportedHour = -1;
/** 连续用机分钟数（离线巡检累加） */
let activeMinutes = 0;

export const usePetStore = defineStore("pet", {
  state: () => ({
    settings: { ...DEFAULT_SETTINGS },
    /** 临时动作动画（吃东西/玩耍/被摸等），结束后回落到 idle */
    tempAnimation: null as PetAnimation | null,
    bubble: { visible: false, text: "" },
    paused: false,
    sleeping: false,
    /** 当前贴在哪条屏幕边缘（null 表示未贴边） */
    edge: null as ScreenEdge | null,
    /** 同时贴近两条边时所在的屏幕角落（null 表示只贴一条边） */
    corner: null as ScreenCorner | null,
    /** 是否已部分滑出屏幕 */
    edgeHidden: false,
    /** 滑出/滑入动画进行中，避免重入 */
    sliding: false,
    /** 是否处于"用户拖拽窗口"过程中 */
    dragActive: false,
    /** 脱离边缘滑回时的旋转动作播放中 */
    spinning: false,
    /** 播放旋转动作时对应的边缘/角落方向 */
    spinEdge: null as ScreenEdge | ScreenCorner | null,
    /** 当前闲置动作变体（随机模式下定时轮换） */
    idleVariant: "bob" as IdleVariant,
    ready: false,
  }),

  getters: {
    /** 当前应展示的动画：临时动作 > 睡觉 > 闲置基础态 */
    displayAnimation(state): PetAnimation {
      if (state.tempAnimation) return state.tempAnimation;
      if (state.sleeping) return "sleep";
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

      if (savedPos) {
        // 上次退出时如果停在（或超出）屏幕边缘：重新启动时重放一次贴边判定，
        // 让宠物要么吸附回边缘隐藏态（带探头姿态），要么收回屏幕内完整可见
        await this.handleDragEnd();
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

      this.startIdleRotation();
      this.startProactive();
      this.startHealthTick();
      void this.ensureNotificationPermission();

      this.ready = true;
      this.showBubble("我回来啦~");
    },

    // ------------------------------------------------------------------
    // 定时器：闲置动作轮换 / 主动行为 / 健康提醒
    // ------------------------------------------------------------------
    /**
     * 闲置动作轮换：随机模式下每隔 6-13 秒切换一种小动作；
     * 固定模式（或暂停/睡觉）保持轻微的上下起伏。
     */
    startIdleRotation(): void {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
      if (this.settings.idleMode !== "random") {
        this.idleVariant = "bob";
        return;
      }
      const schedule = (): void => {
        const wait =
          IDLE_SWITCH_MIN_MS + Math.random() * (IDLE_SWITCH_MAX_MS - IDLE_SWITCH_MIN_MS);
        idleTimer = window.setTimeout(() => {
          idleTimer = null;
          if (
            this.settings.idleMode === "random" &&
            !this.paused &&
            this.displayAnimation === "idle"
          ) {
            const pool = IDLE_VARIANTS.filter((v) => v !== this.idleVariant);
            this.idleVariant = pool[Math.floor(Math.random() * pool.length)];
          }
          schedule();
        }, wait);
      };
      schedule();
    },

    /** 主动行为：每隔 40-100 秒随机搭话、求互动或自言自语 */
    startProactive(): void {
      if (proactiveTimer !== null) clearTimeout(proactiveTimer);
      proactiveTimer = null;
      const schedule = (): void => {
        const wait = PROACTIVE_MIN_MS + Math.random() * (PROACTIVE_MAX_MS - PROACTIVE_MIN_MS);
        proactiveTimer = window.setTimeout(() => {
          proactiveTimer = null;
          if (
            this.ready &&
            this.settings.proactiveEnabled &&
            !this.paused &&
            !this.sleeping &&
            !this.tempAnimation &&
            !this.bubble.visible &&
            !this.edgeHidden
          ) {
            const roll = Math.random();
            if (roll < 0.55) {
              this.showBubble(randomFrom(PROACTIVE_PHRASES), 4000);
            } else if (roll < 0.8) {
              this.showTempAnimation("play", 2500);
              this.showBubble("🎾 陪我玩一下嘛!", 4000);
            } else {
              this.showTempAnimation("pet", 1500);
              this.showBubble(randomFrom(TALK_PHRASES), 4000);
            }
          }
          schedule();
        }, wait);
      };
      schedule();
    },

    /** 整点报时 + 连续用机休息提醒的巡检定时器 */
    startHealthTick(): void {
      if (healthTimer !== null) clearInterval(healthTimer);
      healthTimer = window.setInterval(() => {
        void this.healthTick();
      }, HEALTH_TICK_MS);
    },

    async healthTick(): Promise<void> {
      const now = new Date();
      if (
        this.settings.timeReportEnabled &&
        !this.paused &&
        now.getMinutes() === 0 &&
        lastReportedHour !== now.getHours()
      ) {
        lastReportedHour = now.getHours();
        this.showBubble(
          `🕐 现在 ${now.getHours()} 点整，${hourGreeting(now.getHours())}`,
          5000,
        );
      }

      if (!this.settings.breakReminderEnabled) return;
      let idleMs = 0;
      try {
        idleMs = await invoke<number>("get_idle_ms");
      } catch (err) {
        console.warn("查询系统空闲时间失败，按持续在用计算:", err);
      }
      if (idleMs >= USER_AWAY_MS) {
        // 中途离开过：视为已休息，重新计时
        activeMinutes = 0;
        return;
      }
      activeMinutes += HEALTH_TICK_MS / 60_000;
      if (activeMinutes >= Math.max(15, this.settings.breakAfterMin)) {
        activeMinutes = 0;
        this.showBubble(
          `💫 连续用了 ${this.settings.breakAfterMin} 分钟电脑，站起来活动一下吧!`,
          6000,
        );
        void this.sendNotification(
          "该休息一下啦",
          "盯屏太久啦，起来倒杯水、远眺一分钟~",
        );
      }
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

    async sendNotification(title: string, body: string): Promise<void> {
      try {
        await sendNotification({ title, body });
      } catch (err) {
        console.warn("发送通知失败:", err);
      }
    },

    // ------------------------------------------------------------------
    // 互动动作
    // ------------------------------------------------------------------
    /** 单击：睡觉时先叫醒，平时随机换几种反应；连续快点触发彩蛋 */
    poke(): void {
      if (this.sleeping) {
        this.wakeUp(true);
        return;
      }
      const now = Date.now();
      clickCombo = now - lastClickAt < COMBO_WINDOW_MS ? clickCombo + 1 : 1;
      lastClickAt = now;
      if (clickCombo >= COMBO_CLICKS) {
        clickCombo = 0;
        this.showTempAnimation("happy", 2000);
        this.showBubble(randomFrom(COMBO_PHRASES));
        return;
      }
      const roll = Math.random();
      if (roll < 0.6) {
        this.showTempAnimation("pet", 1500);
        this.showBubble(randomFrom(CLICK_PHRASES));
      } else if (roll < 0.85) {
        this.showTempAnimation("happy", 1800);
        this.showBubble("嘿嘿~");
      } else {
        this.showTempAnimation("pet", 1200);
        this.showBubble(randomFrom(TALK_PHRASES));
      }
    },

    doubleClickPoke(): void {
      if (this.sleeping) {
        this.wakeUp(true);
        return;
      }
      this.showTempAnimation("happy", 2500);
      this.showBubble(randomFrom(["好开心!", "再来一次!", "嘿嘿，被抓住啦~"]));
    },

    feed(): void {
      if (this.sleeping) {
        this.wakeUp(true);
        return;
      }
      const now = Date.now();
      recentFeeds = recentFeeds.filter((t) => now - t < FEED_BURST_WINDOW_MS);
      recentFeeds.push(now);
      if (recentFeeds.length >= FEED_BURST_LIMIT) {
        this.showTempAnimation("pet", 1200);
        this.showBubble(FEED_TOO_MUCH_PHRASE);
        return;
      }
      this.showTempAnimation("eat", 3000);
      this.showBubble(randomFrom(FEED_PHRASES));
    },

    play(): void {
      if (this.sleeping) this.wakeUp(true);
      this.showTempAnimation("play", 3000);
      this.showBubble(randomFrom(PLAY_PHRASES));
    },

    /** 菜单"说话"：接一句闲聊 */
    talk(): void {
      if (this.sleeping) {
        this.wakeUp(true);
        return;
      }
      this.showTempAnimation("pet", 1200);
      this.showBubble(randomFrom([...TALK_PHRASES, ...PROACTIVE_PHRASES]), 4000);
    },

    /** 睡觉：持续到点自然醒，期间可被点击叫醒 */
    sleep(): void {
      if (this.sleeping) return;
      this.sleeping = true;
      this.tempAnimation = null;
      if (sleepTimer !== null) clearTimeout(sleepTimer);
      this.showBubble(randomFrom(SLEEP_START_PHRASES), 4000);
      sleepTimer = window.setTimeout(() => {
        sleepTimer = null;
        this.sleeping = false;
        this.showTempAnimation("happy", 1500);
        this.showBubble(randomFrom(WAKE_UP_PHRASES));
      }, SLEEP_MAX_MS);
    },

    /** 被用户提前叫醒时带点起床气 */
    wakeUp(disturbed: boolean): void {
      if (!this.sleeping) return;
      if (sleepTimer !== null) {
        clearTimeout(sleepTimer);
        sleepTimer = null;
      }
      this.sleeping = false;
      this.showTempAnimation("pet", 1200);
      this.showBubble(disturbed ? randomFrom(WOKEN_UP_PHRASES) : "我醒啦~");
    },

    toggleSleep(): void {
      if (this.sleeping) this.wakeUp(false);
      else this.sleep();
    },

    /** 用户开始拖拽窗口时的一声招呼 */
    dragStart(): void {
      this.showBubble(randomFrom(DRAG_PHRASES), 1500);
    },

    togglePause(): void {
      this.paused = !this.paused;
      this.showBubble(this.paused ? "休息一下~" : "继续营业!");
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
    /**
     * 脱离边缘滑回时播放一次"恢复正向"的旋转：
     * 上缘/上角倒挂转半圈回正，左右缘按歪头幅度转回，下缘和下角只平移不转。
     */
    spinOnce(edge: ScreenEdge | ScreenCorner | null): void {
      if (!edge || edge === "bottom" || edge.startsWith("bottom")) return;
      this.spinEdge = edge;
      this.spinning = true;
      if (spinTimer !== null) clearTimeout(spinTimer);
      spinTimer = window.setTimeout(() => {
        this.spinning = false;
        this.spinEdge = null;
        spinTimer = null;
      }, 650);
    },

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

        // 角落判定：横向、纵向各取离得最近的一条边，都足够近则视为卡在角落
        const cornerTol = CORNER_SNAP_TOLERANCE * monitor.scaleFactor;
        const horiz: "left" | "right" | null =
          gaps.left <= cornerTol && gaps.left <= gaps.right ? "left"
          : gaps.right <= cornerTol ? "right"
          : null;
        const vert: "top" | "bottom" | null =
          gaps.top <= cornerTol && gaps.top <= gaps.bottom ? "top"
          : gaps.bottom <= cornerTol ? "bottom"
          : null;
        const corner: ScreenCorner | null =
          horiz && vert ? `${vert}-${horiz}` : null;

        const edgeSnap = gaps[edge] <= EDGE_SNAP_THRESHOLD * monitor.scaleFactor;
        if (!edgeSnap && !corner) {
          // 没有贴到边缘：清除贴边状态，并把窗口收回到可用区域内，
          // 避免宠物被拖成"半截挂在屏幕外"
          if (this.edgeHidden) this.spinOnce(this.corner ?? this.edge);
          this.edge = null;
          this.corner = null;
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
        const hiddenYTop = Math.round(size.height * (1 - EDGE_TOP_VISIBLE_RATIO));
        const targets: Record<ScreenEdge, { x: number; y: number }> = {
          left: { x: left - hiddenX, y: pos.y },
          right: { x: right - size.width + hiddenX, y: pos.y },
          top: { x: pos.x, y: top - hiddenYTop },
          bottom: { x: pos.x, y: bottom - size.height + hiddenY },
        };

        let target = targets[edge];
        if (corner) {
          // 角落吸附：横向、纵向两个方向的偏移叠加
          target = {
            x: corner.endsWith("left") ? targets.left.x : targets.right.x,
            y: corner.startsWith("top") ? targets.top.y : targets.bottom.y,
          };
        }

        this.edge = edge;
        this.corner = corner;
        this.edgeHidden = true;
        await this.slideTo(target);
      } catch (err) {
        console.warn("贴边隐藏失败:", err);
      }
    },

    /** 点击贴在边缘/角落的宠物：完整滑回屏幕内 */
    async revealFromEdge(): Promise<void> {
      if (!this.edge || this.sliding) return;
      const win = getCurrentWindow();
      const edge = this.edge;
      const corner = this.corner;
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

        let target = targets[edge];
        if (corner) {
          // 角落滑回：沿对角线同时收回两个方向
          target = {
            x: corner.endsWith("left")
              ? work.position.x
              : work.position.x + work.size.width - size.width,
            y: corner.startsWith("top")
              ? work.position.y
              : work.position.y + work.size.height - size.height,
          };
        }

        this.edge = null;
        this.corner = null;
        this.edgeHidden = false;
        this.spinOnce(corner ?? edge);
        await this.slideTo(target);
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
        case "talk":
          this.talk();
          break;
        case "sleep":
          this.toggleSleep();
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

    /** 把当前配置推送给设置窗口 */
    async emitSettingsSync(): Promise<void> {
      await emit("settings://sync", JSON.parse(JSON.stringify(this.settings)));
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

      this.startIdleRotation();
      this.startProactive();
      this.startHealthTick();
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

    async saveSettings(): Promise<void> {
      if (!db) return;
      await db.set(SETTINGS_KEY, JSON.parse(JSON.stringify(this.settings)));
      await db.save();
    },

    async saveAll(): Promise<void> {
      await this.saveSettings();
    },

    /** 注销事件监听与定时器（组件卸载时调用） */
    dispose(): void {
      for (const fn of unlistenFns) fn();
      unlistenFns = [];
      for (const timer of [
        bubbleTimer,
        animTimer,
        sleepTimer,
        posSaveTimer,
        dragEndTimer,
        idleTimer,
        proactiveTimer,
        healthTimer,
        spinTimer,
      ]) {
        if (timer !== null) clearTimeout(timer);
      }
      if (healthTimer !== null) clearInterval(healthTimer);
      bubbleTimer = null;
      animTimer = null;
      sleepTimer = null;
      posSaveTimer = null;
      dragEndTimer = null;
      idleTimer = null;
      proactiveTimer = null;
      healthTimer = null;
      spinTimer = null;
    },
  },
});
