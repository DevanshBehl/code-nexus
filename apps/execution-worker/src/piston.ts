import type { AppConfig } from '@code-nexus/config';
import type { ProgrammingLanguage } from '@code-nexus/types';
import { LANGUAGE_META } from '@code-nexus/types';
import type { Judge0Client, Judge0Item, Judge0Result } from './judge0.js';

/**
 * Piston execution engine (https://github.com/engineer-man/piston). A free,
 * key-less, macOS-friendly alternative to Judge0. It runs code synchronously and
 * returns exit code + signal + compile stage; we map that onto the same
 * `Judge0Result` shape (a synthesized Judge0 status id) so the grading logic in
 * worker.ts is engine-agnostic. Piston has no batch endpoint, so we run one
 * `/execute` per testcase (with a small delay to respect the public rate limit).
 */

const PISTON_LANGUAGE: Record<ProgrammingLanguage, string> = {
  PYTHON: 'python',
  CPP: 'c++',
  JAVA: 'java',
  JAVASCRIPT: 'javascript',
};

interface PistonStage {
  stdout?: string | null;
  stderr?: string | null;
  code?: number | null;
  signal?: string | null;
  output?: string | null;
}
interface PistonResponse {
  compile?: PistonStage;
  run: PistonStage;
}
interface PistonRuntime {
  language: string;
  version: string;
  aliases?: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Map a Piston /execute response onto our Judge0Result contract (pure). */
export function mapPistonResult(resp: PistonResponse): Judge0Result {
  const base = { compileOutput: null as string | null, timeMs: null, memoryKb: null };
  const compile = resp.compile;
  if (compile && (compile.code ?? 0) !== 0) {
    return {
      ...base,
      statusId: 6, // Compilation Error
      stdout: null,
      stderr: compile.stderr ?? null,
      compileOutput: compile.stderr || compile.stdout || compile.output || null,
    };
  }
  const run = resp.run;
  const stdout = run.stdout ?? null;
  const stderr = run.stderr ?? null;
  if (run.signal === 'SIGKILL') {
    return { ...base, statusId: 5, stdout, stderr }; // killed → Time Limit Exceeded
  }
  if ((run.code ?? 0) !== 0 || run.signal) {
    return { ...base, statusId: 11, stdout, stderr }; // NZEC / Runtime Error
  }
  return { ...base, statusId: 3, stdout, stderr }; // ran clean → grade compares output
}

export function createPistonClient(config: AppConfig): Judge0Client {
  const baseUrl = config.PISTON_URL.replace(/\/+$/, '');
  const RETRIES = 3;
  let versions: Partial<Record<ProgrammingLanguage, string>> | null = null;

  async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      try {
        const res = await fetch(url, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        });
        if (!res.ok) throw new Error(`Piston HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        await sleep(400 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Piston request failed');
  }

  async function resolveVersions(): Promise<Partial<Record<ProgrammingLanguage, string>>> {
    if (versions) return versions;
    const runtimes = (await fetchJson(`${baseUrl}/runtimes`)) as PistonRuntime[];
    const map: Partial<Record<ProgrammingLanguage, string>> = {};
    for (const lang of Object.keys(PISTON_LANGUAGE) as ProgrammingLanguage[]) {
      const name = PISTON_LANGUAGE[lang];
      const matches = runtimes.filter(
        (r) => r.language === name || (r.aliases ?? []).includes(name),
      );
      if (matches.length) {
        map[lang] = matches.sort((a, b) => cmpVersion(b.version, a.version))[0]!.version;
      }
    }
    versions = map;
    return map;
  }

  return {
    async runBatch(items: Judge0Item[]): Promise<Judge0Result[]> {
      const resolved = await resolveVersions();
      const results: Judge0Result[] = [];
      for (const it of items) {
        const version = resolved[it.language];
        if (!version) throw new Error(`Piston has no runtime for ${it.language}`);
        const resp = (await fetchJson(`${baseUrl}/execute`, {
          method: 'POST',
          body: JSON.stringify({
            language: PISTON_LANGUAGE[it.language],
            version,
            files: [{ name: LANGUAGE_META[it.language].filename, content: it.sourceCode }],
            stdin: it.stdin,
            run_timeout: Math.round(config.ARENA_WALL_TIME_LIMIT * 1000),
            compile_timeout: 10_000,
          }),
        })) as PistonResponse;
        results.push(mapPistonResult(resp));
        await sleep(250); // stay under the public instance's ~5 req/s limit
      }
      return results;
    },
  };
}
