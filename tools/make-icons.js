/**
 * Generates the extension's PNG icons with no dependencies.
 *
 * The mark is a rounded square in the CanvasMax accent gradient with a white
 * chevron, drawn into a raw RGBA buffer and encoded as a PNG by hand (zlib is
 * in Node's standard library, so nothing needs installing).
 *
 * Run: node tools/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(__dirname, '..', 'icons');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance from a point to a rounded rectangle, for antialiasing. */
function roundedRectDistance(x, y, halfW, halfH, radius) {
  const qx = Math.abs(x) - (halfW - radius);
  const qy = Math.abs(y) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Distance from a point to a line segment. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

const mix = (a, b, t) => a + (b - a) * t;

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const ss = 3; // supersampling factor per axis

  // Gradient endpoints (the same blues the options page uses).
  const from = [79, 140, 255];
  const to = [16, 84, 190];

  const half = size / 2;
  const radius = size * 0.24;
  const stroke = size * 0.11;

  // A check-mark: down-stroke then up-stroke, in units of the icon size.
  const p0 = [-0.24, 0.02];
  const p1 = [-0.06, 0.20];
  const p2 = [0.26, -0.20];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;

      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const px = x + (sx + 0.5) / ss - half;
          const py = y + (sy + 0.5) / ss - half;

          const inSquare = roundedRectDistance(px, py, half, half, radius) <= 0;
          if (!inSquare) continue;

          // Diagonal gradient across the tile.
          const t = Math.min(1, Math.max(0, (px + py) / (size) + 0.5));
          let cr = mix(from[0], to[0], t);
          let cg = mix(from[1], to[1], t);
          let cb = mix(from[2], to[2], t);

          const markDistance = Math.min(
            segmentDistance(px, py, p0[0] * size, p0[1] * size, p1[0] * size, p1[1] * size),
            segmentDistance(px, py, p1[0] * size, p1[1] * size, p2[0] * size, p2[1] * size)
          );
          if (markDistance <= stroke / 2) { cr = 255; cg = 255; cb = 255; }

          r += cr; g += cg; b += cb; a += 255;
        }
      }

      const samples = ss * ss;
      const offset = (y * size + x) * 4;
      if (a > 0) {
        // Average over covered samples only, then use coverage as alpha.
        const covered = a / 255;
        rgba[offset] = Math.round(r / covered);
        rgba[offset + 1] = Math.round(g / covered);
        rgba[offset + 2] = Math.round(b / covered);
        rgba[offset + 3] = Math.round((covered / samples) * 255);
      }
    }
  }

  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
