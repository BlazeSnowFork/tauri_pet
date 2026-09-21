import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  availableMonitors,
  cursorPosition,
  currentMonitor,
  getCurrentWindow,
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

import {
  clampIntoWork,
  computeGaps,
  detectCorner,
  nearestEdge,
  pickMonitor,
  revealTarget,
  shouldSnap,
  snapTarget,
  standOnGround,
  type EdgeRatios,
  type Point,
  type Size,
} from "@/logic/edge";
import { mergeSettings } from "@/logic/settings";
import { IDLE_VARIANT_LABELS } from "@/logic/props";

import type {
  IdleVariant,
  MenuAction,
  MenuDemo,
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
/** 角落吸附时保留可见的窗口比例：45° 斜靠需要比单边更大的露出面积 */
const CORNER_VISIBLE_RATIO = 0.58;
/** 窗口停止移动多久后判定拖拽结束（毫秒） */
const DRAG_END_DEBOUNCE_MS = 400;
/** 吸附隐藏后仍保留可见的窗口比例 */
const EDGE_VISIBLE_RATIO = 0.42;
/** 上缘单独的比例：倒挂探头时吸附深度更浅，露出更多 */
const EDGE_TOP_VISIBLE_RATIO = 0.5;
/** 下缘单独的比例：底部探头露出多一些，避免静坐/小动作被裁掉 */
const EDGE_BOTTOM_VISIBLE_RATIO = 0.3;
/**
 * 底部落地时窗口允许探出工作区下缘的比例：等于画面下方的透明衬底份额
 * （.pet 占窗口 65.6%、居中，衬底 (1-0.656)/2 ≈ 0.172，见 edge.ts 头注释），
 * 让脚底"踩"在平面线上而不是悬空。
 */
const GROUND_SINK_RATIO = 0.172;
/** 滑出 / 滑入动画时长（毫秒） */
const EDGE_ANIM_MS = 200;
/** 透明窗口相对宠物可见尺寸的放大系数：给影子、挥手、气泡等留出画外余量 */
const WINDOW_PAD = 1.25;
/** 随机模式下两种闲置动作之间的最小 / 最大间隔（毫秒） */
const IDLE_SWITCH_MIN_MS = 12_000;
const IDLE_SWITCH_MAX_MS = 24_000;
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
  "wave",
  "pat",
  "kick",
  "wiggle",
];
/** 贴边时只轮换"专注式"小动作：幅度小、不打扰使用者，且不含旋转 */
const QUIET_IDLE_VARIANTS: IdleVariant[] = [
  "bob",
  "lean",
  "sway",
  "nod",
  "look",
];
/** 动作演示页选中的闲置动作被"钉住"的最长时长（毫秒），到期后恢复随机轮换 */
const DEMO_PIN_MS = 60_000;
/** 演示"吃蜂蜜"的动画时长（毫秒），与 feed() 保持一致 */
const DEMO_EAT_MS = 3000;
/** 演示循环重播时，两轮临时动画之间的间隔（毫秒） */
const DEMO_LOOP_GAP_MS = 700;
/** 地面漫步：调度窗口间隔（毫秒）与每次机会的放行概率 */
const WALK_MIN_MS = 90_000;
const WALK_MAX_MS = 200_000;
const WALK_CHANCE = 0.55;
/** 漫步速度（逻辑像素/秒）与单次距离范围（逻辑像素） */
const WALK_SPEED_PX_S = 55;
const WALK_DIST_MIN = 90;
const WALK_DIST_MAX = 240;
/** 窗口底缘距工作区底部不超过该值（逻辑像素）视为"站在地面"，才允许漫步 */
const WALK_GROUND_SLACK = 40;
/** 连续快速点击达到该次数时触发"被戳晕"彩蛋反应 */
const COMBO_CLICKS = 3;
/** 判定连点的相邻点击间隔（毫秒） */
const COMBO_WINDOW_MS = 800;
/** 视线跟随：轮询全局鼠标位置的周期（毫秒）与响应半径（逻辑像素） */
const LOOK_TICK_MS = 220;
const LOOK_RADIUS_PX = 260;
/** 甩动判定：取样窗口（毫秒）与视为"甩"的水平速度阈值（物理像素/毫秒） */
const FLING_SAMPLE_WINDOW_MS = 250;
const FLING_SPEED_PX_MS = 1.0;
/** 甩动回弹动画的持续时长（毫秒），与 pet.css 的 fling-squash 时长一致 */
const FLING_ANIM_MS = 620;
/** 30 秒内投喂达到次数上限会触发"吃撑了"反应 */
const FEED_BURST_WINDOW_MS = 30_000;
const FEED_BURST_LIMIT = 4;
/** 蝴蝶小剧本：触发窗口 6~14 分钟、每次 50% 概率，飞过全程时长 */
const BUTTERFLY_MIN_MS = 6 * 60_000;
const BUTTERFLY_MAX_MS = 14 * 60_000;
const BUTTERFLY_CHANCE = 0.5;
const BUTTERFLY_SHOW_MS = 6800;
/** 玩耍（羽毛球）动作时长：约两个来回 */
const PLAY_ANIM_MS = 4600;

