import { describe, expect, it } from "vitest";

import {
  computeGaps,
  decideSnap,
  DEFAULT_EDGE_RATIOS,
  DEFAULT_GROUND_SINK_RATIO,
  snapTarget,
  type Point,
  type Rect,
} from "@/logic/edge";
import {
  ANIMATION_PROPS,
  activeProps,
  DEMO_ENTRIES,
  IDLE_VARIANT_ICONS,
  IDLE_VARIANT_LABELS,
  type PropsState,
} from "@/logic/props";
import type { IdleVariant, MenuDemo, ScreenCorner, ScreenEdge } from "@/types";

/**
 * 发布前的功能自测：跨模块的"约定"在这里锁死。
 * 单元测试（edge/props/settings.test.ts）管单个函数算得对不对，
 * 本文件管的是"改了 A 忘了改 B"就会翻车的联动关系：
 * 贴边吸附的判定/落位互洽、演示页数据表与动作表同步、道具表覆盖每个演示项。
 * CI 在打包前跑 `npm run test`，任一条不符就出不了包。
 */

// 单屏 1920×1080、DPI=1 的语境（物理像素与逻辑像素同数值，便于手算）
const WORK: Rect = {
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
};
const SIZE = { width: 375, height: 375 };
const THRESHOLD = 12;
const CORNER_TOL = 40;
// 与 stores/pet.ts 的同名常量保持一致（脱附比吸附多走这段余量）
const UNSTICK_EXTRA = 26;

function snap(x: number, y: number, threshold = THRESHOLD) {
  return decideSnap({ x, y }, SIZE, WORK, threshold, CORNER_TOL);
}

describe("贴边吸附：decideSnap 判定与 snapTarget 落位互洽", () => {
  it("四条边各自在阈值内吸附，越过阈值即不吸", () => {
    expect(snap(-5, 300)).toMatchObject({ edge: "left", snapping: true });
    expect(snap(5, 300)).toMatchObject({ edge: "left", snapping: true });
    expect(snap(1533, 300)).toMatchObject({ edge: "right", snapping: true }); // gap=12
    expect(snap(1500, 300)).toMatchObject({ edge: "right", snapping: false }); // gap=45
    expect(snap(800, 10)).toMatchObject({ edge: "top", snapping: true });
    expect(snap(800, 300)).toMatchObject({ snapping: false });
  });

  it("底边单侧不吸附：底部松手是站在地面，留给地面漫步", () => {
    expect(snap(800, 705)).toMatchObject({ edge: "bottom", snapping: false });
  });

  it("但角落仍然吸附（想触发底部探头姿态请拖到左下/右下角）", () => {
    expect(snap(20, 705)).toMatchObject({
      corner: "bottom-left",
      snapping: true,
    });
    expect(snap(1525, 5)).toMatchObject({
      corner: "top-right",
      snapping: true,
    });
  });

  it("阈值随 DPI 缩放：同一物理间距在高倍屏上更容易吸上", () => {
    // 物理间距 15：1 倍屏（阈值 12）不吸，1.5 倍屏（阈值 12×1.5=18）吸得上
    const atGap15 = 1920 - SIZE.width - 15;
    expect(snap(atGap15, 300, THRESHOLD).snapping).toBe(false);
    expect(snap(atGap15, 300, THRESHOLD * 1.5).snapping).toBe(true);
  });

  it("吸附落位后仍判为贴边：不会自己弹开（磁吸稳定）", () => {
    for (const pos of [
      { x: 5, y: 300 },
      { x: 1530, y: 300 },
      { x: 800, y: 8 },
    ]) {
      const { edge, corner } = decideSnap(
        pos,
        SIZE,
        WORK,
        THRESHOLD,
        CORNER_TOL,
      );
      expect(corner, JSON.stringify(pos)).toBeNull();
      const pinned = snapTarget({
        pos,
        size: SIZE,
        work: WORK,
        edge,
        corner,
        ratios: DEFAULT_EDGE_RATIOS,
      });
      expect(
        decideSnap(pinned, SIZE, WORK, THRESHOLD, CORNER_TOL).snapping,
        JSON.stringify(pos),
      ).toBe(true);
    }
  });

  it("落位是幂等的：同一位置反复求吸附目标结果不变（不会越推越深）", () => {
    const specs: {
      pos: Point;
      edge: ScreenEdge;
      corner: ScreenCorner | null;
    }[] = [
      { pos: { x: 5, y: 300 }, edge: "left", corner: null },
      { pos: { x: 1530, y: 260 }, edge: "right", corner: null },
      { pos: { x: 700, y: 8 }, edge: "top", corner: null },
      { pos: { x: 15, y: 15 }, edge: "left", corner: "top-left" },
    ];
    for (const spec of specs) {
      const args = {
        size: SIZE,
        work: WORK,
        ratios: DEFAULT_EDGE_RATIOS,
        ...spec,
      };
      const once = snapTarget(args);
      const twice = snapTarget({ ...args, pos: once });
      expect(twice).toEqual(once);
    }
  });

  it("脱附线在吸附线之外（迟滞，防止阈值线上反复吸放）", () => {
    const unstickLine = THRESHOLD + UNSTICK_EXTRA;
    // 拖到两条线之间：store 的 dragHoldTick 判据是 gap > unstickLine，
    // 因此这个区间内仍保持吸附，不会一过吸附阈值就立刻掉下去
    const gap = computeGaps(
      { x: THRESHOLD + UNSTICK_EXTRA / 2, y: 300 },
      SIZE,
      WORK,
    ).left;
    expect(gap).toBeGreaterThan(THRESHOLD);
    expect(gap).toBeLessThanOrEqual(unstickLine);
    // 吸上时窗口被推出屏幕外（保持轴 gap 为负），所以得往回拖一大段才谈得上脱附
    const pinned = snapTarget({
      pos: { x: 3, y: 300 },
      size: SIZE,
      work: WORK,
      edge: "left",
      corner: null,
      ratios: DEFAULT_EDGE_RATIOS,
    });
    expect(computeGaps(pinned, SIZE, WORK).left).toBeLessThan(0);
  });
});

