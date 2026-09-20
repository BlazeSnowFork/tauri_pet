<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onUnmounted } from "vue";

import { usePetStore } from "@/stores/pet";

/** 单击/双击区分窗口（毫秒），与 store 中的睡眠时长无关 */
const CLICK_INTERVAL_MS = 260;
const DRAG_THRESHOLD_PX = 8;

const store = usePetStore();

/** 只有纯闲置状态才套用随机小动作（睡觉/临时动画期间不轮换） */
const isIdle = computed(() => store.displayAnimation === "idle");

let downPos: { x: number; y: number } | null = null;
let dragging = false;
let clickTimer: number | null = null;

const isSleeping = computed(() => store.displayAnimation === "sleep");
const isEating = computed(() => store.displayAnimation === "eat");

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  downPos = { x: e.clientX, y: e.clientY };
  dragging = false;
}

function onPointerMove(e: PointerEvent): void {
  if (!downPos || dragging) return;
  const dx = e.clientX - downPos.x;
  const dy = e.clientY - downPos.y;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
    dragging = true;
    downPos = null;
    // 交给系统接管拖拽；不依赖它的返回时机判断拖拽结束，
    // 结束判定由 store 依据窗口移动事件去抖动得出
    store.beginDrag();
    store.dragStart();
    void getCurrentWindow().startDragging();
  }
}

function onPointerUp(e: PointerEvent): void {
  if (e.button !== 0) return;
  const wasDragging = dragging;
  downPos = null;
  dragging = false;
  if (wasDragging) {
    store.endDrag();
    return;
  }

  // 贴在屏幕边缘时，点击先让宠物完整滑回，不触发随机动作
  if (store.edgeHidden) {
    void store.revealFromEdge();
    return;
  }

  // 睡觉时点击立即叫醒（带起床气），不等单击/双击判定窗口
  if (store.sleeping) {
    if (clickTimer !== null) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    store.wakeUp(true);
    return;
  }

  if (clickTimer !== null) {
    // 第二次按下：双击
    clearTimeout(clickTimer);
    clickTimer = null;
    store.doubleClickPoke();
  } else {
    // 第一次按下：延迟确认是否为双击
    clickTimer = window.setTimeout(() => {
      clickTimer = null;
      store.poke();
    }, CLICK_INTERVAL_MS);
  }
}

function onContextMenu(e: MouseEvent): void {
  e.preventDefault();
  store.openContextMenu();
}

onUnmounted(() => {
  if (clickTimer !== null) clearTimeout(clickTimer);
});
</script>

<template>
  <div
    class="pet-wrap"
    title="点击互动（连点有彩蛋），拖拽移动，右键菜单"
    @contextmenu="onContextMenu"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
  >
    <div
      class="pet"
      :class="[
        `anim-${store.displayAnimation}`,
        isIdle ? `idle-${store.idleVariant}` : '',
        store.edgeHidden && !store.sliding && store.edge
          ? `peek-${store.corner ?? store.edge}`
          : '',
        store.spinning && store.spinEdge ? `spin-${store.spinEdge}` : '',
        `skin-${store.settings.petSkin}`,
      ]"
      :style="{ '--speed': store.settings.animationSpeed }"
    >
      <!-- 棕色小熊 -->
      <svg
        v-if="store.settings.petSkin === 'bear'"
        class="pet-svg"
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
      >
        <!-- 圆耳朵 -->
        <circle class="ear" cx="54" cy="56" r="26" />
        <circle class="ear" cx="146" cy="56" r="26" />
        <circle class="ear-inner" cx="54" cy="56" r="13" />
        <circle class="ear-inner" cx="146" cy="56" r="13" />
        <!-- 身体 -->
        <ellipse class="body" cx="100" cy="122" rx="72" ry="64" />
        <!-- 口鼻区 -->
        <ellipse class="muzzle" cx="100" cy="136" rx="28" ry="20" />
        <!-- 眼睛 -->
        <g v-if="!isSleeping" class="eyes">
          <circle cx="76" cy="110" r="7" />
          <circle cx="124" cy="110" r="7" />
        </g>
        <g v-else class="eyes-closed">
          <path d="M68 110 Q76 117 84 110" />
          <path d="M116 110 Q124 117 132 110" />
        </g>
        <!-- 鼻子 + 嘴 -->
        <ellipse class="nose" cx="100" cy="127" rx="9" ry="6.5" />
        <ellipse v-if="isEating" class="mouth-open" cx="100" cy="145" rx="11" ry="8" />
        <path v-else class="mouth" d="M91 143 Q96 149 101 143 Q106 149 111 143" />
        <!-- 腮红 -->
        <ellipse class="cheek" cx="60" cy="128" rx="10" ry="6" />
        <ellipse class="cheek" cx="140" cy="128" rx="10" ry="6" />
        <!-- 睡觉 Zzz -->
        <g v-if="isSleeping" class="zzz">
          <text x="160" y="52">z</text>
          <text x="174" y="36">Z</text>
          <text x="186" y="22">Z</text>
        </g>
      </svg>
      <!-- 小猫 -->
      <svg v-else class="pet-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <!-- 耳朵 -->
        <path class="ear" d="M56 84 L42 28 L94 56 Z" />
        <path class="ear" d="M144 84 L158 28 L106 56 Z" />
        <path class="ear-inner" d="M62 76 L53 44 L84 60 Z" />
        <path class="ear-inner" d="M138 76 L147 44 L116 60 Z" />
        <!-- 身体 -->
        <ellipse class="body" cx="100" cy="122" rx="70" ry="62" />
        <!-- 眼睛 -->
        <g v-if="!isSleeping" class="eyes">
          <circle cx="78" cy="112" r="7" />
          <circle cx="122" cy="112" r="7" />
        </g>
        <g v-else class="eyes-closed">
          <path d="M70 112 Q78 119 86 112" />
          <path d="M114 112 Q122 119 130 112" />
        </g>
        <!-- 嘴 -->
        <ellipse v-if="isEating" class="mouth-open" cx="100" cy="136" rx="11" ry="8" />
        <path v-else class="mouth" d="M91 132 Q96 138 101 132 Q106 138 111 132" />
        <!-- 腮红 -->
        <ellipse class="cheek" cx="64" cy="128" rx="10" ry="6" />
        <ellipse class="cheek" cx="136" cy="128" rx="10" ry="6" />
        <!-- 睡觉 Zzz -->
        <g v-if="isSleeping" class="zzz">
          <text x="138" y="62">z</text>
          <text x="154" y="46">Z</text>
          <text x="168" y="32">Z</text>
        </g>
      </svg>
    </div>
  </div>
</template>
