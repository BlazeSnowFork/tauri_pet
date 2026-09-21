/**
 * 动作道具系统的声明层：定义"哪个动作带哪些道具"，纯数据 + 纯函数，
 * 渲染层（Pet.vue）只按 activeProps() 的结果挂对应的 SVG 组。
 *
 * 遮挡约定（见 Pet.vue 的毛绒小熊 svg）：
 * - prop-back  图层：躯干之后渲染（如呼啦圈的后半弧，被肚子挡住）；
 * - prop-front 图层：面部之后渲染（球、圈前半弧、音符等浮在前面的道具）；
 * - 手持道具（球拍）直接放进对应的手臂组里，继承手臂的旋转。
 *
 * 循环类道具（闲置动作/临时动作期间持续播放）由 CSS animation 驱动，
 * 周期与所属动作的 idle-* 关键帧一致，切换瞬间同时起跑即自然同步。
 */

import type { IdleVariant, PetAnimation } from "@/types";

/** 全部道具种类 */
export type PropKind =
  | "hoop" // 呼啦圈（spin）
  | "rope" // 跳绳（hop）
  | "ball" // 足球（kick）
  | "notes" // 音符（dance）
  | "lightPool" // 迪斯科光圈（dance）
  | "stretchLines" // 舒展波浪线（stretch）
  | "sparkles" // 拍拍小星星（pat）
  | "swingArcs" // 摆动弧线（wiggle）
  | "drops" // 水珠（shake）
  | "question" // 问号（look）
  | "jar" // 蜂蜜罐（eat）
  | "racket" // 球拍（play）
  | "shuttle" // 羽毛球（play）
  | "butterfly"; // 蝴蝶（随机小剧本）

/** 闲置变体 → 附加道具 */
export const IDLE_PROPS: Partial<Record<IdleVariant, PropKind[]>> = {
  spin: ["hoop"],
  hop: ["rope"],
  kick: ["ball"],
  dance: ["notes", "lightPool"],
  stretch: ["stretchLines"],
  pat: ["sparkles"],
  wiggle: ["swingArcs"],
  shake: ["drops"],
  look: ["question"],
};

/** 闲置变体的中文名（菜单"动作演示"页与气泡文案用） */
export const IDLE_VARIANT_LABELS: Record<IdleVariant, string> = {
  bob: "轻轻起伏",
  stretch: "伸懒腰",
  look: "四处张望",
  hop: "跳绳",
  shake: "抖擞甩水",
  lean: "歪倚摇摆",
  sway: "左右晃悠",
  spin: "转呼啦圈",
  dance: "开心跳舞",
  nod: "点头",
  squirm: "蠕蠕扭",
  wave: "挥挥手",
  pat: "拍拍肚皮",
  kick: "踢足球",
  wiggle: "扭扭腰",
};

/** 临时动作 → 附加道具（睡觉的 Zzz 已有专组，不在这里） */
export const ANIMATION_PROPS: Partial<Record<PetAnimation, PropKind[]>> = {
  eat: ["jar"],
  play: ["racket", "shuttle"],
};

/**
 * 闲置变体的简易图标（菜单"动作演示"列表用）。
 * 只选 Windows 自带 emoji 的老成员（≤Emoji 12），避免字体缺字出方框；
 * 优先挑与动作道具/形态呼应的图形。
 */
export const IDLE_VARIANT_ICONS: Record<IdleVariant, string> = {
  bob: "🌊", // 起伏如波浪
  stretch: "🙆", // 双臂上举伸懒腰
  look: "👀", // 四处张望
  hop: "🦘", // 弹跳
  shake: "💦", // 甩水珠
  lean: "📐", // 歪斜的角度
  sway: "🎐", // 像风铃般轻晃
  spin: "🌀", // 旋转
  dance: "💃", // 跳舞
  nod: "🙇", // 低头点头
  squirm: "🐛", // 蠕虫扭动
  wave: "👋", // 挥手
  pat: "🥁", // 拍击如鼓
  kick: "⚽", // 足球
  wiggle: "〰️", // 波浪摆动
};

/** 渲染层判定道具可见性所需的动作状态快照 */
export interface PropsState {
  displayAnimation: PetAnimation;
  /** 是否处于纯闲置（只有闲置才套用 idleVariant 的道具） */
  isIdle: boolean;
  idleVariant: IdleVariant;
  /** 贴边隐藏时只用低幅度动作池，但也允许该池道具（bob 除外都无道具） */
  butterfly: boolean;
}

/** 当前应渲染的道具集合（声明表查表 + 小剧本事件合并去重） */
export function activeProps(s: PropsState): PropKind[] {
  const kinds = new Set<PropKind>();
  if (s.isIdle) {
    for (const k of IDLE_PROPS[s.idleVariant] ?? []) kinds.add(k);
  } else {
    for (const k of ANIMATION_PROPS[s.displayAnimation] ?? []) kinds.add(k);
  }
  if (s.butterfly) kinds.add("butterfly");
  return [...kinds];
}
