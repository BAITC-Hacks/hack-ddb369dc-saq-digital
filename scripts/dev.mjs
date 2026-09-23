import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}

for (const entry of ['backend/src/index.js', 'frontend/node_modules/vite/bin/vite.js']) {
  const args = entry.includes('/vite/') ? [entry, '--config', 'frontend/vite.config.ts'] : [entry];
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  children.push(child);
  child.once('error', (error) => {
    console.error(`Cannot start ${entry}: ${error.message}`);
    stop(1);
  });
  child.once('exit', (code, signal) => {
    if (!stopping) stop(code ?? (signal ? 1 : 0));
  });
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
