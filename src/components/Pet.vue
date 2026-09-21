<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onUnmounted } from "vue";

import { activeProps, type PropKind } from "@/logic/props";
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
/** 性能模式：去掉 feTurbulence 毛边滤镜等常驻 GPU 开销较大的效果 */
const perfLite = computed(() => store.settings.performanceMode);

/** 当前动作应挂载的道具集合（声明表见 src/logic/props.ts，仅毛绒小熊渲染） */
const propSet = computed(() => {
  const kinds = activeProps({
    displayAnimation: store.displayAnimation,
    isIdle: isIdle.value,
    idleVariant: store.idleVariant,
    butterfly: store.butterflySide !== null,
  });
  return new Set<PropKind>(kinds);
});

function hasProp(kind: PropKind): boolean {
  return propSet.value.has(kind);
}

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
    :class="{
      'perf-lite': store.settings.performanceMode,
      'fling-left': store.flingDir === 'left',
      'fling-right': store.flingDir === 'right',
    }"
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
        store.walking ? `walk-${store.walkDir}` : '',
        store.edgeHidden && !store.sliding && store.edge
          ? `peek-${store.corner ?? store.edge}`
          : '',
        `skin-${store.settings.petSkin}`,
      ]"
      :style="{
        '--speed': store.settings.animationSpeed,
        '--look-x': store.look.x,
        '--look-y': store.look.y,
      }"
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
          <pattern
            id="furPattern"
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(18)"
          >
            <path
              d="M2 1 Q3.5 4.5 2 8"
              fill="none"
              stroke="#8a5a30"
              stroke-width="0.7"
              opacity="0.28"
            />
            <path
              d="M6.5 0 Q8 3.5 6.5 7"
              fill="none"
              stroke="#f7e3c8"
              stroke-width="0.7"
              opacity="0.35"
            />
            <path
              d="M4.5 4 Q6 6.5 4.5 9"
              fill="none"
              stroke="#a97044"
              stroke-width="0.6"
              opacity="0.22"
            />
          </pattern>
          <!-- 毛绒边缘滤镜：模拟绒毛的毛糙质感 -->
          <filter id="fuzzy" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.06"
              numOctaves="3"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="2.5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        <!-- 底部影子 -->
        <ellipse
          cx="100"
          cy="202"
          rx="66"
          ry="11"
          fill="#000000"
          opacity="0.18"
          filter="url(#blur)"
        />

        <!-- 迪斯科光圈（dance 道具，压在身子后面） -->
        <g v-if="hasProp('lightPool')" class="prop prop-pool">
          <ellipse
            cx="100"
            cy="202"
            rx="86"
            ry="14"
            fill="#7C5CFF"
            opacity="0.32"
          />
          <ellipse
            cx="100"
            cy="202"
            rx="64"
            ry="10"
            fill="#22C1C3"
            opacity="0.38"
          />
        </g>

        <g :filter="perfLite ? undefined : 'url(#fuzzy)'">
          <!-- 腿（纯棕色站立，偶尔交换重心） -->
          <g class="leg-l">
            <rect
              x="58"
              y="146"
              width="34"
              height="60"
              rx="17"
              fill="url(#furGrad)"
            />
          </g>
          <g class="leg-r">
            <rect
              x="108"
              y="146"
              width="34"
              height="60"
              rx="17"
              fill="url(#furGrad)"
            />
          </g>

          <!-- 呼啦圈后半弧：在躯干之前渲染，被肚子挡住形成"围着腰"的遮挡关系 -->
          <path
            v-if="hasProp('hoop')"
            class="prop hoop hoop-back"
            d="M 34 152 A 66 18 0 0 1 166 152"
          />

          <!-- 躯干组：身体 + 肚皮 + 脖子（呼吸起伏） -->
          <g class="torso">
            <ellipse cx="100" cy="136" rx="55" ry="50" fill="url(#furGrad)" />
            <ellipse
              cx="100"
              cy="152"
              rx="30"
              ry="28"
              fill="url(#creamGrad)"
              opacity="0.95"
            />
            <path
              d="M 82 146 Q 100 166 118 146"
              fill="none"
              stroke="#C89468"
              stroke-width="2"
              stroke-dasharray="3 3"
              opacity="0.4"
            />
            <path
              d="M 85 156 Q 100 171 115 156"
              fill="none"
              stroke="#C89468"
              stroke-width="2"
              stroke-dasharray="3 3"
              opacity="0.4"
            />
            <rect
              x="82"
              y="78"
              width="36"
              height="30"
              rx="18"
              fill="url(#furGrad)"
            />
            <path
              d="M 84 95 Q 100 103 116 95"
              fill="none"
              stroke="#A97044"
              stroke-width="3"
              stroke-linecap="round"
              opacity="0.25"
            />
          </g>

          <!-- 手臂：从肩部向两侧伸出，像要抱抱（轻摆） -->
          <g class="arm-l">
            <path
              d="M 58 100 Q 36 104 24 124 Q 16 142 24 152 Q 34 158 42 148 Q 52 128 62 115 Z"
              fill="url(#furGrad)"
            />
            <ellipse
              cx="28"
              cy="134"
              rx="3"
              ry="9"
              fill="#FFFFFF"
              opacity="0.3"
              transform="rotate(30 28 134)"
            />
          </g>
          <g class="arm-r">
            <path
              d="M 142 100 Q 164 104 176 124 Q 184 142 176 152 Q 166 158 158 148 Q 148 128 138 115 Z"
              fill="url(#furGrad)"
            />
            <ellipse
              cx="172"
              cy="134"
              rx="3"
              ry="9"
              fill="#FFFFFF"
              opacity="0.3"
              transform="rotate(-30 172 134)"
            />
            <!-- 球拍（play 道具）：握在右爪里，随手臂一起动 -->
            <g v-if="hasProp('racket')" class="prop prop-racket">
              <line
                x1="172"
                y1="144"
                x2="186"
                y2="127"
                stroke="#B98356"
                stroke-width="4"
                stroke-linecap="round"
              />
              <ellipse
                cx="191"
                cy="118"
                rx="11"
                ry="13"
                transform="rotate(-42 191 118)"
                fill="#F7E3C8"
                fill-opacity="0.35"
                stroke="#5B84C8"
                stroke-width="2.5"
              />
            </g>
          </g>

          <!-- 头部联动组：与下方 .face-tilt 共用同一视线变换（同轴同幅） -->
          <g class="head-tilt">
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
            <ellipse
              class="muzzle"
              cx="100"
              cy="84"
              rx="30"
              ry="21"
              fill="url(#creamGrad)"
            />
            <ellipse class="cheek" cx="58" cy="84" rx="11" ry="7.5" />
            <ellipse class="cheek" cx="142" cy="84" rx="11" ry="7.5" />
          </g>
        </g>

        <!-- 面部（不套毛绒滤镜，保持清晰）；与 .head-tilt 共用视线变换 -->
        <g class="face-tilt">
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
          <ellipse
            class="nose"
            cx="100"
            cy="74"
            rx="7.5"
            ry="5.5"
            fill="#2E1A11"
          />
          <ellipse
            cx="97.2"
            cy="72"
            rx="2.8"
            ry="1.8"
            fill="#FFFFFF"
            opacity="0.6"
          />
          <ellipse
            v-if="isEating"
            class="mouth-open"
            cx="100"
            cy="90"
            rx="8.5"
            ry="6.5"
          />
          <path
            v-else
            class="mouth"
            d="M 100 81 Q 91 90 86 85 M 100 81 Q 109 90 114 85 M 100 81 L 100 87"
          />
        </g>

        <!-- ── 前置道具层（遮挡上排在身体/面部之前）── -->
        <!-- 呼啦圈前半弧（与后半弧同一椭圆，dash 流动模拟转圈） -->
        <path
          v-if="hasProp('hoop')"
          class="prop hoop hoop-front"
          d="M 34 152 A 66 18 0 0 0 166 152"
        />
        <!-- 跳绳（hop 道具）：以手部连线为轴的半椭圆绳圈，
             基线垂在脚下，CSS scaleY 在 -1.6..1 间翻越（端点固定在双手，
             缩放不跑位；负值翻到头顶即"绳过头顶"那一拍） -->
        <g v-if="hasProp('rope')" class="prop prop-rope">
          <path
            d="M 26 128 C 26 172 62 208 100 208 C 138 208 174 172 174 128"
          />
        </g>
        <!-- 足球（kick 道具）：停在右脚前，被踢飞再弹回 -->
        <g v-if="hasProp('ball')" class="prop prop-ball">
          <circle
            cx="160"
            cy="194"
            r="10"
            fill="#FFFFFF"
            stroke="#2E1A11"
            stroke-width="1.5"
          />
          <path
            d="M 160 188.5 L 164.8 192 L 163 197.3 L 157 197.3 L 155.2 192 Z"
            fill="#2E1A11"
          />
        </g>
        <!-- 音符（dance 道具）：三只错拍飘出 -->
        <g v-if="hasProp('notes')" class="prop prop-notes">
          <text class="note n1" x="152" y="34">♪</text>
          <text class="note n2" x="40" y="44">♫</text>
          <text class="note n3" x="166" y="56">♪</text>
        </g>
        <!-- 舒展波浪线（stretch 道具） -->
        <g v-if="hasProp('stretchLines')" class="prop prop-stretch">
          <path class="tw t1" d="M 118 16 Q 126 9 134 16 Q 142 23 150 16" />
          <path class="tw t2" d="M 48 26 Q 55 20 62 26" />
        </g>
        <!-- 水珠（shake 道具）：--dx/--dy 决定飞溅方向 -->
        <g v-if="hasProp('drops')" class="prop prop-drops">
          <circle
            class="drop"
            style="--dx: -18px; --dy: -10px"
            cx="52"
            cy="42"
            r="2.8"
          />
          <circle
            class="drop"
            style="--dx: -14px; --dy: 6px"
            cx="44"
            cy="70"
            r="2.4"
          />
          <circle
            class="drop"
            style="--dx: -6px; --dy: -16px"
            cx="78"
            cy="16"
            r="2.6"
          />
          <circle
            class="drop"
            style="--dx: 8px; --dy: -16px"
            cx="122"
            cy="16"
            r="2.6"
          />
          <circle
            class="drop"
            style="--dx: 18px; --dy: -10px"
            cx="148"
            cy="42"
            r="2.8"
          />
          <circle
            class="drop"
            style="--dx: 14px; --dy: 6px"
            cx="156"
            cy="70"
            r="2.4"
          />
        </g>
        <!-- 问号（look 道具） -->
        <text v-if="hasProp('question')" class="prop prop-q" x="162" y="36">
          ?
        </text>
        <!-- 拍拍小星星（pat 道具）：随两爪交替拍打的节奏在肚皮两侧弹出 -->
        <g v-if="hasProp('sparkles')" class="prop prop-sparkles">
          <text class="spark s1" x="66" y="150">✦</text>
          <text class="spark s2" x="128" y="150">✦</text>
          <text class="spark s3" x="98" y="172">✦</text>
        </g>
        <!-- 摆动弧线（wiggle 道具）：腰侧随扭动节拍左右交替闪现 -->
        <g v-if="hasProp('swingArcs')" class="prop prop-swing">
          <path class="arc arc-l" d="M 26 126 Q 18 134 26 142" />
          <path class="arc arc-l2" d="M 16 122 Q 6 134 16 146" />
          <path class="arc arc-r" d="M 174 126 Q 182 134 174 142" />
          <path class="arc arc-r2" d="M 184 122 Q 194 134 184 146" />
        </g>
        <!-- 蜂蜜罐（eat 道具）：双臂随 arm-hold 关键帧收拢捧罐，爪尖搭在罐沿；
             罐口有蜜汁挂滴、周期坠落（捧持姿态见 pet.css .anim-eat .arm-*） -->
        <g v-if="hasProp('jar')" class="prop prop-jar">
          <path
            d="M 82 138 Q 78 158 84 168 Q 100 175 116 168 Q 122 158 118 138 Z"
            fill="#E9A83B"
            stroke="#B97F22"
            stroke-width="1.5"
          />
          <path
            d="M 88 142 Q 86 154 89 162"
            fill="none"
            stroke="#FFFFFF"
            stroke-width="2.5"
            stroke-linecap="round"
            opacity="0.35"
          />
          <ellipse
            cx="100"
            cy="153"
            rx="13"
            ry="7.5"
            fill="#FCE5D3"
            opacity="0.92"
          />
          <text
            x="100"
            y="156.5"
            text-anchor="middle"
            font-size="8.5"
            font-weight="bold"
            fill="#B97F22"
          >
            蜜
          </text>
          <path
            d="M 80 138 L 82 133 Q 100 127 118 133 L 120 138 Q 100 132.5 80 138 Z"
            fill="#C0392B"
            stroke="#96281B"
            stroke-width="1"
          />
          <path
            class="honey-drip"
            d="M 108 139 Q 111.5 142 110 145.5 Q 107.5 147.5 106 145 Q 105 141.5 108 139 Z"
            fill="#F0B44B"
          />
          <circle class="honey-drop" cx="108" cy="147" r="1.7" fill="#F0B44B" />
          <!-- 搭在罐沿的爪尖：收拢后的手臂尖正好停在罐两侧，这里补一层"扣住"的手指 -->
          <circle cx="80.5" cy="151" r="6.2" fill="url(#furGrad)" />
          <ellipse
            cx="82.5"
            cy="152.5"
            rx="3"
            ry="2.4"
            fill="#FCE5D3"
            opacity="0.8"
          />
          <circle cx="119.5" cy="151" r="6.2" fill="url(#furGrad)" />
          <ellipse
            cx="117.5"
            cy="152.5"
            rx="3"
            ry="2.4"
            fill="#FCE5D3"
            opacity="0.8"
          />
        </g>
        <!-- 羽毛球（play 道具）：朝视线方向（store.playDir）来回对拉 -->
        <g
          v-if="hasProp('shuttle')"
          class="prop shuttle-anchor"
          :class="store.playDir === 'left' ? 'shuttle-mirror' : ''"
        >
          <g class="prop-shuttle">
            <path
              d="M 0 0 L -6 13 Q 0 9.5 6 13 Z"
              fill="#F5F0E6"
              stroke="#C8B79A"
              stroke-width="1"
            />
            <circle
              cx="0"
              cy="-2.5"
              r="4.5"
              fill="#FFFFFF"
              stroke="#B98356"
              stroke-width="1.2"
            />
          </g>
        </g>
        <!-- 蝴蝶（随机小剧本）：从一侧画翅飞过 -->
        <g
          v-if="hasProp('butterfly')"
          class="prop butterfly"
          :class="`bf-${store.butterflySide ?? 'right'}`"
        >
          <g class="bf-body-g">
            <ellipse
              class="wing wing-l"
              cx="-6"
              cy="0"
              rx="6.5"
              ry="8.5"
              fill="#8FB8FF"
            />
            <ellipse
              class="wing wing-r"
              cx="6"
              cy="0"
              rx="6.5"
              ry="8.5"
              fill="#FFB8D2"
            />
            <rect x="-1" y="-5.5" width="2" height="11" rx="1" fill="#3A2A1A" />
          </g>
        </g>
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
        <ellipse
          v-if="isEating"
          class="mouth-open"
          cx="100"
          cy="145"
          rx="11"
          ry="8"
        />
        <path
          v-else
          class="mouth"
          d="M91 143 Q96 149 101 143 Q106 149 111 143"
        />
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
      <svg
        v-else
        class="pet-svg"
        viewBox="0 0 200 200"
        xmlns="http://www.w3.org/2000/svg"
      >
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
        <ellipse
          v-if="isEating"
          class="mouth-open"
          cx="100"
          cy="136"
          rx="11"
          ry="8"
        />
        <path
          v-else
          class="mouth"
          d="M91 132 Q96 138 101 132 Q106 138 111 132"
        />
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
