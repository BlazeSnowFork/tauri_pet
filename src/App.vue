<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

import ContextMenu from "@/components/ContextMenu.vue";
import Pet from "@/components/Pet.vue";
import SettingsPanel from "@/components/SettingsPanel.vue";
import SpeechBubble from "@/components/SpeechBubble.vue";
import { usePetStore } from "@/stores/pet";

const store = usePetStore();

/** 点击菜单外部时关闭菜单（捕获阶段，先于菜单项 click 执行前的按下判断） */
function onGlobalPointerDown(e: PointerEvent): void {
  if (!store.contextMenu.visible) return;
  const menu = document.getElementById("context-menu");
  if (menu && !menu.contains(e.target as Node)) {
    store.closeContextMenu();
  }
}

onMounted(async () => {
  document.addEventListener("pointerdown", onGlobalPointerDown, true);
  await store.init();
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onGlobalPointerDown, true);
});
</script>

<template>
  <div class="app-root" :class="{ 'settings-mode': store.settingsOpen }">
    <Pet v-if="store.ready && !store.settingsOpen" />
    <SettingsPanel v-if="store.settingsOpen" />
    <SpeechBubble
      v-if="store.ready && !store.settingsOpen && store.bubble.visible"
      :text="store.bubble.text"
    />
    <ContextMenu v-if="store.contextMenu.visible" />
  </div>
</template>
