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
        `skin-${store.settings.petSkin}`,
      ]"
      :style="{ '--speed': store.settings.animationSpeed }"
    >
      <!-- 毛绒小熊：渐变绒毛 + 毛绒滤镜质感，站立泰迪造型（用户提供设计稿） -->
      <svg
        v-if="store.settings.petSkin === 'bear-full'"
        class="pet-svg"
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <!-- 主体毛绒棕色渐变 -->
          <radialGradient id="furGrad" cx="40%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#EFCFAA" />
            <stop offset="50%" stop-color="#DCA877" />
            <stop offset="100%" stop-color="#B98356" />
          </radialGradient>
          <!-- 嘴套/内耳/肚皮的奶油色渐变 -->
          <radialGradient id="creamGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#FFFFFF" />
            <stop offset="100%" stop-color="#FCE5D3" />
          </radialGradient>
          <!-- 毛绒纹理：深浅交错的短绒毛丝，叠在头部/耳朵上 -->
          <pattern id="furPattern" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
            <path d="M2 1 Q3.5 4.5 2 8" fill="none" stroke="#8a5a30" stroke-width="0.7" opacity="0.28" />
            <path d="M6.5 0 Q8 3.5 6.5 7" fill="none" stroke="#f7e3c8" stroke-width="0.7" opacity="0.35" />
            <path d="M4.5 4 Q6 6.5 4.5 9" fill="none" stroke="#a97044" stroke-width="0.6" opacity="0.22" />
          </pattern>
          <!-- 毛绒边缘滤镜：模拟绒毛的毛糙质感 -->
          <filter id="fuzzy" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        <!-- 底部影子 -->
        <ellipse cx="100" cy="202" rx="66" ry="11" fill="#000000" opacity="0.18" filter="url(#blur)" />

        <g filter="url(#fuzzy)">
          <!-- 腿（纯棕色站立，偶尔交换重心） -->
          <g class="leg-l">
            <rect x="58" y="146" width="34" height="60" rx="17" fill="url(#furGrad)" />
          </g>
          <g class="leg-r">
            <rect x="108" y="146" width="34" height="60" rx="17" fill="url(#furGrad)" />
          </g>

          <!-- 躯干组：身体 + 肚皮 + 脖子（呼吸起伏） -->
          <g class="torso">
            <ellipse cx="100" cy="136" rx="55" ry="50" fill="url(#furGrad)" />
            <ellipse cx="100" cy="152" rx="30" ry="28" fill="url(#creamGrad)" opacity="0.95" />
            <path d="M 82 146 Q 100 166 118 146" fill="none" stroke="#C89468" stroke-width="2" stroke-dasharray="3 3" opacity="0.4" />
            <path d="M 85 156 Q 100 171 115 156" fill="none" stroke="#C89468" stroke-width="2" stroke-dasharray="3 3" opacity="0.4" />
            <rect x="82" y="78" width="36" height="30" rx="18" fill="url(#furGrad)" />
            <path d="M 84 95 Q 100 103 116 95" fill="none" stroke="#A97044" stroke-width="3" stroke-linecap="round" opacity="0.25" />
          </g>

          <!-- 手臂：从肩部向两侧伸出，像要抱抱（轻摆） -->
          <g class="arm-l">
            <path d="M 58 100 Q 36 104 24 124 Q 16 142 24 152 Q 34 158 42 148 Q 52 128 62 115 Z" fill="url(#furGrad)" />
            <ellipse cx="28" cy="134" rx="3" ry="9" fill="#FFFFFF" opacity="0.3" transform="rotate(30 28 134)" />
          </g>
          <g class="arm-r">
            <path d="M 142 100 Q 164 104 176 124 Q 184 142 176 152 Q 166 158 158 148 Q 148 128 138 115 Z" fill="url(#furGrad)" />
            <ellipse cx="172" cy="134" rx="3" ry="9" fill="#FFFFFF" opacity="0.3" transform="rotate(-30 172 134)" />
          </g>

          <!-- 耳朵（会偶尔抽动） -->
          <g class="ears">
            <circle cx="48" cy="32" r="26" fill="url(#furGrad)" />
            <circle cx="48" cy="32" r="26" fill="url(#furPattern)" />
            <circle cx="48" cy="32" r="15" fill="url(#creamGrad)" />
            <circle cx="152" cy="32" r="26" fill="url(#furGrad)" />
            <circle cx="152" cy="32" r="26" fill="url(#furPattern)" />
            <circle cx="152" cy="32" r="15" fill="url(#creamGrad)" />
          </g>

          <!-- 头（横向椭圆）+ 奶油嘴套 + 腮红 -->
          <ellipse cx="100" cy="64" rx="66" ry="61" fill="url(#furGrad)" />
          <ellipse cx="100" cy="64" rx="66" ry="61" fill="url(#furPattern)" />
          <ellipse class="muzzle" cx="100" cy="84" rx="30" ry="21" fill="url(#creamGrad)" />
          <ellipse class="cheek" cx="58" cy="84" rx="11" ry="7.5" />
          <ellipse class="cheek" cx="142" cy="84" rx="11" ry="7.5" />
        </g>

        <!-- 面部（不套毛绒滤镜，保持清晰） -->
        <g v-if="!isSleeping" class="eyes">
          <circle cx="76" cy="56" r="8.5" />
          <circle class="hl" cx="73.5" cy="53" r="3.2" />
          <circle class="hl" cx="78.5" cy="59" r="1.4" />
          <circle cx="124" cy="56" r="8.5" />
          <circle class="hl" cx="121.5" cy="53" r="3.2" />
          <circle class="hl" cx="126.5" cy="59" r="1.4" />
        </g>
        <g v-else class="eyes-closed">
          <path d="M67 56 Q76 64 85 56" />
          <path d="M115 56 Q124 64 133 56" />
        </g>
        <ellipse class="nose" cx="100" cy="74" rx="7.5" ry="5.5" fill="#2E1A11" />
        <ellipse cx="97.2" cy="72" rx="2.8" ry="1.8" fill="#FFFFFF" opacity="0.6" />
        <ellipse v-if="isEating" class="mouth-open" cx="100" cy="90" rx="8.5" ry="6.5" />
        <path v-else class="mouth" d="M 100 81 Q 91 90 86 85 M 100 81 Q 109 90 114 85 M 100 81 L 100 87" />
        <!-- 睡觉 Zzz -->
        <g v-if="isSleeping" class="zzz">
          <text x="168" y="44">z</text>
          <text x="181" y="30">Z</text>
          <text x="192" y="17">Z</text>
        </g>
      </svg>
      <!-- 棕色小熊（大头简版） -->
      <svg
        v-else-if="store.settings.petSkin === 'bear'"
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
