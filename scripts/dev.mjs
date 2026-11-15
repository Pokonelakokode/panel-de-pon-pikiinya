// Zero-dependency dev orchestrator: runs the game server and the Vite dev server together.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 250);
}

function run(name, command, args, color) {
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  children.push(child);
  const tag = '\u001b[' + color + 'm[' + name + ']\u001b[0m ';
  const pipe = (stream) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(tag + line + '\n');
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      process.stdout.write(tag + 'exited with code ' + code + '\n');
      shutdown(code ?? 1);
    }
  });
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// --watch restarts the server whenever the shared simulation changes. Vite hot reloads the
// client, but a stale server would disagree with it about the rules and desync every match.
run('server', process.execPath, ['--watch', 'src/server/main.ts'], '36');
run('vite', process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js')], '35');
