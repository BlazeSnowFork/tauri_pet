<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted, ref } from "vue";

import { DEMO_ENTRIES } from "@/logic/props";
import type { MenuAction, MenuDemo, MenuItemDef } from "@/types";

/** 主菜单窗口逻辑尺寸（与 Rust MENU_SIZE / tauri.conf.json 同步）；
 * 演示页与主菜单同尺寸，靠内部单列滚动容纳全部动作，
 * 也避免加高后在屏幕底部弹出时超出工作区（Rust 定位只按此高度夹取）。 */

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

/** 演示页可选动作：条目表在 logic/props.ts 的 DEMO_ENTRIES（features 自测校验同一份数据） */
const demos = DEMO_ENTRIES;

const page = ref<"main" | "demo">("main");

function openDemoPage(): void {
  page.value = "demo";
}

function backToMain(): void {
  page.value = "main";
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
        <button type="button" class="demo-back" @click="backToMain">
          ← 返回
        </button>
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