describe("贴边露出比例：单一调档点的取值范围", () => {
  it("每条边都留出 0~1 之间的可见比例，角落比单边露得更多", () => {
    for (const [key, ratio] of Object.entries(DEFAULT_EDGE_RATIOS)) {
      expect(ratio, key).toBeGreaterThan(0);
      expect(ratio, key).toBeLessThanOrEqual(1);
    }
    expect(DEFAULT_EDGE_RATIOS.corner).toBeGreaterThan(
      DEFAULT_EDGE_RATIOS.left,
    );
    expect(DEFAULT_EDGE_RATIOS.corner).toBeGreaterThan(
      DEFAULT_EDGE_RATIOS.bottom,
    );
  });

  it("底部脚踩线比例 = 画面透明衬底份额（约 17.2%）", () => {
    expect(DEFAULT_GROUND_SINK_RATIO).toBeGreaterThan(0.1);
    expect(DEFAULT_GROUND_SINK_RATIO).toBeLessThan(0.3);
  });
});

describe("演示页数据表（ContextMenu 渲染 / 主窗口 playDemo 消费）", () => {
  const variants = Object.keys(IDLE_VARIANT_LABELS) as IdleVariant[];

  it("覆盖全部闲置变体 + 吃/玩/漫步/蝴蝶四个特殊动作，且名称不重复", () => {
    expect(DEMO_ENTRIES).toHaveLength(variants.length + 4);
    const labels = DEMO_ENTRIES.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
    const idleVariants = DEMO_ENTRIES.filter(
      (e) => e.demo.target === "idle",
    ).map((e) => (e.demo as Extract<MenuDemo, { target: "idle" }>).variant);
    expect(new Set(idleVariants)).toEqual(new Set(variants));
  });

  it("每条都以图标开头（新增动作时漏了图标会被测出来）", () => {
    for (const entry of DEMO_ENTRIES) {
      const expectedIcon =
        entry.demo.target === "idle"
          ? IDLE_VARIANT_ICONS[entry.demo.variant]
          : entry.label.slice(0, entry.label.indexOf(" "));
      expect(expectedIcon, entry.label).toBeTruthy();
      expect(entry.label.startsWith(`${expectedIcon} `), entry.label).toBe(
        true,
      );
    }
  });

  it("闲置变体的中文名与图标表 key 完全对齐", () => {
    expect(Object.keys(IDLE_VARIANT_ICONS).sort()).toEqual(
      Object.keys(IDLE_VARIANT_LABELS).sort(),
    );
    for (const label of Object.values(IDLE_VARIANT_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("演示的临时动作都有道具可渲染（不会演一场空手戏）", () => {
    const temps = DEMO_ENTRIES.filter((e) => e.demo.target === "temp").map(
      (e) => (e.demo as Extract<MenuDemo, { target: "temp" }>).anim,
    );
    expect(temps.sort()).toEqual(["eat", "play"]);
    for (const anim of temps) {
      const s: PropsState = {
        displayAnimation: anim,
        isIdle: false,
        idleVariant: "bob",
        butterfly: false,
      };
      expect(activeProps(s).length, anim).toBeGreaterThan(0);
      expect(ANIMATION_PROPS[anim]?.length, anim).toBeGreaterThan(0);
    }
  });
});
