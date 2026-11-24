import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

console.log('====================================================');
console.log('🚀 ReachInbox Concurrent Runner: API Server + Worker');
console.log('====================================================');

const isProduction = process.env.NODE_ENV === 'production';
const isTsx = !isProduction;

// Resolve binary and entrypoints
const nodeBin = process.execPath;
const cwd = process.cwd();

let apiCmd: string;
let apiArgs: string[];
let workerCmd: string;
let workerArgs: string[];

const tsxCliPath = path.resolve(cwd, 'node_modules/tsx/dist/cli.mjs');

if (isTsx && fs.existsSync(tsxCliPath)) {
  // Directly invoke Node with tsx CLI entrypoint.
  // Setting shell: false eliminates Node DEP0190 deprecation warnings and prevents
  // intermediate cmd.exe wrapper processes that cause orphaned port bindings on Windows.
  apiCmd = nodeBin;
  apiArgs = [tsxCliPath, 'src/server.ts'];
  workerCmd = nodeBin;
  workerArgs = [tsxCliPath, 'src/workers/email.worker.ts'];
} else if (isTsx) {
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  apiCmd = npxCmd;
  apiArgs = ['tsx', 'src/server.ts'];
  workerCmd = npxCmd;
  workerArgs = ['tsx', 'src/workers/email.worker.ts'];
} else {
  apiCmd = nodeBin;
  apiArgs = [path.resolve(cwd, 'dist/server.js')];
  workerCmd = nodeBin;
  workerArgs = [path.resolve(cwd, 'dist/workers/email.worker.js')];
}

const formatLog = (prefix: string, data: Buffer | string) => {
  const lines = data.toString().split(/\r?\n/);
  for (const line of lines) {
    if (line.trim()) {
      console.log(`${prefix} ${line}`);
    }
  }
};

console.log(`[Manager] Spawning API Server (${apiCmd} ${apiArgs.join(' ')})...`);
const apiProcess: ChildProcess = spawn(apiCmd, apiArgs, {
  cwd,
  env: process.env,
  shell: false,
});

apiProcess.stdout?.on('data', (data) => formatLog('\x1b[36m[API]\x1b[0m', data));
apiProcess.stderr?.on('data', (data) => formatLog('\x1b[31m[API:ERR]\x1b[0m', data));

console.log(`[Manager] Spawning Background Email Worker (${workerCmd} ${workerArgs.join(' ')})...`);
const workerProcess: ChildProcess = spawn(workerCmd, workerArgs, {
  cwd,
  env: process.env,
  shell: false,
});

workerProcess.stdout?.on('data', (data) => formatLog('\x1b[32m[Worker]\x1b[0m', data));
workerProcess.stderr?.on('data', (data) => formatLog('\x1b[31m[Worker:ERR]\x1b[0m', data));

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Manager] Received ${signal}. Gracefully stopping API server and Worker...`);

  if (process.platform === 'win32') {
    if (apiProcess.pid) spawn('taskkill', ['/pid', String(apiProcess.pid), '/f', '/t']);
    if (workerProcess.pid) spawn('taskkill', ['/pid', String(workerProcess.pid), '/f', '/t']);
  } else {
    apiProcess.kill('SIGTERM');
    workerProcess.kill('SIGTERM');
  }

  setTimeout(() => {
    console.log('[Manager] Shutdown complete.');
    process.exit(0);
  }, 1000);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

apiProcess.on('exit', (code, signal) => {
  if (!shuttingDown) {
    console.error(`[Manager] API Server exited unexpectedly with code ${code} / signal ${signal}`);
    shutdown('API_CRASH');
  }
});

workerProcess.on('exit', (code, signal) => {
  if (!shuttingDown) {
    console.error(`[Manager] Email Worker exited unexpectedly with code ${code} / signal ${signal}`);
    shutdown('WORKER_CRASH');
  }
});
