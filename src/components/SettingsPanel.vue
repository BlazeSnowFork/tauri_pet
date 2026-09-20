<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { onMounted, onUnmounted, reactive } from "vue";

import { DEFAULT_SETTINGS } from "@/stores/pet";
import type { IdleMode, PetSettings, PetSkin } from "@/types";

// 本窗口是独立窗口，和宠物主窗口是不同的 JS 上下文，
// 因此这里维护一份本地副本，通过事件与主窗口双向同步。
const form = reactive<PetSettings>({ ...DEFAULT_SETTINGS });
let unlistenSync: UnlistenFn | null = null;

const skins: { key: PetSkin; label: string }[] = [
  { key: "bear", label: "🐻 小熊" },
  { key: "cat", label: "🐱 小猫" },
];

const idleModes: { key: IdleMode; label: string }[] = [
  { key: "fixed", label: "🧍 固定" },
  { key: "random", label: "🎲 随机" },
];

/** 任何一项改动都推送给宠物主窗口立即生效并持久化 */
function pushChange(): void {
  void emit("settings://changed", { ...form });
}

function chooseSkin(skin: PetSkin): void {
  form.petSkin = skin;
  pushChange();
}

function chooseIdleMode(mode: IdleMode): void {
  form.idleMode = mode;
  pushChange();
}

function close(): void {
  void invoke("hide_settings_window");
}

onMounted(async () => {
  // 主窗口打开本窗口时会主动推送配置；这里再请求一次，避免错过首次同步
  unlistenSync = await listen<PetSettings>("settings://sync", (event) => {
    Object.assign(form, event.payload);
  });
  await emit("settings://request");
});

onUnmounted(() => {
  unlistenSync?.();
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
        <label>宠物形象</label>
        <div class="skin-options">
          <button
            v-for="s in skins"
            :key="s.key"
            type="button"
            class="skin-option"
            :class="{ active: form.petSkin === s.key }"
            @click="chooseSkin(s.key)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <div class="row">
        <label>闲置动作</label>
        <div class="skin-options">
          <button
            v-for="m in idleModes"
            :key="m.key"
            type="button"
            class="skin-option"
            :class="{ active: form.idleMode === m.key }"
            @click="chooseIdleMode(m.key)"
          >
            {{ m.label }}
          </button>
        </div>
        <span class="hint left">随机模式会每隔几秒轮换伸懒腰、张望、小跳、摇头等小动作</span>
      </div>

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

      <div class="row toggle-row">
        <label for="proactive">主动搭话求互动</label>
        <input
          id="proactive"
          v-model="form.proactiveEnabled"
          type="checkbox"
          @change="pushChange"
        />
      </div>

      <div class="row toggle-row">
        <label for="time-report">整点报时</label>
        <input
          id="time-report"
          v-model="form.timeReportEnabled"
          type="checkbox"
          @change="pushChange"
        />
      </div>

      <div class="row toggle-row">
        <label for="break-reminder">休息提醒</label>
        <input
          id="break-reminder"
          v-model="form.breakReminderEnabled"
          type="checkbox"
          @change="pushChange"
        />
      </div>

      <div v-if="form.breakReminderEnabled" class="row">
        <label for="break-after">连续用机提醒间隔（分钟）</label>
        <input
          id="break-after"
          v-model.number="form.breakAfterMin"
          class="number-input"
          type="number"
          min="15"
          max="240"
          step="5"
          @change="pushChange"
        />
        <span class="hint left">离开电脑 5 分钟以上视为已休息，计时自动清零</span>
      </div>

      <div class="actions">
        <button type="button" class="btn primary" @click="close">完成</button>
      </div>
    </div>
  </div>
</template>
