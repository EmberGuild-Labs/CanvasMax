/**
 * Generates the extension's PNG icons with no dependencies.
 *
 * The mark is an artist's palette in pixel art: a nod to "Canvas", and to the
 * unlimited custom themes that are CanvasMax's headline free feature.
 *
 * It is drawn as TWO masters rather than one, because Chrome asks for four
 * sizes that do not share a single clean scale factor:
 *
 *   32x32 master  ->  32 (1x)  and  128 (4x)
 *   16x16 master  ->  16 (1x)  and   48 (3x)
 *
 * Every shipped size is therefore an integer upscale of a master, so no icon
 * is ever resampled and the pixels stay hard-edged. Pixel art has to be
 * redrawn at each master, never resized: detail that reads at 32px turns to
 * mud at 16px, so the small master keeps only the silhouette and the colour
 * story. That is why the palette body below is written out row by row at 16px
 * but rasterised from an ellipse at 32px.
 *
 * Run: node tools/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'icons');

// ------------------------------------------------------------ PNG output ---

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
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

function encodePng(bmp) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(bmp.w, 0);
  ihdr.writeUInt32BE(bmp.h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // Each scanline is prefixed with its filter type (0 = none).
  const raw = Buffer.alloc((bmp.w * 4 + 1) * bmp.h);
  for (let y = 0; y < bmp.h; y += 1) {
    raw[y * (bmp.w * 4 + 1)] = 0;
    bmp.data.copy(raw, y * (bmp.w * 4 + 1) + 1, y * bmp.w * 4, (y + 1) * bmp.w * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- canvas ---

const hex = (h) => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

/** Nudge a colour lighter (positive) or darker (negative). */
function shade(color, amount) {
  return `#${hex(color)
    .map((c) => Math.max(0, Math.min(255, c + amount)).toString(16).padStart(2, '0'))
    .join('')}`;
}

class Bitmap {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
  }

  set(x, y, color) {
    if (!color || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = hex(color);
    const o = (y * this.w + x) * 4;
    this.data[o] = r; this.data[o + 1] = g; this.data[o + 2] = b; this.data[o + 3] = 255;
  }

  rect(x0, y0, x1, y1, color) {
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) this.set(x, y, color);
  }

  disc(cx, cy, r, color) {
    for (let y = 0; y < this.h; y += 1) for (let x = 0; x < this.w; x += 1) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) this.set(x, y, color);
    }
  }

  /** Explicit pixel placement: [[x, y], ...] */
  pix(list, color) {
    for (const [x, y] of list) this.set(x, y, color);
  }
}

/** Nearest-neighbour upscale by an integer factor. */
function scale(src, factor) {
  const dst = new Bitmap(src.w * factor, src.h * factor);
  for (let y = 0; y < src.h; y += 1) for (let x = 0; x < src.w; x += 1) {
    const o = (y * src.w + x) * 4;
    if (!src.data[o + 3]) continue;
    const color = `#${src.data.slice(o, o + 3).toString('hex')}`;
    for (let dy = 0; dy < factor; dy += 1) {
      for (let dx = 0; dx < factor; dx += 1) dst.set(x * factor + dx, y * factor + dy, color);
    }
  }
  return dst;
}

// ----------------------------------------------------------------- shapes --

/** Rounded-square tile mask, the silhouette every modern app icon wants. */
function inTile(x, y, size, r) {
  const nx = Math.min(x, size - 1 - x);
  const ny = Math.min(y, size - 1 - y);
  if (nx >= r || ny >= r) return true;
  return Math.hypot(r - nx - 0.5, r - ny - 0.5) <= r;
}

function tile(bmp, color, r) {
  for (let y = 0; y < bmp.h; y += 1) for (let x = 0; x < bmp.w; x += 1) {
    if (inTile(x, y, bmp.w, r)) bmp.set(x, y, color);
  }
}

const inEllipse = (x, y, cx, cy, rx, ry) => {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (y + 0.5 - cy) / ry;
  return dx * dx + dy * dy <= 1;
};

function ellipse(bmp, cx, cy, rx, ry, colorAt) {
  for (let y = 0; y < bmp.h; y += 1) for (let x = 0; x < bmp.w; x += 1) {
    if (inEllipse(x, y, cx, cy, rx, ry)) bmp.set(x, y, colorAt(x, y));
  }
}

// ------------------------------------------------------------- the palette --

