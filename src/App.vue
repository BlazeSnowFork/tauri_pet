<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";

import Pet from "@/components/Pet.vue";
import SpeechBubble from "@/components/SpeechBubble.vue";
import { usePetStore } from "@/stores/pet";

const store = usePetStore();

onMounted(async () => {
  await store.init();
});

onUnmounted(() => {
  store.dispose();
});
</script>

<template>
  <div class="app-root">
    <Pet v-if="store.ready" />
    <SpeechBubble v-if="store.ready && store.bubble.visible" :text="store.bubble.text" />
  </div>
</template>
