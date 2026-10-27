#!/usr/bin/env node
/**
 * Runs the ClassroomOS verification checks in order, logs each one, and stops
 * at the first failure with that step's exit code.
 *
 *   node scripts/auto-runner.mjs               environment check, typecheck, lint, build
 *   node scripts/auto-runner.mjs --e2e         ...then the Playwright suite
 *                                              (needs `npx supabase start`)
 *   node scripts/auto-runner.mjs --production  environment check fails on anything
 *                                              unsafe for production (see check-env.mjs)
 *
 * Output streams to the terminal and is also appended to
 * logs/auto-runner-<timestamp>.log.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withE2E = process.argv.includes('--e2e');
const production = process.argv.includes('--production');

const STEPS = [
  {
    name: 'Environment check',
    command: 'node',
    args: ['scripts/check-env.mjs', ...(production ? ['--production'] : [])],
  },
  { name: 'Typecheck', command: 'npm', args: ['run', 'typecheck'] },
  { name: 'Lint', command: 'npm', args: ['run', 'lint'] },
  { name: 'Build', command: 'npm', args: ['run', 'build'] },
  ...(withE2E ? [{ name: 'E2E tests', command: 'npm', args: ['run', 'test:e2e'] }] : []),
];

const logDir = path.join(ROOT, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `auto-runner-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const log = fs.createWriteStream(logFile, { flags: 'a' });

function note(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  log.write(`${line}\n`);
}

function run(step) {
  return new Promise((resolve) => {
    // npm is npm.cmd on Windows, which needs a shell to start.
    const child = spawn(step.command, step.args, {
      cwd: ROOT,
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      log.write(chunk);
    });
    child.on('error', (error) => {
      note(`${step.name} could not start: ${error.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  note(`Running ${STEPS.map((step) => step.name).join(' → ')}. Log: ${path.relative(ROOT, logFile)}`);
  const started = Date.now();

  for (const [index, step] of STEPS.entries()) {
    note(`Step ${index + 1}/${STEPS.length}: ${step.name}`);
    const stepStarted = Date.now();
    const code = await run(step);
    const seconds = ((Date.now() - stepStarted) / 1000).toFixed(1);

    if (code !== 0) {
      note(`FAILED: ${step.name} exited with code ${code} after ${seconds}s. Stopping.`);
      log.end();
      process.exitCode = code;
      return;
    }
    note(`Passed: ${step.name} (${seconds}s)`);
  }

  note(`All ${STEPS.length} steps passed in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
  log.end();
}

main();
