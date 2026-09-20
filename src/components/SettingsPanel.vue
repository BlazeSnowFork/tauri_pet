<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onMounted, onUnmounted, reactive, ref } from "vue";

import { DEFAULT_SETTINGS } from "@/stores/pet";
import type { PetSettings, PetStats, SettingsSyncPayload } from "@/types";

// 本窗口是独立窗口，和宠物主窗口是不同的 JS 上下文，
// 因此这里维护一份本地副本，通过事件与主窗口双向同步。
const form = reactive<PetSettings>({ ...DEFAULT_SETTINGS });
const stats = ref<PetStats>({ hunger: 0, mood: 0, energy: 0 });
let unlistenSync: UnlistenFn | null = null;
let unlistenStats: UnlistenFn | null = null;

/** 任何一项改动都推送给宠物主窗口立即生效并持久化 */
function pushChange(): void {
  void emit("settings://changed", { ...form });
}

function close(): void {
  void invoke("hide_settings_window");
}

function resetStats(): void {
  void emit("settings://reset-stats");
}

onMounted(async () => {
  unlistenStats = await listen<PetStats>("settings://stats", (event) => {
    stats.value = event.payload;
  });
  // 主窗口打开本窗口时会主动推送配置；这里再请求一次，避免错过首次同步
  unlistenSync = await listen<SettingsSyncPayload>("settings://sync", (event) => {
    Object.assign(form, event.payload.settings);
    stats.value = event.payload.stats;
  });
  await emit("settings://request");
});

onUnmounted(() => {
  unlistenSync?.();
  unlistenStats?.();
});
</script>

<template>
  <div class="settings-window">
    <div class="settings-header">
      <h2>宠物设置</h2>
      <button type="button" class="btn-close" title="关闭" @click="close">✕</button>
    </div>

    <div class="settings-body">
      <div class="row">
        <label for="pet-size">宠物大小</label>
        <div class="row-control">
          <input
            id="pet-size"
            v-model.number="form.petSize"
            type="range"
            min="200"
            max="500"
            step="10"
            @change="pushChange"
          />
          <span class="hint">{{ form.petSize }}px</span>
        </div>
      </div>

      <div class="row toggle-row">
        <label for="always-top">始终置顶</label>
        <input
          id="always-top"
          v-model="form.alwaysOnTop"
          type="checkbox"
          @change="pushChange"
        />
      </div>

      <div class="row toggle-row">
        <label for="autostart">开机自启</label>
        <input id="autostart" v-model="form.autostart" type="checkbox" @change="pushChange" />
      </div>

      <div class="row">
        <label for="anim-speed">动画速度</label>
        <div class="row-control">
          <input
            id="anim-speed"
            v-model.number="form.animationSpeed"
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            @change="pushChange"
          />
          <span class="hint">x{{ form.animationSpeed.toFixed(1) }}</span>
        </div>
      </div>

      <div class="row">
        <label for="decay-speed">衰减速度</label>
        <div class="row-control">
          <input
            id="decay-speed"
            v-model.number="form.decaySpeed"
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            @change="pushChange"
          />
          <span class="hint">x{{ form.decaySpeed.toFixed(1) }}</span>
        </div>
      </div>

      <div class="row toggle-row">
        <label for="reminder">定时提醒</label>
        <input
          id="reminder"
          v-model="form.reminderEnabled"
          type="checkbox"
          @change="pushChange"
        />
      </div>

      <div v-if="form.reminderEnabled" class="row">
        <label for="reminder-interval">提醒间隔（分钟）</label>
        <input
          id="reminder-interval"
          v-model.number="form.reminderIntervalMin"
          class="number-input"
          type="number"
          min="5"
          max="240"
          step="5"
          @change="pushChange"
        />
      </div>

      <div class="stats-preview">
        <span>🍖 饱食 {{ Math.round(stats.hunger) }}</span>
        <span>💗 心情 {{ Math.round(stats.mood) }}</span>
        <span>⚡ 精力 {{ Math.round(stats.energy) }}</span>
      </div>

      <div class="actions">
        <button type="button" class="btn danger" @click="resetStats">重置宠物状态</button>
        <button type="button" class="btn primary" @click="close">完成</button>
      </div>
    </div>
  </div>
</template>
