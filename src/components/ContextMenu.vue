<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import type { MenuAction, MenuItemDef } from "@/types";

const items: MenuItemDef[] = [
  { key: "feed", label: "🍖 喂食" },
  { key: "play", label: "🎾 玩耍" },
  { key: "sleep", label: "💤 睡觉" },
  { key: "settings", label: "⚙️ 设置" },
  { key: "hide", label: "🙈 隐藏宠物" },
  { key: "quit", label: "🚪 退出", danger: true },
];

/** 把选中的动作广播给宠物主窗口，然后关闭菜单窗口 */
async function choose(action: MenuAction): Promise<void> {
  await emit("menu://action", action);
  await invoke("hide_context_menu");
}
</script>

<template>
  <div class="ctx-window">
    <div class="ctx-menu">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="ctx-item"
        :class="{ danger: item.danger }"
        @click="choose(item.key)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>
