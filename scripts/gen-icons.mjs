// 生成应用图标（纯 Node 内置模块，无第三方依赖）：
// 输出 src-tauri/icons/{32x32.png, 128x128.png, 128x128@2x.png, icon.png, icon.ico}
// 运行: npm run icons
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 绘制一只小猫脸 ----------
const PALETTE = {
  body: [255, 217, 163, 255],
  earInner: [255, 196, 196, 255],
  dark: [74, 55, 40, 255],
  cheek: [255, 182, 182, 210],
};

const SHAPES = [
  { kind: "circle", cx: 150, cy: 150, r: 78, color: PALETTE.body }, // 左耳
  { kind: "circle", cx: 362, cy: 150, r: 78, color: PALETTE.body }, // 右耳
  { kind: "circle", cx: 150, cy: 152, r: 42, color: PALETTE.earInner },
  { kind: "circle", cx: 362, cy: 152, r: 42, color: PALETTE.earInner },
  { kind: "circle", cx: 256, cy: 300, r: 165, color: PALETTE.body }, // 脸
  { kind: "circle", cx: 196, cy: 285, r: 17, color: PALETTE.dark }, // 左眼
  { kind: "circle", cx: 316, cy: 285, r: 17, color: PALETTE.dark }, // 右眼
  { kind: "circle", cx: 256, cy: 348, r: 20, color: PALETTE.dark }, // 鼻嘴
  { kind: "circle", cx: 158, cy: 330, r: 24, color: PALETTE.cheek }, // 左腮
  { kind: "circle", cx: 354, cy: 330, r: 24, color: PALETTE.cheek }, // 右腮
];

function coverage(px, py, samples = 3) {
  let hit = 0;
  for (let sx = 0; sx < samples; sx++) {
    for (let sy = 0; sy < samples; sy++) {
      const x = px + (sx + 0.5) / samples;
      const y = py + (sy + 0.5) / samples;
      for (const s of SHAPES) {
        const dx = x - s.cx;
        const dy = y - s.cy;
        if (dx * dx + dy * dy <= s.r * s.r) {
          hit++;
          break;
        }
      }
    }
  }
  return hit / (samples * samples);
}

function drawPet(size) {
  const scale = 512 / size;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = coverage(x * scale, y * scale);
      const i = (y * size + x) * 4;
      if (a > 0) {
        // 用最上层命中形状的颜色，按覆盖率做透明度
        let color = [0, 0, 0, 0];
        for (const s of SHAPES) {
          const dx = (x + 0.5) * scale - s.cx;
          const dy = (y + 0.5) * scale - s.cy;
          if (dx * dx + dy * dy <= s.r * s.r) color = s.color;
        }
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = Math.round(color[3] * a);
      }
    }
  }
  return rgba;
}

function resizeNearest(rgba, from, to) {
  const out = Buffer.alloc(to * to * 4);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const sx = Math.min(from - 1, Math.floor((x * from) / to));
      const sy = Math.min(from - 1, Math.floor((y * from) / to));
      rgba.copy(out, (y * to + x) * 4, (sy * from + sx) * 4, (sy * from + sx) * 4 + 4);
    }
  }
  return out;
}

// ---------- 生成 ----------
const icon512 = drawPet(512);
writeFileSync(join(outDir, "icon.png"), encodePng(512, 512, icon512));

const icon256 = resizeNearest(icon512, 512, 256);
writeFileSync(join(outDir, "128x128@2x.png"), encodePng(256, 256, icon256));
writeFileSync(join(outDir, "128x128.png"), encodePng(128, 128, resizeNearest(icon512, 512, 128)));
writeFileSync(join(outDir, "32x32.png"), encodePng(32, 32, resizeNearest(icon512, 512, 32)));

// ICO（内嵌 256x256 PNG，Windows Vista+ 支持）
const png256 = encodePng(256, 256, icon256);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256 -> 0
entry[1] = 0; // height 256 -> 0
entry[2] = 0; // palette
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png256.length, 8);
entry.writeUInt32LE(22, 12); // data offset
writeFileSync(join(outDir, "icon.ico"), Buffer.concat([header, entry, png256]));

console.log(`图标已生成到 ${outDir}`);
