#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);

function run(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const backend = path.join(ROOT, 'backend');
const frontend = path.join(ROOT, 'frontend');

const backendInstallArgs = ['install', '--include=dev'];
if (isVercel) backendInstallArgs.push('--ignore-scripts');

run(backend, 'npm', backendInstallArgs);
if (!isVercel) run(backend, 'npm', ['rebuild', 'better-sqlite3']);
run(backend, 'npm', ['run', 'build']);

run(frontend, 'npm', ['install', '--include=dev']);
run(frontend, 'npm', ['run', 'build']);