const TILE = '#16202e';
const WOOD_RIM = '#a9743f';
const WOOD_MID = '#c98f52';
const WOOD_LIT = '#e8c99b';
const WOOD_HIGHLIGHT = '#f6e4c4';

/** The five theme accents CanvasMax ships, used as the wells of paint. */
const PAINTS = ['#4f8cff', '#bd93f9', '#2bb3c0', '#ff6b6b', '#a3e635'];

/** 32x32 master: full detail, five wells, shaded rim. */
function paletteLarge() {
  const b = new Bitmap(32, 32);
  tile(b, TILE, 6);

  const CX = 16.5, CY = 17.5, RX = 12.5, RY = 9.5;
  const HX = 11.5, HY = 21, HRX = 3.2, HRY = 2.6;

  // Body, lit from the top left.
  ellipse(b, CX, CY, RX, RY, (x, y) => {
    if (inEllipse(x, y, HX, HY, HRX, HRY)) return null;
    if (!inEllipse(x, y, CX, CY, RX - 1.4, RY - 1.4)) return WOOD_RIM;
    if (!inEllipse(x, y, CX + 1.6, CY + 1.4, RX - 2, RY - 2)) return WOOD_MID;
    return WOOD_LIT;
  });

  // Cut the thumb hole back out to the tile. Its lip is drawn only along the
  // upper left, where the light falls; ringing it the whole way round made the
  // hole read as a lumpy blob rather than as something cut out.
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    if (!inEllipse(x, y, HX, HY, HRX, HRY)) continue;
    b.set(x, y, TILE);
    if (!inEllipse(x, y, HX + 0.7, HY + 0.6, HRX, HRY)) b.set(x, y, '#8f5f31');
  }

  b.pix([[9, 11], [10, 10], [11, 10], [12, 9], [13, 9], [14, 9]], WOOD_HIGHLIGHT);

  const WELLS = [[8, 14], [12, 11], [17, 10], [22, 12], [25, 16]];
  WELLS.forEach(([x, y], i) => {
    const color = PAINTS[i];
    b.disc(x + 0.5, y + 0.5, 2.4, color);
    b.set(x, y - 2, shade(color, 44));
    b.set(x, y + 2, shade(color, -48));
  });

  return b;
}

/**
 * 16x16 master: four wells, no rim shading, and a body written out row by row.
 * An ellipse rasterised at this size comes out visibly lumpy, and at 16px the
 * silhouette is the only thing carrying the icon.
 */
function paletteSmall() {
  const b = new Bitmap(16, 16);
  tile(b, TILE, 3);

  // [y, xStart, xEnd] — a hand-tuned oval, 14 wide by 10 tall.
  const ROWS = [
    [3, 5, 10], [4, 3, 12], [5, 2, 13], [6, 1, 14], [7, 1, 14],
    [8, 1, 14], [9, 1, 14], [10, 2, 13], [11, 3, 12], [12, 5, 10],
  ];
  const body = new Set();
  for (const [y, x0, x1] of ROWS) for (let x = x0; x <= x1; x += 1) body.add(`${x},${y}`);

  // The hole is removed before the rim is traced, so it gets outlined too.
  for (const [x, y] of [[4, 9], [5, 9], [4, 10], [5, 10]]) body.delete(`${x},${y}`);

  for (const key of body) {
    const [x, y] = key.split(',').map(Number);
    const edge = !body.has(`${x - 1},${y}`) || !body.has(`${x + 1},${y}`)
      || !body.has(`${x},${y - 1}`) || !body.has(`${x},${y + 1}`);
    b.set(x, y, edge ? WOOD_RIM : '#e2c091');
  }
  b.pix([[4, 4], [5, 4]], WOOD_HIGHLIGHT);

  // Wells are 2x2 here; anything finer disappears at this scale.
  const WELLS = [[3, 5], [6, 4], [9, 4], [11, 6]];
  WELLS.forEach(([x, y], i) => {
    const color = PAINTS[i];
    b.rect(x, y, x + 1, y + 1, color);
    b.set(x, y, shade(color, 44));
    b.set(x + 1, y + 1, shade(color, -40));
  });

  return b;
}

// ------------------------------------------------------------------ build --

const large = paletteLarge();
const small = paletteSmall();

const ICONS = {
  16: small,
  32: large,
  48: scale(small, 3),
  128: scale(large, 4),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [size, bmp] of Object.entries(ICONS)) {
  if (bmp.w !== Number(size)) throw new Error(`icon${size} came out ${bmp.w}px wide`);
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(bmp));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
