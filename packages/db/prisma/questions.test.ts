import { describe, expect, it } from 'vitest';
import { QUESTIONS, starterCodeFor, type IoShape, type SeedQuestion } from './questions.js';

/**
 * The question bank has one property that matters above every other: the starter
 * code a student is handed must be able to read the testcases that student will
 * be judged on. Those two things are authored a hundred lines apart, so nothing
 * but a test keeps them honest — and when they drift, the failure lands on the
 * student as a wrong answer for code that was never theirs.
 *
 * These run without a database. They check the bank as content.
 */

/**
 * Does this input parse the way the question's scaffold will read it? Mirrors
 * the readers in `questions.ts` deliberately: if one is changed without the
 * other, that is exactly the drift worth failing on.
 */
function parsesUnderShape(shape: IoShape, input: string): boolean {
  const tokens = input.split(/\s+/).filter(Boolean);
  const isInt = (t: string | undefined): boolean => t !== undefined && /^-?\d+$/.test(t);
  switch (shape) {
    case 'int':
      return isInt(tokens[0]);
    case 'two_ints':
      return isInt(tokens[0]) && isInt(tokens[1]);
    case 'line':
      // A line question reads the first line verbatim, so any non-empty first
      // line is well formed — including one with spaces in it.
      return input.split('\n')[0] !== undefined;
    case 'array': {
      if (!isInt(tokens[0])) return false;
      const n = Number(tokens[0]);
      return tokens.length >= 1 + n && tokens.slice(1, 1 + n).every(isInt);
    }
    case 'array_target': {
      if (!isInt(tokens[0])) return false;
      const n = Number(tokens[0]);
      return tokens.length >= n + 2 && tokens.slice(1, n + 2).every(isInt);
    }
    case 'two_arrays': {
      if (!isInt(tokens[0])) return false;
      const n = Number(tokens[0]);
      if (!isInt(tokens[1 + n])) return false;
      const m = Number(tokens[1 + n]);
      return tokens.length >= 2 + n + m && tokens.slice(1, 2 + n + m).every(isInt);
    }
    default:
      return false;
  }
}

const LANGUAGES = ['PYTHON', 'CPP', 'JAVA', 'JAVASCRIPT'] as const;

describe('seeded question bank', () => {
  it('has unique slugs', () => {
    const slugs = QUESTIONS.map((q) => q.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(QUESTIONS.map((q): [string, SeedQuestion] => [q.slug, q]))(
    '%s ships a usable problem',
    (_slug, q) => {
      // A statement nobody can read is not a statement.
      expect(q.title.length).toBeGreaterThan(0);
      expect(q.description.length).toBeGreaterThan(40);
      // At least one visible case: Run is graded against samples alone, so a
      // question with none gives the student nothing to check against.
      expect(q.tests.some((t) => t.isSample)).toBe(true);
      // And something hidden, or Submit is the same button as Run.
      expect(q.tests.some((t) => !t.isSample)).toBe(true);
      expect(q.tests.every((t) => t.expectedOutput.trim().length > 0)).toBe(true);
    },
  );

  it.each(QUESTIONS.map((q): [string, SeedQuestion] => [q.slug, q]))(
    '%s hands every language a stub that calls solve',
    (_slug, q) => {
      const code = starterCodeFor(q);
      for (const lang of LANGUAGES) {
        const src = code[lang];
        expect(src, `${q.slug}/${lang}`).toContain('solve');
        // The stub is a scaffold, not a solution: it reads input, calls solve,
        // and leaves the body to the student.
        expect(src, `${q.slug}/${lang}`).toContain('Write your code here');
        // The hint is what tells them what solve is for — it must survive into
        // the file rather than living only in the seed definition.
        expect(src, `${q.slug}/${lang}`).toContain(q.hint);
      }
      // Java's entry point is fixed by the runner's filename (Main.java).
      expect(code.JAVA).toContain('public class Main');
      // The hint is pasted into a Python docstring, a // comment and a JSDoc
      // block, so anything that could close one of those turns a stub into a
      // syntax error the student did not write.
      expect(q.hint).not.toMatch(/["`]|\*\/|\n/);
    },
  );

  it.each(QUESTIONS.map((q): [string, SeedQuestion] => [q.slug, q]))(
    '%s testcases parse under the shape its starter code reads',
    (_slug, q) => {
      for (const t of q.tests) {
        expect(parsesUnderShape(q.shape, t.input), `${q.slug} <- ${JSON.stringify(t.input)}`).toBe(
          true,
        );
      }
    },
  );
});
