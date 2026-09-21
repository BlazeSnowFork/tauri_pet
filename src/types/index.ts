/** 可选的宠物形象 */
export type PetSkin = "bear-full" | "bear" | "cat";

/** 闲置时的小动作变体 */
export type IdleVariant =
  | "bob"
  | "stretch"
  | "look"
  | "hop"
  | "shake"
  | "lean"
  | "sway"
  | "spin"
  | "dance"
  | "nod"
  | "squirm"
  | "wave"
  | "pat"
  | "kick"
  | "wiggle";

/** 闲置动作模式：fixed 固定轻微起伏，random 随机轮换各种小动作 */
export type IdleMode = "fixed" | "random";

/** 用户可配置的设置项 */
export interface PetSettings {
  /** 宠物形象 */
  petSkin: PetSkin;
  /** 闲置动作模式 */
  idleMode: IdleMode;
  /** 宠物可见尺寸（逻辑像素；透明窗口实际大小 = 该值 × WINDOW_PAD） */
  petSize: number;
  /** 是否始终置顶 */
  alwaysOnTop: boolean;
  /** 是否开机自启 */
  autostart: boolean;
  /** 动画速度倍率（0.5 - 2） */
  animationSpeed: number;
  /** 宠物是否会主动搭话、求互动 */
  proactiveEnabled: boolean;
  /** 是否整点报时 */
  timeReportEnabled: boolean;
  /** 是否按连续用机时长提醒休息 */
  breakReminderEnabled: boolean;
  /** 连续使用电脑多少分钟后提醒休息 */
  breakAfterMin: number;
  /** 性能模式：关闭绒毛滤镜等重效果、停用四肢微动画，降低常驻功耗 */
  performanceMode: boolean;
}

/** 宠物动画状态（idle 为基础态，其余为互动触发的临时动作） */
export type PetAnimation = "idle" | "happy" | "sleep" | "eat" | "play" | "pet";

/** 右键菜单动作 */
export type MenuAction =
  | "feed"
  | "play"
  | "talk"
  | "sleep"
  | "settings"
  | "hide"
  | "quit";

/** 菜单项定义 */
export interface MenuItemDef {
  key: MenuAction;
  label: string;
  danger?: boolean;
}

/** 持久化的窗口坐标（物理像素） */
export interface WindowPosition {
  x: number;
  y: number;
}

/** 屏幕边缘方向：宠物贴边隐藏时记录贴在哪一边 */
export type ScreenEdge = "left" | "right" | "top" | "bottom";

/** 屏幕四角：宠物同时贴近两条边时记录的角落方向 */
export type ScreenCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";
