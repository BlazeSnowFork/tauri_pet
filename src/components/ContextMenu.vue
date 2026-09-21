<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { onMounted, ref } from "vue";

import { IDLE_VARIANT_LABELS } from "@/logic/props";
import type { IdleVariant, MenuAction, MenuDemo, MenuItemDef } from "@/types";

/** 主菜单与动作演示页的窗口逻辑尺寸（与 Rust MENU_SIZE / tauri.conf.json 同步） */
const MAIN_SIZE = { w: 176, h: 282 };
/** 演示页同宽、加高，动作列表在内部单列滚动 */
const DEMO_SIZE = { w: 176, h: 420 };

const items: MenuItemDef[] = [
  { key: "feed", label: "🍖 喂食" },
  { key: "play", label: "🎾 玩耍" },
  { key: "talk", label: "💬 说话" },
  { key: "sleep", label: "💤 睡觉" },
  { key: "demo", label: "🎭 动作演示" },
  { key: "settings", label: "⚙️ 设置" },
  { key: "hide", label: "🙈 隐藏宠物" },
  { key: "quit", label: "🚪 退出", danger: true },
];

/** 演示页可选动作：全部闲置变体（沿用 IDLE_VARIANT_LABELS 的声明顺序）+ 两个道具动作 */
const demos: { label: string; demo: MenuDemo }[] = [
  ...(Object.keys(IDLE_VARIANT_LABELS) as IdleVariant[]).map((v) => ({
    label: IDLE_VARIANT_LABELS[v],
    demo: { target: "idle", variant: v } as MenuDemo,
  })),
  { label: "🍯 吃蜂蜜", demo: { target: "temp", anim: "eat" } },
  { label: "🏸 打羽毛球", demo: { target: "temp", anim: "play" } },
];

const page = ref<"main" | "demo">("main");

async function resizeTo(size: { w: number; h: number }): Promise<void> {
  try {
    await getCurrentWindow().setSize(new LogicalSize(size.w, size.h));
  } catch (err) {
    console.warn("调整菜单窗口尺寸失败:", err);
  }
}

async function openDemoPage(): Promise<void> {
  page.value = "demo";
  await resizeTo(DEMO_SIZE);
}

async function backToMain(): Promise<void> {
  page.value = "main";
  await resizeTo(MAIN_SIZE);
}

/** 把选中的动作广播给宠物主窗口，然后关闭菜单窗口 */
async function choose(action: MenuAction): Promise<void> {
  await emit("menu://action", action);
  await invoke("hide_context_menu");
  await backToMain();
}

/** 演示页选中单个动作：广播后关菜单并还原主菜单尺寸 */
async function pickDemo(demo: MenuDemo): Promise<void> {
  await emit("menu://demo", demo);
  await invoke("hide_context_menu");
  await backToMain();
}

onMounted(() => {
  // 失焦时菜单会被 Rust 隐藏；若停在演示页则翻回主菜单，下次弹出不错页
  void getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (!focused && page.value === "demo") void backToMain();
  });
});
</script>

<template>
  <div class="ctx-window">
    <div v-if="page === 'main'" class="ctx-menu">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="ctx-item"
        :class="{ danger: item.danger }"
        @click="item.key === 'demo' ? openDemoPage() : choose(item.key)"
      >
        {{ item.label }}
      </button>
    </div>

    <div v-else class="ctx-menu demo-menu">
      <div class="demo-head">
        <button type="button" class="demo-back" @click="backToMain">← 返回</button>
        <span class="demo-title">选择动作</span>
      </div>
      <div class="demo-grid">
        <button
          v-for="entry in demos"
          :key="entry.label"
          type="button"
          class="demo-item"
          @click="pickDemo(entry.demo)"
        >
          {{ entry.label }}
        </button>
      </div>
    </div>
  </div>
</template>
