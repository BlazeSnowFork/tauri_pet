/** 宠物三项数值状态，取值范围均为 0-100 */
export interface PetStats {
  /** 饱食度 */
  hunger: number;
  /** 心情 */
  mood: number;
  /** 精力 */
  energy: number;
}

/** 用户可配置的设置项 */
export interface PetSettings {
  /** 宠物窗口边长（逻辑像素） */
  petSize: number;
  /** 是否始终置顶 */
  alwaysOnTop: boolean;
  /** 是否开机自启 */
  autostart: boolean;
  /** 动画速度倍率（0.5 - 2） */
  animationSpeed: number;
  /** 状态衰减速度倍率（0.5 - 3） */
  decaySpeed: number;
  /** 是否开启定时提醒 */
  reminderEnabled: boolean;
  /** 定时提醒间隔（分钟） */
  reminderIntervalMin: number;
}

/** 宠物动画状态 */
export type PetAnimation =
  | "idle"
  | "happy"
  | "hungry"
  | "tired"
  | "sleep"
  | "eat"
  | "play"
  | "pet";

/** 右键菜单动作 */
export type MenuAction = "feed" | "play" | "sleep" | "settings" | "hide" | "quit";

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

/** 宠物主窗口 → 设置窗口的配置与数值同步载荷 */
export interface SettingsSyncPayload {
  settings: PetSettings;
  stats: PetStats;
}

/** 屏幕边缘方向：宠物贴边隐藏时记录贴在哪一边 */
export type ScreenEdge = "left" | "right" | "top" | "bottom";
