import type { AppConfig } from '@code-nexus/config';
import type { ProgrammingLanguage, Verdict } from '@code-nexus/types';

/**
 * Judge0 REST client — the ONLY place the platform talks to the code-execution
 * engine. Works against a self-hosted Judge0 or the RapidAPI-hosted one (set
 * JUDGE0_API_KEY + JUDGE0_API_HOST for RapidAPI). Batch submissions keep the
 * request count low (important on the free tier).
 */

/** Our language → Judge0 CE `language_id`. Single source of truth. */
export const JUDGE0_LANGUAGE_IDS: Record<ProgrammingLanguage, number> = {
  PYTHON: 71, // Python (3.8.1)
  CPP: 54, // C++ (GCC 9.2.0)
  JAVA: 62, // Java (OpenJDK 13.0.1)
  JAVASCRIPT: 63, // JavaScript (Node.js 12.14.0)
};

/**
 * Map a Judge0 status.id to our verdict, for the NON output-comparison cases.
 * Accepted/Wrong-Answer (3/4) are decided by our own whitespace-aware compare so
 * the rule is explicit and testable.
 */
export function verdictFromStatus(statusId: number): Verdict {
  switch (statusId) {
    case 3:
      return 'ACCEPTED';
    case 4:
      return 'WRONG_ANSWER';
    case 5:
      return 'TIME_LIMIT_EXCEEDED';
    case 6:
      return 'COMPILATION_ERROR';
    case 7: // SIGSEGV
    case 8: // SIGXFSZ
    case 9: // SIGFPE
    case 10: // SIGABRT
    case 11: // NZEC
    case 12: // Runtime error (other)
    case 14: // Exec format error
      return 'RUNTIME_ERROR';
    default:
      return 'INTERNAL_ERROR'; // 13 (internal) + anything unknown
  }
}

/** Whitespace-insensitive output comparison: trim trailing ws per line + end. */
export function normalizeOutput(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

export interface Judge0Item {
  language: ProgrammingLanguage;
  sourceCode: string;
  stdin: string;
  expectedOutput: string;
}

export interface Judge0Result {
  statusId: number;
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface Judge0Client {
  /** Run all items and return one result per item, in the same order. */
  runBatch(items: Judge0Item[]): Promise<Judge0Result[]>;
}

interface Judge0RawResult {
  token?: string;
  status?: { id?: number };
  status_id?: number;
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  time?: string | null;
  memory?: number | null;
}

const TERMINAL_MIN_STATUS = 3; // 1=In Queue, 2=Processing, >=3 done
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create the real HTTP-backed Judge0 client. */
export function createJudge0Client(config: AppConfig): Judge0Client {
  const base = (config.JUDGE0_URL ?? '').replace(/\/+$/, '');
  if (!base) throw new Error('JUDGE0_URL is not configured');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.JUDGE0_API_KEY) {
    headers['X-RapidAPI-Key'] = config.JUDGE0_API_KEY;
    if (config.JUDGE0_API_HOST) headers['X-RapidAPI-Host'] = config.JUDGE0_API_HOST;
  }

  const RETRIES = 3;
  async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      try {
        const res = await fetch(url, {
          ...init,
          headers: { ...headers, ...(init?.headers ?? {}) },
        });
        if (!res.ok) throw new Error(`Judge0 HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        await sleep(400 * (attempt + 1));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Judge0 request failed');
  }

  return {
    async runBatch(items: Judge0Item[]): Promise<Judge0Result[]> {
      const submissions = items.map((it) => ({
        language_id: JUDGE0_LANGUAGE_IDS[it.language],
        source_code: it.sourceCode,
        stdin: it.stdin,
        expected_output: it.expectedOutput,
        cpu_time_limit: config.ARENA_CPU_TIME_LIMIT,
        memory_limit: config.ARENA_MEMORY_LIMIT_KB,
        wall_time_limit: config.ARENA_WALL_TIME_LIMIT,
        enable_network: false,
      }));

      const created = (await fetchJson(`${base}/submissions/batch?base64_encoded=false`, {
        method: 'POST',
        body: JSON.stringify({ submissions }),
      })) as { token?: string }[];
      const tokens = created.map((c) => c.token).filter((t): t is string => Boolean(t));
      if (tokens.length !== items.length) throw new Error('Judge0 batch: token count mismatch');

      // Poll until every submission is terminal (or we time out).
      const fields = 'token,status_id,status,stdout,stderr,compile_output,time,memory';
      const deadline = Date.now() + (config.ARENA_WALL_TIME_LIMIT * items.length + 15) * 1000;
      for (;;) {
        const body = (await fetchJson(
          `${base}/submissions/batch?base64_encoded=false&tokens=${tokens.join(',')}&fields=${fields}`,
        )) as { submissions?: Judge0RawResult[] };
        const rows = body.submissions ?? [];
        const statusOf = (r: Judge0RawResult) => r.status?.id ?? r.status_id ?? 0;
        if (rows.length === items.length && rows.every((r) => statusOf(r) >= TERMINAL_MIN_STATUS)) {
          return rows.map((r) => ({
            statusId: statusOf(r),
            stdout: r.stdout ?? null,
            stderr: r.stderr ?? null,
            compileOutput: r.compile_output ?? null,
            timeMs: r.time != null ? Math.round(Number(r.time) * 1000) : null,
            memoryKb: r.memory ?? null,
          }));
        }
        if (Date.now() > deadline) throw new Error('Judge0 batch timed out');
        await sleep(700);
      }
    },
  };
}
