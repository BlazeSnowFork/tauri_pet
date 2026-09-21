import { describe, expect, it } from "vitest";

import { mergeSettings } from "@/logic/settings";
import type { PetSettings } from "@/types";

const DEFAULTS: PetSettings = {
  petSkin: "bear-full",
  idleMode: "random",
  petSize: 260,
  alwaysOnTop: true,
  autostart: false,
  animationSpeed: 1,
  performanceMode: false,
  proactiveEnabled: true,
  timeReportEnabled: true,
  breakReminderEnabled: true,
  breakAfterMin: 60,
};

describe("mergeSettings（老存档前向兼容）", () => {
  it("缺 key 时用默认值补齐（新增设置项不炸老存档）", () => {
    const merged = mergeSettings(DEFAULTS, { petSize: 300 });
    expect(merged.petSize).toBe(300);
    expect(merged.petSkin).toBe("bear-full");
    expect(merged.performanceMode).toBe(false);
  });

  it("raw 为 null/undefined 时返回默认值副本", () => {
    expect(mergeSettings(DEFAULTS, null)).toEqual(DEFAULTS);
    expect(mergeSettings(DEFAULTS, undefined)).toEqual(DEFAULTS);
    expect(mergeSettings(DEFAULTS, null)).not.toBe(DEFAULTS);
  });

  it("超出范围的数值被夹回合法区间", () => {
    expect(mergeSettings(DEFAULTS, { petSize: 50 }).petSize).toBe(200);
    expect(mergeSettings(DEFAULTS, { petSize: 9999 }).petSize).toBe(500);
    expect(mergeSettings(DEFAULTS, { animationSpeed: 0 }).animationSpeed).toBe(0.5);
    expect(mergeSettings(DEFAULTS, { animationSpeed: 10 }).animationSpeed).toBe(2);
    expect(mergeSettings(DEFAULTS, { breakAfterMin: 1 }).breakAfterMin).toBe(15);
    expect(mergeSettings(DEFAULTS, { breakAfterMin: 9999 }).breakAfterMin).toBe(240);
  });

  it("区间内的值原样保留", () => {
    const merged = mergeSettings(DEFAULTS, { petSize: 320, animationSpeed: 1.3, breakAfterMin: 90 });
    expect(merged).toEqual({ ...DEFAULTS, petSize: 320, animationSpeed: 1.3, breakAfterMin: 90 });
  });
});
