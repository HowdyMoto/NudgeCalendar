const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const DIST = path.join(__dirname, 'dist');

// ── Load .env ───────────────────────────────────────────
const envPath = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2];
  });
}
// Prefer process.env over .env file (for CI)
if (process.env.GOOGLE_CLIENT_ID) {
  env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
}
if (!env.GOOGLE_CLIENT_ID) {
  console.error('  ERROR: GOOGLE_CLIENT_ID not found in .env or environment');
  process.exit(1);
}

// ── Clean & create dist ─────────────────────────────────
if (fs.existsSync(DIST)) {
  try {
    fs.rmSync(DIST, { recursive: true, force: true });
  } catch (e) {
    // If locked (e.g. server running), just empty the files instead
    for (const f of fs.readdirSync(DIST)) {
      try { fs.rmSync(path.join(DIST, f), { recursive: true, force: true }); } catch {}
    }
  }
}
fs.mkdirSync(DIST, { recursive: true });

// ── Generate icons ──────────────────────────────────────
function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Rounded rect background
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

  // Day number
  const day = new Date().getDate();
  ctx.fillStyle = '#6e9fff';
  ctx.font = `bold ${size * 0.5}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(day), size / 2, size / 2 + size * 0.03);

  return canvas.toBuffer('image/png');
}

fs.writeFileSync(path.join(DIST, 'icon-192.png'), generateIcon(192));
fs.writeFileSync(path.join(DIST, 'icon-512.png'), generateIcon(512));

// Favicon: 32x32 circle
const fav = createCanvas(32, 32);
const fctx = fav.getContext('2d');
fctx.fillStyle = '#0a0a0f';
fctx.beginPath(); fctx.arc(16, 16, 16, 0, Math.PI * 2); fctx.fill();
fctx.fillStyle = '#6e9fff';
fctx.font = 'bold 18px sans-serif';
fctx.textAlign = 'center'; fctx.textBaseline = 'middle';
fctx.fillText(String(new Date().getDate()), 16, 17);
fs.writeFileSync(path.join(DIST, 'favicon.ico'), fav.toBuffer('image/png'));
console.log('  Icons generated');

// ── Copy app files from src/ ─────────────────────────────
const SRC = path.join(__dirname, 'src');

function copyDir(src, dest) {
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(SRC, DIST);
console.log('  App files copied');

// ── Inject env vars into app.js ─────────────────────────
const appJsPath = path.join(DIST, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf-8');
appJs = appJs.replace('__GOOGLE_CLIENT_ID__', env.GOOGLE_CLIENT_ID);
fs.writeFileSync(appJsPath, appJs);
console.log('  Client ID injected');

// ── Cache-bust asset references in index.html ───────────
const buildHash = Date.now().toString(36);
const indexPath = path.join(DIST, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf-8');
indexHtml = indexHtml.replace('style.css"', `style.css?v=${buildHash}"`);
indexHtml = indexHtml.replace('app.js"', `app.js?v=${buildHash}"`);
indexHtml = indexHtml.replace('sw.js"', `sw.js?v=${buildHash}"`);
fs.writeFileSync(indexPath, indexHtml);
console.log(`  Cache-busted (${buildHash})`);

// ── Summary ─────────────────────────────────────────────
const files = fs.readdirSync(DIST);
console.log(`\n  Build complete → dist/ (${files.length} files)`);
files.forEach(f => console.log(`    ${f}`));
