import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@code-nexus/config';
import type { ProgrammingLanguage } from '@code-nexus/types';
import type { Judge0Client, Judge0Item, Judge0Result } from './judge0.js';

/**
 * ⚠️ LOCAL execution engine — DEMO / DEV ONLY, macOS. ⚠️
 *
 * Runs submissions ON THIS MACHINE, but under a real macOS sandbox so it is safe
 * for a single-user local demo of your own code:
 *   - `sandbox-exec` (Seatbelt): denies all network + writes to your home dir.
 *   - `ulimit`: caps CPU seconds, file size, and process count (anti fork-bomb).
 *   - a wall-clock timeout that kills the whole process group.
 * This still lives in the WORKER (the API never executes code). It is NOT a
 * production-grade sandbox (kernel namespaces like Judge0/Piston are stronger),
 * so never enable it on a deployed/multi-user server. Select with
 * EXECUTION_ENGINE=local.
 */

interface LangSpec {
  file: string;
  compile?: (dir: string) => { cmd: string; args: string[] };
  run: (dir: string) => { cmd: string; args: string[] };
}

const LOCAL_LANG: Record<ProgrammingLanguage, LangSpec> = {
  PYTHON: {
    file: 'main.py',
    run: (dir) => ({ cmd: 'python3', args: [join(dir, 'main.py')] }),
  },
  JAVASCRIPT: {
    file: 'main.js',
    run: (dir) => ({ cmd: 'node', args: [join(dir, 'main.js')] }),
  },
  CPP: {
    file: 'main.cpp',
    compile: (dir) => ({
      cmd: 'g++',
      args: ['-O2', '-std=c++17', '-o', join(dir, 'prog'), join(dir, 'main.cpp')],
    }),
    run: (dir) => ({ cmd: join(dir, 'prog'), args: [] }),
  },
  JAVA: {
    file: 'Main.java',
    compile: (dir) => ({ cmd: 'javac', args: [join(dir, 'Main.java')] }),
    run: (dir) => ({ cmd: 'java', args: ['-cp', dir, 'Main'] }),
  },
};

/** Synthesize a Judge0 status id from a local run outcome (pure; unit-tested). */
export function localStatusId(p: {
  compileFailed: boolean;
  timedOut: boolean;
  exitCode: number | null;
  signal: string | null;
}): number {
  if (p.compileFailed) return 6; // Compilation Error
  if (p.timedOut) return 5; // wall-clock timeout → Time Limit Exceeded
  // CPU-limit (SIGXCPU) or forced kill (SIGKILL, e.g. output overflow) → TLE.
  if (p.signal === 'SIGXCPU' || p.signal === 'SIGKILL') return 5;
  if (p.signal) return 11; // genuine crash (SIGSEGV/SIGABRT/…) → Runtime Error
  if (p.exitCode !== 0) return 11; // non-zero exit → Runtime Error
  return 3; // clean run → grading compares output
}

const MAX_OUTPUT = 64_000;

interface ProcOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  wallMs: number;
}

/**
 * Build the Seatbelt profile: allow-by-default, then deny network + writes to the
 * user's home, and deny reads of common secret dirs. Permissive enough that the
 * language runtimes work; restrictive enough to protect the machine for a demo.
 */
function sandboxProfile(): string {
  const home = realpathSync(homedir());
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    `(deny file-write* (subpath "${home}"))`,
    `(deny file-read* (subpath "${home}/.ssh"))`,
    `(deny file-read* (subpath "${home}/.aws"))`,
    `(deny file-read* (subpath "${home}/.gnupg"))`,
    `(deny file-read* (subpath "${home}/.config"))`,
  ].join('\n');
}

function runSandboxed(
  cmd: string,
  args: string[],
  opts: { cwd: string; profilePath: string; input?: string; cpuSeconds: number; wallMs: number },
): Promise<ProcOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    // sh applies ulimits, then execs the target under sandbox-exec. We cap CPU
    // seconds + output file size (both per-process). We deliberately DON'T use
    // `ulimit -u` — it's a per-USER process cap that would break compilers that
    // fork (g++ → cc1plus/as/ld); the wall-clock timeout + process-group kill
    // below handle runaway forks instead.
    const ulimit = `ulimit -t ${opts.cpuSeconds} -f 51200 2>/dev/null; exec "$@"`;
    const child = spawn(
      'sandbox-exec',
      ['-f', opts.profilePath, '/bin/sh', '-c', ulimit, 'sh', cmd, ...args],
      { cwd: opts.cwd, detached: true },
    );

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    const killGroup = () => {
      if (killed) return;
      killed = true;
      try {
        process.kill(-child.pid!, 'SIGKILL'); // whole group → reaps forked children
      } catch {
        child.kill('SIGKILL');
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, opts.wallMs);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(0, MAX_OUTPUT);
        killGroup();
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString();
    });

    if (opts.input != null) {
      child.stdin.on('error', () => undefined); // ignore EPIPE if the program never reads stdin
      child.stdin.write(opts.input);
    }
    child.stdin.end();

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: String(err),
        exitCode: null,
        signal: 'SPAWN_ERROR',
        timedOut,
        wallMs: Date.now() - started,
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        signal: signal ?? null,
        timedOut,
        wallMs: Date.now() - started,
      });
    });
  });
}

export function createLocalClient(config: AppConfig): Judge0Client {
  const cpuSeconds = Math.ceil(config.ARENA_CPU_TIME_LIMIT);
  const wallMs = Math.ceil(config.ARENA_WALL_TIME_LIMIT * 1000);
  const profile = sandboxProfile();

  async function runOne(item: Judge0Item): Promise<Judge0Result> {
    const spec = LOCAL_LANG[item.language];
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cn-arena-')));
    try {
      const profilePath = join(dir, 'sandbox.sb');
      writeFileSync(profilePath, profile);
      writeFileSync(join(dir, spec.file), item.sourceCode);

      // Compile step (C++/Java) — sandboxed, with a compile timeout.
      if (spec.compile) {
        const c = spec.compile(dir);
        const compiled = await runSandboxed(c.cmd, c.args, {
          cwd: dir,
          profilePath,
          cpuSeconds: 10,
          wallMs: 15_000,
        });
        if (compiled.exitCode !== 0 || compiled.signal) {
          return {
            statusId: 6,
            stdout: null,
            stderr: compiled.stderr || null,
            compileOutput: compiled.stderr || compiled.stdout || 'Compilation failed',
            timeMs: null,
            memoryKb: null,
          };
        }
      }

      const r = spec.run(dir);
      const out = await runSandboxed(r.cmd, r.args, {
        cwd: dir,
        profilePath,
        input: item.stdin,
        cpuSeconds,
        wallMs,
      });
      const statusId = localStatusId({
        compileFailed: false,
        timedOut: out.timedOut,
        exitCode: out.exitCode,
        signal: out.signal,
      });
      return {
        statusId,
        stdout: out.stdout || null,
        stderr: out.stderr || null,
        compileOutput: null,
        timeMs: out.wallMs,
        memoryKb: null,
      };
    } catch (err) {
      return {
        statusId: 13, // internal error (e.g. toolchain missing)
        stdout: null,
        stderr: err instanceof Error ? err.message : 'local execution failed',
        compileOutput: null,
        timeMs: null,
        memoryKb: null,
      };
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  return {
    async runBatch(items: Judge0Item[]): Promise<Judge0Result[]> {
      // Ensure a stable tmp root exists (some sandboxed runtimes are picky).
      mkdirSync(tmpdir(), { recursive: true });
      const results: Judge0Result[] = [];
      for (const it of items) results.push(await runOne(it));
      return results;
    },
  };
}
