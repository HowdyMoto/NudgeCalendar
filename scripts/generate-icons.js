import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
mkdirSync(PUBLIC, { recursive: true });

const DAY = String(new Date().getDate());

function drawDay(ctx, size) {
  ctx.fillStyle = '#6e9fff';
  ctx.font = `bold ${size * 0.65}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(DAY, size / 2, size / 2 + size * 0.03);
}

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const r = size * 0.2;
  ctx.fillStyle = '#0a0a0f';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  drawDay(ctx, size);
  return canvas.toBuffer('image/png');
}

writeFileSync(join(PUBLIC, 'icon-192.png'), generateIcon(192));
writeFileSync(join(PUBLIC, 'icon-512.png'), generateIcon(512));

// Favicon: 32x32 circle
const fav = createCanvas(32, 32);
const fctx = fav.getContext('2d');
fctx.fillStyle = '#0a0a0f';
fctx.beginPath(); fctx.arc(16, 16, 16, 0, Math.PI * 2); fctx.fill();
drawDay(fctx, 32);
writeFileSync(join(PUBLIC, 'favicon.ico'), fav.toBuffer('image/png'));

console.log('  Icons generated');
