/**
 * 贴边/角落吸附的纯几何计算。
 *
 * 坐标系：全部使用物理像素（Tauri outerPosition / outerSize / workArea 原样传入），
 * 本模块不感知 DPI，方便用 Vitest 直接断言。
 *
 * ── 露出量与画面内容的换算（和 pet.css 的 peek-* 数值互相引用，改动请同步）──
 * 窗口内宠物画面：.pet 占窗口 65.6%（= 视觉 82% ÷ WINDOW_PAD 1.25，见 pet.css 顶部），
 * 居中放置，四周透明衬底 (1-0.656)/2 ≈ 17.2%。viewBox 高 200。
 *   可见线所在的内容纵坐标 ≈ (visibleRatio - 0.172) × 200 / 0.656
 * 例：下缘 visibleRatio=0.30 → 内容 y≈39（只露眼睛一带）；角落 0.58 → y≈124（露出大半）。
 * 探头姿态（peek-*）的 translateY 是 svg 自身百分比，叠加在可见线之上。
 */

import type { ScreenCorner, ScreenEdge } from "@/types";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** 屏幕可用区矩形 */
export interface Rect {
  position: Point;
  size: Size;
}

/** 四条边各自保留可见的窗口比例（0~1） */
export interface EdgeRatios {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** 角落吸附时横竖两轴统一使用的比例 */
  corner: number;
}

/** 窗口四条边到可用区边界的距离（可为负，表示已超出） */
export type EdgeGaps = Record<ScreenEdge, number>;

export function computeGaps(pos: Point, size: Size, work: Rect): EdgeGaps {
  const left = work.position.x;
  const top = work.position.y;
  const right = left + work.size.width;
  const bottom = top + work.size.height;
  return {
    left: pos.x - left,
    right: right - (pos.x + size.width),
    top: pos.y - top,
    bottom: bottom - (pos.y + size.height),
  };
}

/** 取距离最近的一条边 */
export function nearestEdge(gaps: EdgeGaps): ScreenEdge {
  return (Object.keys(gaps) as ScreenEdge[]).reduce((a, b) =>
    gaps[b] < gaps[a] ? b : a,
  );
}

/**
 * 角落判定：横向、纵向各取离得最近的一条边，两者都落在容差内才算卡在角落。
 * 返回 null 表示只靠近一条边（或都没靠近）。
 */
export function detectCorner(gaps: EdgeGaps, tolerance: number): ScreenCorner | null {
  const horiz: "left" | "right" | null =
    gaps.left <= tolerance && gaps.left <= gaps.right
      ? "left"
      : gaps.right <= tolerance
        ? "right"
        : null;
  const vert: "top" | "bottom" | null =
    gaps.top <= tolerance && gaps.top <= gaps.bottom
      ? "top"
      : gaps.bottom <= tolerance
        ? "bottom"
        : null;
  return horiz && vert ? `${vert}-${horiz}` : null;
}

/** 该边是否达到吸附阈值（edge 为横向/纵向中更接近的一条） */
export function shouldSnap(gaps: EdgeGaps, edge: ScreenEdge, threshold: number): boolean {
  return gaps[edge] <= threshold;
}

/**
 * 吸附目标：把窗口推到屏幕外，使可见区留下 ratios 规定的比例。
 * 角落时横、竖两轴的偏移叠加。
 */
export function snapTarget(args: {
  pos: Point;
  size: Size;
  work: Rect;
  edge: ScreenEdge;
  corner: ScreenCorner | null;
  ratios: EdgeRatios;
}): Point {
  const { pos, size, work, edge, corner, ratios } = args;
  const left = work.position.x;
  const top = work.position.y;
  const right = left + work.size.width;
  const bottom = top + work.size.height;

  const hiddenX = (side: "left" | "right") =>
    Math.round(size.width * (1 - (corner ? ratios.corner : ratios[side])));
  const hiddenY = (side: "top" | "bottom") =>
    Math.round(size.height * (1 - (corner ? ratios.corner : ratios[side])));

  const xOf = (side: "left" | "right"): number =>
    side === "left" ? left - hiddenX("left") : right - size.width + hiddenX("right");
  const yOf = (side: "top" | "bottom"): number =>
    side === "top" ? top - hiddenY("top") : bottom - size.height + hiddenY("bottom");

  if (corner) {
    return {
      x: xOf(corner.endsWith("left") ? "left" : "right"),
      y: yOf(corner.startsWith("top") ? "top" : "bottom"),
    };
  }
  switch (edge) {
    case "left":
      return { x: xOf("left"), y: pos.y };
    case "right":
      return { x: xOf("right"), y: pos.y };
    case "top":
      return { x: pos.x, y: yOf("top") };
    case "bottom":
      return { x: pos.x, y: yOf("bottom") };
  }
}

/** 从边缘滑回的目标：贴到可用区边界、完整可见 */
export function revealTarget(pos: Point, size: Size, work: Rect, corner: ScreenCorner | null, edge: ScreenEdge): Point {
  const left = work.position.x;
  const top = work.position.y;
  const rightX = left + work.size.width - size.width;
  const bottomY = top + work.size.height - size.height;
  if (corner) {
    return {
      x: corner.endsWith("left") ? left : rightX,
      y: corner.startsWith("top") ? top : bottomY,
    };
  }
  switch (edge) {
    case "left":
      return { x: left, y: pos.y };
    case "right":
      return { x: rightX, y: pos.y };
    case "top":
      return { x: pos.x, y: top };
    case "bottom":
      return { x: pos.x, y: bottomY };
  }
}

/** 未贴边时的兜底：把窗口收回可用区内，避免半截挂在屏幕外 */
export function clampIntoWork(pos: Point, size: Size, work: Rect): Point {
  const left = work.position.x;
  const top = work.position.y;
  return {
    x: Math.min(Math.max(pos.x, left), left + work.size.width - size.width),
    y: Math.min(Math.max(pos.y, top), top + work.size.height - size.height),
  };
}

/**
 * 多显示器：按窗口中心点选择所在显示器。
 * currentMonitor() 在跨屏拖拽的松手瞬间可能仍返回旧屏，
 * 用中心点命中测试更稳；完全落在屏外（如被任务栏挤掉）时回退 fallback。
 */
export function pickMonitor<T extends Rect>(
  monitors: T[],
  windowPos: Point,
  windowSize: Size,
  fallback: T | null,
): T | null {
  const cx = windowPos.x + windowSize.width / 2;
  const cy = windowPos.y + windowSize.height / 2;
  const hit = monitors.find(
    (m) =>
      cx >= m.position.x &&
      cx < m.position.x + m.size.width &&
      cy >= m.position.y &&
      cy < m.position.y + m.size.height,
  );
  return hit ?? fallback;
}