export const DEFAULT_SETTINGS: PetSettings = {
  petSkin: "bear-full",
  idleMode: "random",
  petSize: 300,
  alwaysOnTop: true,
  autostart: false,
  animationSpeed: 1,
  proactiveEnabled: true,
  timeReportEnabled: true,
  breakReminderEnabled: true,
  breakAfterMin: 45,
  performanceMode: false,
};

/** 传给 logic/edge.ts 的各边露出比例（像素换算见 edge.ts 顶部注释） */
const EDGE_RATIOS: EdgeRatios = {
  left: EDGE_VISIBLE_RATIO,
  right: EDGE_VISIBLE_RATIO,
  top: EDGE_TOP_VISIBLE_RATIO,
  bottom: EDGE_BOTTOM_VISIBLE_RATIO,
  corner: CORNER_VISIBLE_RATIO,
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

const WALK_PHRASES = [
  "出去走走~",
  "散个步消消食~",
  "（迈着小短腿溜达中）",
  "走两步，就两步~",
];

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
let lookTimer: number | null = null;
let flingTimer: number | null = null;
let butterflyTimer: number | null = null;
let butterflyEndTimer: number | null = null;
/** 动作演示：钉住的闲置动作与到期解除定时器（钉住期间随机轮换让位） */
let demoPinned = false;
let demoPinTimer: number | null = null;
/** 演示循环重播：正在循环的临时动作与下一轮定时器（null 表示未在循环） */
let demoLoopAnim: "eat" | "play" | null = null;
let demoLoopTimer: number | null = null;
/** 地面漫步调度定时器 */
let walkTimer: number | null = null;
/** 漫步世代号：新趟次开始（含演示重触发）会让上一趟的逐帧循环自然退场 */
let walkSeq = 0;
/** 拖拽期间最近的若干窗口位置采样（物理像素），用于甩动速度判定 */
let dragSamples: { x: number; y: number; t: number }[] = [];
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
    /** 当前闲置动作变体（随机模式下定时轮换） */
    idleVariant: "bob" as IdleVariant,
    /** 视线跟随：归一化到 -1..1 的注视偏移，驱动 .eyes 的 --look-x/--look-y */
    look: { x: 0, y: 0 },
    /** 甩动回弹方向（一次性动画，播完自动清空） */
    flingDir: null as "left" | "right" | null,
    /** 玩耍时羽毛球飞向的方向（触发瞬间按视线方向定） */
    playDir: "right" as "left" | "right",
    /** 蝴蝶小剧本：正在飞 + 从哪侧入场 */
    butterflySide: null as "left" | "right" | null,
    /** 地面漫步进行中（displayAnimation 会切到 walk） */
    walking: false,
    /** 漫步朝向（左/右），驱动身体倾斜方向 */
    walkDir: "right" as "left" | "right",
    ready: false,
  }),

  getters: {
    /** 当前应展示的动画：临时动作 > 睡觉 > 漫步 > 闲置基础态 */
    displayAnimation(state): PetAnimation {
      if (state.tempAnimation) return state.tempAnimation;
      if (state.sleeping) return "sleep";
      if (state.walking) return "walk";
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
      this.settings = mergeSettings(DEFAULT_SETTINGS, savedSettings);
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
        await listen<MenuDemo>("menu://demo", (event) => {
          this.playDemo(event.payload);
        }),
        await listen("settings://request", () => {
          void this.emitSettingsSync();
        }),
        await listen<PetSettings>("settings://changed", (event) => {
          void this.applySettings(event.payload);
        }),
        await win.onMoved(({ payload }) => {
          this.sampleDrag({ x: payload.x, y: payload.y });
          this.scheduleSaveWindowPos({ x: payload.x, y: payload.y });
          this.noteWindowMoved();
        }),
        await win.onFocusChanged(({ payload: focused }) => {
          // 托盘"显示宠物"不会通知前端 JS；窗口重新获得焦点时把定时器拉起来
          // （start* 系列都是幂等的：先清旧定时器再排新的）
          if (focused) {
            this.startIdleRotation();
            this.startProactive();
            this.startLook();
            this.startButterfly();
            this.startWalkScheduler();
          }
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
      this.startLook();
      this.startButterfly();
      this.startWalkScheduler();
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
          IDLE_SWITCH_MIN_MS +
          Math.random() * (IDLE_SWITCH_MAX_MS - IDLE_SWITCH_MIN_MS);
        idleTimer = window.setTimeout(() => {
          idleTimer = null;
          if (
            this.settings.idleMode === "random" &&
            !this.paused &&
            !demoPinned &&
            this.displayAnimation === "idle"
          ) {
            const base = this.edgeHidden ? QUIET_IDLE_VARIANTS : IDLE_VARIANTS;
            const pool = base.filter((v) => v !== this.idleVariant);
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
        const wait =
          PROACTIVE_MIN_MS +
          Math.random() * (PROACTIVE_MAX_MS - PROACTIVE_MIN_MS);
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

    /**
     * 蝴蝶小剧本调度：每 6~14 分钟一次机会、50% 概率放行。
     * 触发时蝴蝶从一侧飞过，宠物切到"张望"并哼一声，全程约 7 秒。
     */
    startButterfly(): void {
      if (butterflyTimer !== null) clearTimeout(butterflyTimer);
      butterflyTimer = null;
      const schedule = (): void => {
        const wait =
          BUTTERFLY_MIN_MS +
          Math.random() * (BUTTERFLY_MAX_MS - BUTTERFLY_MIN_MS);
        butterflyTimer = window.setTimeout(() => {
          butterflyTimer = null;
          if (
            this.ready &&
            !this.paused &&
            !this.sleeping &&
            !this.tempAnimation &&
            !this.bubble.visible &&
            !this.edgeHidden &&
            this.displayAnimation === "idle" &&
            Math.random() < BUTTERFLY_CHANCE
          ) {
            this.spawnButterfly();
          }
          schedule();
        }, wait);
      };
      schedule();
    },

    spawnButterfly(): void {
      this.butterflySide = Math.random() < 0.5 ? "left" : "right";
      if (this.settings.idleMode === "random") this.idleVariant = "look";
      this.showBubble(
        randomFrom([
          "哇，是蝴蝶！🦋",
          "蝴蝶蝴蝶，别飞走呀~",
          "（盯着蝴蝶看入了迷）",
        ]),
        4000,
      );
      if (butterflyEndTimer !== null) clearTimeout(butterflyEndTimer);
      butterflyEndTimer = window.setTimeout(() => {
        butterflyEndTimer = null;
        this.butterflySide = null;
      }, BUTTERFLY_SHOW_MS);
    },

    // ------------------------------------------------------------------
    // 地面随机漫步：贴着屏幕底部时，偶尔小范围溜达一段
    // ------------------------------------------------------------------
    /** 漫步调度（幂等）：每 90~200 秒一次机会，条件齐全且掷骰通过才出门 */
    startWalkScheduler(): void {
      if (walkTimer !== null) clearTimeout(walkTimer);
      walkTimer = null;
      const schedule = (): void => {
        const wait = WALK_MIN_MS + Math.random() * (WALK_MAX_MS - WALK_MIN_MS);
        walkTimer = window.setTimeout(() => {
          walkTimer = null;
          if (
            this.ready &&
            !this.paused &&
            !this.sleeping &&
            !this.tempAnimation &&
            !this.dragActive &&
            !this.sliding &&
            !this.edgeHidden &&
            this.displayAnimation === "idle" &&
            !demoPinned &&
            demoLoopAnim === null &&
            Math.random() < WALK_CHANCE
          ) {
            void this.walkTrip();
          }
          schedule();
        }, wait);
      };
      schedule();
    },

    /** 停掉漫步（互动/拖拽/睡觉/隐藏窗口时调用，逐帧循环会感知并收尾） */
    stopWalking(): void {
      this.walking = false;
    },

    /**
     * 走一趟：仅当窗口底缘贴近工作区底部（"站在地上"）才成行。
     * 随机挑方向和距离，逐帧平移窗口；任何中断直接停在当前位置。
     * forDemo=true 时豁免地面判定——不在地上就先滑落到"地面线"再出发。
     */
    async walkTrip(forDemo = false): Promise<void> {
      const seq = ++walkSeq;
      const win = getCurrentWindow();
      try {
        const [initial, size] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
        ]);
        const monitor = await this.resolveMonitor(initial, size);
        if (!monitor) return;
        const scale = monitor.scaleFactor;
        const work = monitor.workArea;
        const groundLine = work.position.y + work.size.height;
        let pos = initial;
        if (pos.y + size.height < groundLine - WALK_GROUND_SLACK * scale) {
          if (!forDemo) return;
          const sinkY =
            groundLine - Math.round(size.height * (1 - GROUND_SINK_RATIO));
          await this.slideTo({ x: pos.x, y: sinkY }, 260);
          if (seq !== walkSeq) return;
          pos = await win.outerPosition();
        }

        const minX = work.position.x;
        const maxX = work.position.x + work.size.width - size.width;
        const dist =
          (WALK_DIST_MIN + Math.random() * (WALK_DIST_MAX - WALK_DIST_MIN)) *
          scale;
        let target = pos.x + (Math.random() < 0.5 ? dist : -dist);
        target = Math.round(Math.min(maxX, Math.max(minX, target)));
        // 两侧空间都太窄就放弃这次机会
        if (Math.abs(target - pos.x) < 40 * scale) return;

        this.walking = true;
        this.walkDir = target >= pos.x ? "right" : "left";
        if (Math.random() < 0.35)
          this.showBubble(randomFrom(WALK_PHRASES), 3000);

        const pxPerFrame = (WALK_SPEED_PX_S * scale) / (1000 / 16);
        const frames = Math.max(
          1,
          Math.round(Math.abs(target - pos.x) / pxPerFrame),
        );
        for (let i = 1; i <= frames; i += 1) {
          if (
            seq !== walkSeq ||
            !this.walking ||
            this.tempAnimation ||
            this.sleeping ||
            this.dragActive
          ) {
            break;
          }
          const x = Math.round(pos.x + (target - pos.x) * (i / frames));
          await win.setPosition(new PhysicalPosition(x, pos.y));
          if (i < frames) {
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        }
      } catch (err) {
        console.warn("漫步失败:", err);
      } finally {
        if (seq === walkSeq) this.walking = false;
      }
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

    // ------------------------------------------------------------------
    // 视线跟随 / 甩动回弹
    // ------------------------------------------------------------------
    /** 启动视线跟随轮询（幂等） */
    startLook(): void {
      if (lookTimer !== null) clearInterval(lookTimer);
      lookTimer = window.setInterval(() => {
        void this.updateLook();
      }, LOOK_TICK_MS);
    },

    /** 轮询全局鼠标位置，换算成 -1..1 的注视偏移驱动 .eyes（睡熟/暂停时保持原位） */
    async updateLook(): Promise<void> {
      if (document.hidden || this.sleeping || this.paused) return;
      try {
        const win = getCurrentWindow();
        const [cursor, pos, size, scale] = await Promise.all([
          cursorPosition(),
          win.outerPosition(),
          win.outerSize(),
          win.scaleFactor(),
        ]);
        const rx = LOOK_RADIUS_PX * scale;
        const ry = LOOK_RADIUS_PX * scale * 0.8;
        const dx = cursor.x - (pos.x + size.width / 2);
        const dy = cursor.y - (pos.y + size.height / 2);
        this.look = {
          x: Math.max(-1, Math.min(1, dx / rx)),
          y: Math.max(-1, Math.min(1, dy / ry)),
        };
      } catch {
        // 取不到鼠标/窗口位置时保持上一个视线方向即可
      }
    },

    /** 记录拖拽过程中的窗口位置采样（物理像素） */
    sampleDrag(pos: Point): void {
      dragSamples.push({ x: pos.x, y: pos.y, t: Date.now() });
      if (dragSamples.length > 8) dragSamples.shift();
    },

    /** 松手瞬间按最近的移动采样判定是否"甩"了出来，是则触发一次回弹动画 */
    flingIfNeeded(): void {
      const now = Date.now();
      const recent = dragSamples.filter(
        (s) => now - s.t <= FLING_SAMPLE_WINDOW_MS,
      );
      dragSamples = [];
      if (recent.length < 2) return;
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dt = Math.max(b.t - a.t, 1);
      const vx = (b.x - a.x) / dt;
      if (Math.abs(vx) < FLING_SPEED_PX_MS) return;
      this.flingDir = vx > 0 ? "right" : "left";
      if (flingTimer !== null) clearTimeout(flingTimer);
      flingTimer = window.setTimeout(() => {
        flingTimer = null;
        this.flingDir = null;
      }, FLING_ANIM_MS);
    },

    // ------------------------------------------------------------------
    // 定时器启停（隐藏时省电）
    // ------------------------------------------------------------------
    stopIdleRotation(): void {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
    },

    stopProactive(): void {
      if (proactiveTimer !== null) clearTimeout(proactiveTimer);
      proactiveTimer = null;
    },

    /**
     * 动作演示页选中单个动作：立刻演示指定的闲置动作、吃蜂蜜/打羽毛球，
     * 或直接触发地面漫步/蝴蝶过境剧本。
     * 闲置动作会被"钉住"（随机轮换让位），临时动作则循环重播，
     * 便于反复观察道具效果；到 DEMO_PIN_MS、贴边、再次互动或隐藏窗口时解除。
     */
    playDemo(demo: MenuDemo): void {
      if (this.sleeping) this.wakeUp(false);
      this.clearDemoPin();
      if (demo.target === "temp") {
        const label = demo.anim === "eat" ? "吃蜂蜜" : "打羽毛球";
        demoLoopAnim = demo.anim;
        this.demoTempTick();
        this.showBubble(`🎭 ${label}（循环演示中）`, 4000);
        return;
      }
      if (
        demo.target === "walk" ||
        demo.target === "butterfly" ||
        demo.target === "idle"
      ) {
        // 清掉进行中的临时动画，让位给要演示的动作
        if (animTimer !== null) {
          clearTimeout(animTimer);
          animTimer = null;
        }
        this.tempAnimation = null;
      }
      if (demo.target === "walk") {
        this.showBubble("🎭 地面漫步");
        void this.walkTrip(true);
        return;
      }
      if (demo.target === "butterfly") {
        this.spawnButterfly();
        return;
      }
      this.idleVariant = demo.variant;
      demoPinned = true;
      demoPinTimer = window.setTimeout(() => {
        demoPinned = false;
        demoPinTimer = null;
      }, DEMO_PIN_MS);
      this.showBubble(`🎭 ${IDLE_VARIANT_LABELS[demo.variant]}`);
    },

    /**
     * 演示循环的一拍：播一轮指定的临时动作，隔一小段再排下一轮。
     * 被其它互动顶替、睡觉/暂停/贴边时自动退出循环。
     */
    demoTempTick(): void {
      demoLoopTimer = null;
      const anim = demoLoopAnim;
      const overridden =
        this.tempAnimation !== null && this.tempAnimation !== anim;
      if (
        !anim ||
        overridden ||
        this.paused ||
        this.sleeping ||
        this.edgeHidden
      ) {
        this.clearDemoPin();
        return;
      }
      this.showTempAnimation(anim, anim === "eat" ? DEMO_EAT_MS : PLAY_ANIM_MS);
      const roundMs =
        (anim === "eat" ? DEMO_EAT_MS : PLAY_ANIM_MS) + DEMO_LOOP_GAP_MS;
      demoLoopTimer = window.setTimeout(
        () => this.demoTempTick(),
        roundMs / Math.max(this.settings.animationSpeed, 0.1),
      );
    },

    /** 解除"钉住"的演示动作与循环重播，把调度权交还常规逻辑 */
    clearDemoPin(): void {
      if (demoPinTimer !== null) {
        clearTimeout(demoPinTimer);
        demoPinTimer = null;
      }
      demoPinned = false;
      if (demoLoopTimer !== null) {
        clearTimeout(demoLoopTimer);
        demoLoopTimer = null;
      }
      demoLoopAnim = null;
    },

    /** 窗口隐藏时停掉所有可停的循环，显示后由焦点事件/初始化重新拉起 */
    parkTimers(): void {
      this.stopIdleRotation();
      this.stopProactive();
      if (lookTimer !== null) {
        clearInterval(lookTimer);
        lookTimer = null;
      }
      if (flingTimer !== null) {
        clearTimeout(flingTimer);
        flingTimer = null;
        this.flingDir = null;
      }
      if (butterflyTimer !== null) {
        clearTimeout(butterflyTimer);
        butterflyTimer = null;
      }
      if (butterflyEndTimer !== null) {
        clearTimeout(butterflyEndTimer);
        butterflyEndTimer = null;
      }
      this.clearDemoPin();
      if (walkTimer !== null) {
        clearTimeout(walkTimer);
        walkTimer = null;
      }
      this.stopWalking();
      this.butterflySide = null;
      dragSamples = [];
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
      this.showTempAnimation("play", PLAY_ANIM_MS);
      this.showBubble(randomFrom(PLAY_PHRASES));
    },

    /** 菜单"说话"：接一句闲聊 */
    talk(): void {
      if (this.sleeping) {
        this.wakeUp(true);
        return;
      }
      this.showTempAnimation("pet", 1200);
      this.showBubble(
        randomFrom([...TALK_PHRASES, ...PROACTIVE_PHRASES]),
        4000,
      );
    },

    /** 睡觉：持续到点自然醒，期间可被点击叫醒 */
    sleep(): void {
      if (this.sleeping) return;
      this.sleeping = true;
      this.tempAnimation = null;
      // 睡姿不该歪着头：视线归中（updateLook 睡眠期间不再更新）
      this.look = { x: 0, y: 0 };
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
      // 任何临时互动都先打断漫步（walk 自身除外，防御性判断）
      if (anim !== "walk") this.stopWalking();
      if (anim === "play") {
        // 球往哪边打：取当前视线水平方向，让羽毛球朝鼠标那侧飞
        this.playDir = this.look.x < 0 ? "left" : "right";
      }
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
      this.stopWalking();
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

    /** 拖拽结束时调用：靠近屏幕边缘则吸附并部分滑出，否则把宠物拉回屏幕内。
     *  几何计算全部委托给 logic/edge.ts 的纯函数（带单测）。 */
    async handleDragEnd(): Promise<void> {
      if (this.sliding) return;
      const win = getCurrentWindow();
      try {
        this.flingIfNeeded();

        // 先校正窗口尺寸：Windows 的 Aero Snap（拖到边缘松手时系统贴靠/最大化）
        // 会擅自改大窗口，导致按百分比绘制的宠物被放大
        await this.ensurePetSize();

        const [pos, size] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
        ]);
        const monitor = await this.resolveMonitor(pos, size);
        if (!monitor) return;

        const work = monitor.workArea;
        const scale = monitor.scaleFactor;
        const gaps = computeGaps(pos, size, work);
        const edge = nearestEdge(gaps);
        const corner = detectCorner(gaps, CORNER_SNAP_TOLERANCE * scale);
        // 底边单侧不吸附：放在底部就是"站在地面"，保留给地面漫步；
        // 想触发底部探头姿态请拖到左下/右下角（角落吸附仍有效）
        const snapping =
          corner !== null ||
          (edge !== "bottom" &&
            shouldSnap(gaps, edge, EDGE_SNAP_THRESHOLD * scale));

        if (!snapping) {
          // 没有贴到边缘：清除贴边状态，并把窗口收回到可用区域内，
          // 避免宠物被拖成"半截挂在屏幕外"
          this.edge = null;
          this.corner = null;
          this.edgeHidden = false;
          // 底部松手 = 站在地面：窗口下缘探出透明衬底的量，脚踩工作区底线；
          // 其余方向仍整窗收回可用区
          const clamped =
            edge === "bottom" && gaps.bottom < 0
              ? standOnGround(pos, size, work, GROUND_SINK_RATIO)
              : clampIntoWork(pos, size, work);
          if (clamped.x !== pos.x || clamped.y !== pos.y) {
            await this.slideTo(clamped, 120);
          }
          return;
        }

        this.edge = edge;
        this.corner = corner;
        this.edgeHidden = true;
        // 吸附到边缘后立刻切回"专注式"小动作，避免大幅动作（旋转/跳舞等）挂在屏外
        this.clearDemoPin();
        if (!QUIET_IDLE_VARIANTS.includes(this.idleVariant)) {
          this.idleVariant = "bob";
        }
        await this.slideTo(
          snapTarget({ pos, size, work, edge, corner, ratios: EDGE_RATIOS }),
        );
      } catch (err) {
        console.warn("贴边隐藏失败:", err);
      }
    },

    /**
     * 选择窗口当前真正所在的显示器：跨屏拖拽松手瞬间 currentMonitor() 可能
     * 仍指向旧屏，改用"窗口中心点命中测试"，未命中（如整窗在屏外）回退。
     */
    async resolveMonitor(pos: Point, size: Size) {
      try {
        const [monitors, current] = await Promise.all([
          availableMonitors(),
          currentMonitor(),
        ]);
        return pickMonitor(monitors, pos, size, current);
      } catch (err) {
        console.warn("枚举显示器失败，回退 currentMonitor:", err);
        return currentMonitor();
      }
    },

    /** 点击贴在边缘/角落的宠物：完整滑回屏幕内 */
    async revealFromEdge(): Promise<void> {
      if (!this.edge || this.sliding) return;
      const win = getCurrentWindow();
      const edge = this.edge;
      const corner = this.corner;
      try {
        const [pos, size] = await Promise.all([
          win.outerPosition(),
          win.outerSize(),
        ]);
        const monitor = await this.resolveMonitor(pos, size);
        if (!monitor) return;

        const target = revealTarget(pos, size, monitor.workArea, corner, edge);

        this.edge = null;
        this.corner = null;
        this.edgeHidden = false;
        await this.slideTo(target);
        this.showBubble("我出来啦~", 1500);
      } catch (err) {
        console.warn("滑回屏幕失败:", err);
      }
    },

    /** 逐帧移动窗口，模拟滑出/滑入动画 */
    async slideTo(
      target: { x: number; y: number },
      ms = EDGE_ANIM_MS,
    ): Promise<void> {
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
      await invoke("set_pet_size", { size: size * WINDOW_PAD });
    },

    /** 校验窗口尺寸是否仍与设置一致，不一致则改回来 */
    async ensurePetSize(): Promise<void> {
      try {
        const win = getCurrentWindow();
        const scale = await win.scaleFactor();
        const expected = Math.round(this.settings.petSize * WINDOW_PAD * scale);
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
      this.parkTimers();
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
        lookTimer,
        flingTimer,
        butterflyTimer,
        butterflyEndTimer,
        demoPinTimer,
        demoLoopTimer,
        walkTimer,
      ]) {
        if (timer !== null) clearTimeout(timer);
      }
      if (healthTimer !== null) clearInterval(healthTimer);
      if (lookTimer !== null) clearInterval(lookTimer);
      bubbleTimer = null;
      animTimer = null;
      sleepTimer = null;
      posSaveTimer = null;
      dragEndTimer = null;
      idleTimer = null;
      proactiveTimer = null;
      healthTimer = null;
      lookTimer = null;
      flingTimer = null;
      demoPinned = false;
      demoPinTimer = null;
      demoLoopTimer = null;
      demoLoopAnim = null;
      walkTimer = null;
    },
  },
});
