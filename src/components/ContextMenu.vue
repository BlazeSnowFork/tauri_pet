<script setup lang="ts">
import type { MenuItemDef } from "@/types";

import { usePetStore } from "@/stores/pet";

const store = usePetStore();

const items: MenuItemDef[] = [
  { key: "feed", label: "🍖 喂食" },
  { key: "play", label: "🎾 玩耍" },
  { key: "sleep", label: "💤 睡觉" },
  { key: "settings", label: "⚙️ 设置" },
  { key: "hide", label: "🙈 隐藏宠物" },
  { key: "quit", label: "🚪 退出", danger: true },
];
</script>

<template>
  <div
    id="context-menu"
    class="ctx-menu"
    :style="{ left: `${store.contextMenu.x}px`, top: `${store.contextMenu.y}px` }"
    @contextmenu.prevent
  >
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="ctx-item"
      :class="{ danger: item.danger }"
      @click.stop="store.handleMenuAction(item.key)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
