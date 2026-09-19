<script setup lang="ts">
import { usePetStore } from "@/stores/pet";

const store = usePetStore();
</script>

<template>
  <div class="bubble">
    {{ store.bubble.text }}
  </div>
</template>
