<script setup lang="ts">
import { usePetStore } from "@/stores/pet";

const store = usePetStore();

function onChanged(): void {
  void store.onSettingsChanged();
}
</script>

<template>
  <div class="settings-mask">
    <div class="settings-card">
      <div class="settings-header">
        <h2>设置</h2>
        <button type="button" class="btn-close" @click="store.closeSettings()">✕</button>
      </div>

      <div class="settings-body">
        <div class="row">
          <label>宠物大小</label>
          <div class="row-control">
            <input
              v-model.number="store.settings.petSize"
              type="range"
              min="200"
              max="500"
              step="10"
              @change="onChanged"
            />
            <span class="hint">{{ store.settings.petSize }}px</span>
          </div>
        </div>

        <div class="row toggle-row">
          <label for="always-top">始终置顶</label>
          <input
            id="always-top"
            v-model="store.settings.alwaysOnTop"
            type="checkbox"
            @change="onChanged"
          />
        </div>

        <div class="row toggle-row">
          <label for="autostart">开机自启</label>
          <input
            id="autostart"
            v-model="store.settings.autostart"
            type="checkbox"
            @change="onChanged"
          />
        </div>

        <div class="row">
          <label>动画速度</label>
          <div class="row-control">
            <input
              v-model.number="store.settings.animationSpeed"
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              @change="onChanged"
            />
            <span class="hint">x{{ store.settings.animationSpeed.toFixed(1) }}</span>
          </div>
        </div>

        <div class="row">
          <label>衰减速度</label>
          <div class="row-control">
            <input
              v-model.number="store.settings.decaySpeed"
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              @change="onChanged"
            />
            <span class="hint">x{{ store.settings.decaySpeed.toFixed(1) }}</span>
          </div>
        </div>

        <div class="row toggle-row">
          <label for="reminder">定时提醒</label>
          <input
            id="reminder"
            v-model="store.settings.reminderEnabled"
            type="checkbox"
            @change="onChanged"
          />
        </div>

        <div v-if="store.settings.reminderEnabled" class="row">
          <label for="reminder-interval">提醒间隔（分钟）</label>
          <input
            id="reminder-interval"
            v-model.number="store.settings.reminderIntervalMin"
            class="number-input"
            type="number"
            min="5"
            max="240"
            step="5"
            @change="onChanged"
          />
        </div>

        <div class="stats-preview">
          <span>🍖 {{ Math.round(store.stats.hunger) }}</span>
          <span>💗 {{ Math.round(store.stats.mood) }}</span>
          <span>⚡ {{ Math.round(store.stats.energy) }}</span>
        </div>

        <div class="actions">
          <button type="button" class="btn danger" @click="store.resetStats()">
            重置宠物状态
          </button>
          <button type="button" class="btn primary" @click="store.closeSettings()">
            保存并关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
