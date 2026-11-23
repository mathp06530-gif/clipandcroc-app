// Génère les icônes PNG de l'extension (aucune dépendance).
// Identité : papier crème, étiquette terracotta, trait encre.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Étiquette : pointe à gauche, corps rectangulaire, trou de ficelle.
const TAG = [
  [0.17, 0.5],
  [0.44, 0.22],
  [0.84, 0.22],
  [0.84, 0.78],
  [0.44, 0.78],
];

const PAPER = [246, 241, 231];
const INK = [27, 23, 18];
const TERRA = [209, 80, 42];

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const stroke = Math.max(1.1, size * 0.022);
  const points = TAG.map(([x, y]) => [x * size, y * size]);
  const hole = { x: 0.55 * size, y: 0.5 * size, r: size * 0.045 };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      const insideTile = !(cx < radius && cy < radius) || Math.hypot(radius - cx, radius - cy) <= radius;

      if (!insideTile) {
        rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0;
        continue;
      }

      let color = PAPER;
      if (inPolygon(x + 0.5, y + 0.5, points)) {
        const edge = Math.min(
          distToSegment(x, y, points[0][0], points[0][1], points[1][0], points[1][1]),
          distToSegment(x, y, points[1][0], points[1][1], points[2][0], points[2][1]),
          distToSegment(x, y, points[2][0], points[2][1], points[3][0], points[3][1]),
          distToSegment(x, y, points[3][0], points[3][1], points[4][0], points[4][1]),
          distToSegment(x, y, points[4][0], points[4][1], points[0][0], points[0][1])
        );
        const inHole = Math.hypot(x + 0.5 - hole.x, y + 0.5 - hole.y) <= hole.r;
        if (inHole) color = PAPER;
        else if (edge <= stroke) color = INK;
        else color = TERRA;
      }

      rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2]; rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`icons/icon${size}.png`, render(size));
  console.log(`icons/icon${size}.png`);
}
