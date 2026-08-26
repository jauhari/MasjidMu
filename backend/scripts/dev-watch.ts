#!/usr/bin/env node
/**
 * Cross-platform dev wrapper: closes stdin then spawns tsx watch.
 *
 * The `tsx` CLI reads from process.stdin, which blocks on Windows when
 * stdin is inherited from a real terminal (cmd.exe / PowerShell). Closing
 * stdin before spawning tsx prevents the hang while preserving file-watching.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';

// Close stdin so tsx CLI doesn't block on it.
if (process.stdin && !process.stdin.destroyed) {
  process.stdin.destroy();
}

// Resolve tsx CLI entry via its package.json (tsx doesn't export ./dist/cli.mjs)
const tsxPkg = resolve('node_modules/tsx/package.json');
const tsxDir = dirname(tsxPkg);
const tsxCli = resolve(tsxDir, 'dist/cli.mjs');

const child = spawn(
  process.execPath,
  [tsxCli, 'watch', 'src/index.ts', ...process.argv.slice(2)],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

child.on('exit', (code) => process.exit(code ?? 1));
