import { describe, expect, it } from "vitest";

import { activeProps, IDLE_PROPS, type PropsState } from "@/logic/props";
import type { IdleVariant, PetAnimation } from "@/types";

function state(over: Partial<PropsState> = {}): PropsState {
  return {
    displayAnimation: "idle",
    isIdle: true,
    idleVariant: "bob",
    butterfly: false,
    ...over,
  };
}

describe("activeProps（动作 → 道具查表）", () => {
  it("闲置 spin 带出呼啦圈", () => {
    expect(activeProps(state({ idleVariant: "spin" }))).toEqual(["hoop"]);
  });

  it("dance 同时带出音符与光圈", () => {
    expect(new Set(activeProps(state({ idleVariant: "dance" })))).toEqual(
      new Set(["notes", "lightPool"]),
    );
  });

  it("无道具的闲置变体返回空", () => {
    expect(activeProps(state({ idleVariant: "bob" }))).toEqual([]);
    expect(activeProps(state({ idleVariant: "nod" as IdleVariant }))).toEqual([]);
  });

  it("临时动作期间不叠加闲置道具", () => {
    const s = state({
      displayAnimation: "eat" as PetAnimation,
      isIdle: false,
      idleVariant: "spin",
    });
    expect(activeProps(s)).toEqual(["jar"]);
  });

  it("play 带球拍和羽毛球", () => {
    const s = state({ displayAnimation: "play", isIdle: false });
    expect(new Set(activeProps(s))).toEqual(new Set(["racket", "shuttle"]));
  });

  it("蝴蝶小剧本与动作道具合并去重", () => {
    const s = state({ idleVariant: "look", butterfly: true });
    expect(new Set(activeProps(s))).toEqual(new Set(["question", "butterfly"]));
  });

  it("每个映射到的闲置变体都是合法 key", () => {
    for (const k of Object.keys(IDLE_PROPS)) {
      expect(activeProps(state({ idleVariant: k as IdleVariant })).length).toBeGreaterThan(0);
    }
  });
});
