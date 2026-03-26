const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createStaticServer } = require('./lib/static-server');

const PORT = 8080;
const DIR = path.join(__dirname, 'dist');
const WATCH_EXTS = new Set(['.html', '.css', '.js', '.json']);
const SKIP = new Set(['node_modules', 'dist', '.git', '.claude', '.env']);

// ── Build ───────────────────────────────────────────────
function build() {
  try {
    execSync('node build.js', { stdio: 'pipe', cwd: __dirname });
    console.log(`  [${new Date().toLocaleTimeString()}] Built`);
  } catch (e) {
    console.error('  Build failed:', e.stderr?.toString().trim());
  }
}

// ── Watch ───────────────────────────────────────────────
let debounce = null;
function onChange(eventType, filename) {
  if (!filename) return;
  const ext = path.extname(filename);
  if (!WATCH_EXTS.has(ext)) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log(`  Changed: ${filename}`);
    build();
  }, 200);
}

function watchDir(dir) {
  for (const entry of fs.readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      watchDir(full);
    }
  }
  fs.watch(dir, { recursive: false }, onChange);
}

// ── Start ───────────────────────────────────────────────
build();
watchDir(__dirname);

const server = createStaticServer(DIR);
server.listen(PORT, () => {
  console.log(`\n  Dev server: http://localhost:${PORT}`);
  console.log('  Watching for changes...\n');
});
