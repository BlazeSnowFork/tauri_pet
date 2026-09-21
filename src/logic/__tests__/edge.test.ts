import { describe, expect, it } from "vitest";

import {
  clampIntoWork,
  computeGaps,
  detectCorner,
  nearestEdge,
  pickMonitor,
  revealTarget,
  shouldSnap,
  snapTarget,
  type EdgeRatios,
  type Rect,
} from "@/logic/edge";

// 统一用 1920×1080 主屏（物理像素、DPI=1 语境下逻辑值同数值）
const WORK: Rect = { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } };
const SIZE = { width: 375, height: 375 };
const RATIOS: EdgeRatios = {
  left: 0.42,
  right: 0.42,
  top: 0.5,
  bottom: 0.3,
  corner: 0.58,
};

describe("computeGaps / nearestEdge", () => {
  it("按窗口四条边到可用区边界的距离取最近边", () => {
    const gaps = computeGaps({ x: 1870, y: 500 }, SIZE, WORK);
    expect(gaps.right).toBeCloseTo(1920 - (1870 + 375), 6);
    expect(nearestEdge(gaps)).toBe("right");
  });

  it("窗口超出可用区时 gap 为负，仍能被选为最近边", () => {
    const gaps = computeGaps({ x: -50, y: 400 }, SIZE, WORK);
    expect(gaps.left).toBe(-50);
    expect(nearestEdge(gaps)).toBe("left");
  });
});

describe("shouldSnap", () => {
  it("gap 在阈值内才吸附", () => {
    const gaps = computeGaps({ x: 1920 - 375 - 10, y: 400 }, SIZE, WORK);
    expect(shouldSnap(gaps, "right", 12)).toBe(true);
    expect(shouldSnap(gaps, "right", 5)).toBe(false);
  });
});

describe("detectCorner", () => {
  it("两个轴向都在容差内才判定为角落", () => {
    const pos = { x: 1920 - 375 - 20, y: 1080 - 375 - 20 };
    const gaps = computeGaps(pos, SIZE, WORK);
    expect(detectCorner(gaps, 40)).toBe("bottom-right");
  });

  it("只有一个轴向靠近时不算角落", () => {
    const gaps = computeGaps({ x: 1920 - 375 - 5, y: 500 }, SIZE, WORK);
    expect(detectCorner(gaps, 40)).toBeNull();
  });

  it("左上角组合正确", () => {
    const gaps = computeGaps({ x: 5, y: 8 }, SIZE, WORK);
    expect(detectCorner(gaps, 40)).toBe("top-left");
  });
});

describe("snapTarget", () => {
  it("单边吸附：只偏移贴边的那一轴", () => {
    const pos = { x: 1900, y: 500 };
    const t = snapTarget({ pos, size: SIZE, work: WORK, edge: "right", corner: null, ratios: RATIOS });
    // 露出 42% → 藏起 375×0.58=217.5→218，窗口右边越界 218
    expect(t).toEqual({ x: 1920 - 375 + 218, y: pos.y });
  });

  it("上缘使用自己的比例，下缘也是", () => {
    const top = snapTarget({ pos: { x: 800, y: 2 }, size: SIZE, work: WORK, edge: "top", corner: null, ratios: RATIOS });
    expect(top.y).toBe(-Math.round(375 * (1 - 0.5)));
    const bottom = snapTarget({ pos: { x: 800, y: 1078 }, size: SIZE, work: WORK, edge: "bottom", corner: null, ratios: RATIOS });
    expect(bottom.y).toBe(1080 - 375 + Math.round(375 * (1 - 0.3)));
  });

  it("角落吸附横竖都改用 corner 比例", () => {
    const t = snapTarget({
      pos: { x: 1900, y: 1078 },
      size: SIZE,
      work: WORK,
      edge: "right",
      corner: "bottom-right",
      ratios: RATIOS,
    });
    const hidden = Math.round(375 * (1 - 0.58));
    expect(t).toEqual({ x: 1920 - 375 + hidden, y: 1080 - 375 + hidden });
  });
});

describe("revealTarget", () => {
  it("角落滑回沿对角线同时收回两轴", () => {
    const t = revealTarget({ x: 1900, y: 1078 }, SIZE, WORK, "bottom-right", "right");
    expect(t).toEqual({ x: 1920 - 375, y: 1080 - 375 });
  });

  it("单边滑回只动贴边的那一轴", () => {
    const t = revealTarget({ x: 1900, y: 500 }, SIZE, WORK, null, "right");
    expect(t).toEqual({ x: 1920 - 375, y: 500 });
  });
});

describe("clampIntoWork", () => {
  it("半截屏外的窗口被收回可用区", () => {
    const t = clampIntoWork({ x: -50, y: 400 }, SIZE, WORK);
    expect(t).toEqual({ x: 0, y: 400 });
  });
});

describe("pickMonitor（多显示器命中）", () => {
  const monitors = [
    { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
    { position: { x: 1920, y: 0 }, size: { width: 2560, height: 1440 } },
  ];

  it("窗口中心落在哪块屏就选哪块", () => {
    const m = pickMonitor(monitors, { x: 2500, y: 300 }, { width: 375, height: 375 }, monitors[0]);
    expect(m).toBe(monitors[1]);
  });

  it("跨屏松手瞬间中心仍在旧屏时不会误选新屏", () => {
    const m = pickMonitor(monitors, { x: 1800, y: 300 }, { width: 375, height: 375 }, monitors[1]);
    // 中心 1987.5 → 第二块屏
    expect(m).toBe(monitors[1]);
  });

  it("中心不在任何屏内（被顶到屏外）时回退 fallback", () => {
    const m = pickMonitor(monitors, { x: 9000, y: 9000 }, { width: 375, height: 375 }, monitors[0]);
    expect(m).toBe(monitors[0]);
  });
});

describe("边缘/角落判定组合（回归：贴边阈值 × DPI）", () => {
  it("DPI 1.5 下 12 逻辑像素阈值换算成 18 物理像素", () => {
    const gaps = computeGaps({ x: 1920 - 375 - 17, y: 400 }, SIZE, WORK);
    gaps.top = 500;
    gaps.bottom = 500;
    gaps.left = 900;
    expect(shouldSnap(gaps, "right", 12 * 1.5)).toBe(true);
    expect(shouldSnap(gaps, "right", 12 * 1.0)).toBe(false);
  });
});
