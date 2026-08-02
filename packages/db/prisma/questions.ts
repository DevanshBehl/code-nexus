/**
 * The seeded DSA question bank, and the starter code that comes with it.
 *
 * This judge is stdin/stdout: a submission is a whole program that reads its own
 * input and prints its own answer. That is what makes the leaderboard meaningful
 * across four languages, and it is not going to change — but it must not be what
 * a student spends their first ten minutes on. Nobody learns anything from
 * writing a StreamTokenizer loop for the ninth time.
 *
 * So every question ships starter code, per language, that already parses the
 * exact input format that question describes and hands it to an empty `solve`
 * with the right signature. What is left on screen is the algorithm and nothing
 * else — the same shape of task a candidate gets on LeetCode, without pretending
 * the judge calls their function for them.
 *
 * The scaffolds are generated from the question's INPUT SHAPE rather than written
 * out twelve times. A shape is the contract between the statement and the stub:
 * say a question reads "n, then n integers" and every language gets a reader that
 * does precisely that. When the two disagree, the student's first run fails for a
 * reason that has nothing to do with their solution, which is the exact failure
 * this file exists to prevent.
 */

export type SeedLanguage = 'PYTHON' | 'CPP' | 'JAVA' | 'JAVASCRIPT';

/** How a question's stdin is laid out — and therefore what `solve` receives. */
export type IoShape =
  /** One integer `n`. */
  | 'int'
  /** Two integers `a b` on one line. */
  | 'two_ints'
  /** One line of text `s` (spaces included). */
  | 'line'
  /** `n`, then `n` integers. */
  | 'array'
  /** `n`, then `n` integers, then a `target`. */
  | 'array_target'
  /** `n`, `n` integers, `m`, then `m` integers. */
  | 'two_arrays';

interface SeedTest {
  input: string;
  expectedOutput: string;
  isSample: boolean;
}

export interface SeedQuestion {
  slug: string;
  title: string;
  /** Markdown. Rendered by the web client, so structure survives. */
  description: string;
  constraints?: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topic: 'ARRAY' | 'STRING' | 'MATH' | 'HASHMAP' | 'STACK_QUEUE' | 'DP';
  shape: IoShape;
  /** One line, in the imperative: what `solve` has to do. Goes in every stub. */
  hint: string;
  tests: SeedTest[];
}

// ---- Scaffolds --------------------------------------------------------------

const PY_BODY = '    # Write your code here\n    pass';
const OTHER_BODY = '    // Write your code here';

const PYTHON: Record<IoShape, (hint: string) => string> = {
  int: (h) => `import sys


def solve(n: int) -> None:
    """${h}"""
${PY_BODY}


def main() -> None:
    n = int(sys.stdin.read().split()[0])
    solve(n)


if __name__ == "__main__":
    main()
`,
  two_ints: (h) => `import sys


def solve(a: int, b: int) -> None:
    """${h}"""
${PY_BODY}


def main() -> None:
    a, b = (int(x) for x in sys.stdin.read().split()[:2])
    solve(a, b)


if __name__ == "__main__":
    main()
`,
  line: (h) => `import sys


def solve(s: str) -> None:
    """${h}"""
${PY_BODY}


def main() -> None:
    s = sys.stdin.readline().rstrip("\\n")
    solve(s)


if __name__ == "__main__":
    main()
`,
  array: (h) => `import sys


def solve(nums: list[int]) -> None:
    """${h}"""
${PY_BODY}


def main() -> None:
    data = sys.stdin.read().split()
    n = int(data[0])
    nums = [int(x) for x in data[1 : 1 + n]]
    solve(nums)


if __name__ == "__main__":
    main()
`,
  array_target: (h) => `import sys


def solve(nums: list[int], target: int) -> None:
    """${h}"""
${PY_BODY}


def main() -> None:
    data = sys.stdin.read().split()
    n = int(data[0])
    nums = [int(x) for x in data[1 : 1 + n]]
    target = int(data[1 + n])
    solve(nums, target)


if __name__ == "__main__":
    main()
`,
  two_arrays: (h) => `import sys


def solve(a: list[int], b: list[int]) -> None:
    """${h}"""
${PY_BODY}


def main() -> None:
    data = sys.stdin.read().split()
    n = int(data[0])
    a = [int(x) for x in data[1 : 1 + n]]
    m = int(data[1 + n])
    b = [int(x) for x in data[2 + n : 2 + n + m]]
    solve(a, b)


if __name__ == "__main__":
    main()
`,
};

const CPP_HEAD = `#include <bits/stdc++.h>
using namespace std;
`;
const CPP_MAIN_OPEN = `int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);`;

const CPP: Record<IoShape, (hint: string) => string> = {
  int: (h) => `${CPP_HEAD}
// ${h}
void solve(long long n) {
${OTHER_BODY}
}

${CPP_MAIN_OPEN}
    long long n;
    cin >> n;
    solve(n);
    return 0;
}
`,
  two_ints: (h) => `${CPP_HEAD}
// ${h}
void solve(long long a, long long b) {
${OTHER_BODY}
}

${CPP_MAIN_OPEN}
    long long a, b;
    cin >> a >> b;
    solve(a, b);
    return 0;
}
`,
  line: (h) => `${CPP_HEAD}
// ${h}
void solve(const string& s) {
${OTHER_BODY}
}

${CPP_MAIN_OPEN}
    string s;
    getline(cin, s);
    solve(s);
    return 0;
}
`,
  array: (h) => `${CPP_HEAD}
// ${h}
void solve(const vector<long long>& nums) {
${OTHER_BODY}
}

${CPP_MAIN_OPEN}
    int n;
    cin >> n;
    vector<long long> nums(n);
    for (int i = 0; i < n; ++i) cin >> nums[i];
    solve(nums);
    return 0;
}
`,
  array_target: (h) => `${CPP_HEAD}
// ${h}
void solve(const vector<long long>& nums, long long target) {
${OTHER_BODY}
}

${CPP_MAIN_OPEN}
    int n;
    cin >> n;
    vector<long long> nums(n);
    for (int i = 0; i < n; ++i) cin >> nums[i];
    long long target;
    cin >> target;
    solve(nums, target);
    return 0;
}
`,
  two_arrays: (h) => `${CPP_HEAD}
// ${h}
void solve(const vector<long long>& a, const vector<long long>& b) {
${OTHER_BODY}
}

${CPP_MAIN_OPEN}
    int n;
    cin >> n;
    vector<long long> a(n);
    for (int i = 0; i < n; ++i) cin >> a[i];
    int m;
    cin >> m;
    vector<long long> b(m);
    for (int i = 0; i < m; ++i) cin >> b[i];
    solve(a, b);
    return 0;
}
`,
};

/**
 * Java reads every token up front rather than line by line: the statements above
 * describe input as a stream of numbers, and a scanner that agrees with that is
 * one less thing to get wrong at 2am.
 */
const JAVA_TOKENS = `    private static StringTokenizer tokens() throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line).append(' ');
        return new StringTokenizer(sb.toString());
    }`;

const JAVA: Record<IoShape, (hint: string) => string> = {
  int: (h) => `import java.util.*;
import java.io.*;

public class Main {
    // ${h}
    static void solve(long n) {
${OTHER_BODY}
    }

    public static void main(String[] args) throws IOException {
        StringTokenizer st = tokens();
        solve(Long.parseLong(st.nextToken()));
    }

${JAVA_TOKENS}
}
`,
  two_ints: (h) => `import java.util.*;
import java.io.*;

public class Main {
    // ${h}
    static void solve(long a, long b) {
${OTHER_BODY}
    }

    public static void main(String[] args) throws IOException {
        StringTokenizer st = tokens();
        solve(Long.parseLong(st.nextToken()), Long.parseLong(st.nextToken()));
    }

${JAVA_TOKENS}
}
`,
  line: (h) => `import java.util.*;
import java.io.*;

public class Main {
    // ${h}
    static void solve(String s) {
${OTHER_BODY}
    }

    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String s = br.readLine();
        solve(s == null ? "" : s);
    }
}
`,
  array: (h) => `import java.util.*;
import java.io.*;

public class Main {
    // ${h}
    static void solve(long[] nums) {
${OTHER_BODY}
    }

    public static void main(String[] args) throws IOException {
        StringTokenizer st = tokens();
        int n = Integer.parseInt(st.nextToken());
        long[] nums = new long[n];
        for (int i = 0; i < n; i++) nums[i] = Long.parseLong(st.nextToken());
        solve(nums);
    }

${JAVA_TOKENS}
}
`,
  array_target: (h) => `import java.util.*;
import java.io.*;

public class Main {
    // ${h}
    static void solve(long[] nums, long target) {
${OTHER_BODY}
    }

    public static void main(String[] args) throws IOException {
        StringTokenizer st = tokens();
        int n = Integer.parseInt(st.nextToken());
        long[] nums = new long[n];
        for (int i = 0; i < n; i++) nums[i] = Long.parseLong(st.nextToken());
        solve(nums, Long.parseLong(st.nextToken()));
    }

${JAVA_TOKENS}
}
`,
  two_arrays: (h) => `import java.util.*;
import java.io.*;

public class Main {
    // ${h}
    static void solve(long[] a, long[] b) {
${OTHER_BODY}
    }

    public static void main(String[] args) throws IOException {
        StringTokenizer st = tokens();
        int n = Integer.parseInt(st.nextToken());
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = Long.parseLong(st.nextToken());
        int m = Integer.parseInt(st.nextToken());
        long[] b = new long[m];
        for (int i = 0; i < m; i++) b[i] = Long.parseLong(st.nextToken());
        solve(a, b);
    }

${JAVA_TOKENS}
}
`,
};

const JS_TOKENS = `const data = require('fs').readFileSync(0, 'utf8').split(/\\s+/).filter(Boolean);`;

const JAVASCRIPT: Record<IoShape, (hint: string) => string> = {
  int: (h) => `${JS_TOKENS}

/** ${h} */
function solve(n) {
${OTHER_BODY}
}

solve(Number(data[0]));
`,
  two_ints: (h) => `${JS_TOKENS}

/** ${h} */
function solve(a, b) {
${OTHER_BODY}
}

solve(Number(data[0]), Number(data[1]));
`,
  line: (h) => `const s = require('fs').readFileSync(0, 'utf8').split('\\n')[0].replace(/\\r$/, '');

/** ${h} */
function solve(s) {
${OTHER_BODY}
}

solve(s);
`,
  array: (h) => `${JS_TOKENS}

/** ${h} */
function solve(nums) {
${OTHER_BODY}
}

const n = Number(data[0]);
solve(data.slice(1, 1 + n).map(Number));
`,
  array_target: (h) => `${JS_TOKENS}

/** ${h} */
function solve(nums, target) {
${OTHER_BODY}
}

const n = Number(data[0]);
solve(data.slice(1, 1 + n).map(Number), Number(data[1 + n]));
`,
  two_arrays: (h) => `${JS_TOKENS}

/** ${h} */
function solve(a, b) {
${OTHER_BODY}
}

const n = Number(data[0]);
const m = Number(data[1 + n]);
solve(data.slice(1, 1 + n).map(Number), data.slice(2 + n, 2 + n + m).map(Number));
`,
};

/** The four stubs for a question, ready to store in `Question.starterCode`. */
export function starterCodeFor(q: SeedQuestion): Record<SeedLanguage, string> {
  return {
    PYTHON: PYTHON[q.shape](q.hint),
    CPP: CPP[q.shape](q.hint),
    JAVA: JAVA[q.shape](q.hint),
    JAVASCRIPT: JAVASCRIPT[q.shape](q.hint),
  };
}

// ---- The bank ---------------------------------------------------------------

export const QUESTIONS: SeedQuestion[] = [
  {
    slug: 'double-the-number',
    title: 'Double the Number',
    description: `Given an integer \`n\`, print \`n * 2\`.

**Input**

A single line containing the integer \`n\`.

**Output**

One line: twice \`n\`.`,
    constraints: '-10^9 <= n <= 10^9',
    difficulty: 'EASY',
    topic: 'MATH',
    shape: 'int',
    hint: 'Print n * 2.',
    tests: [
      { input: '2', expectedOutput: '4', isSample: true },
      { input: '10', expectedOutput: '20', isSample: false },
      { input: '-3', expectedOutput: '-6', isSample: false },
      { input: '0', expectedOutput: '0', isSample: false },
    ],
  },
  {
    slug: 'sum-of-two',
    title: 'Sum of Two Numbers',
    description: `Given two integers \`a\` and \`b\`, print their sum.

**Input**

One line with two space-separated integers \`a\` and \`b\`.

**Output**

One line: \`a + b\`.`,
    constraints: '-10^9 <= a, b <= 10^9',
    difficulty: 'EASY',
    topic: 'MATH',
    shape: 'two_ints',
    hint: 'Print a + b.',
    tests: [
      { input: '3 5', expectedOutput: '8', isSample: true },
      { input: '100 250', expectedOutput: '350', isSample: false },
      { input: '-4 4', expectedOutput: '0', isSample: false },
    ],
  },
  {
    slug: 'reverse-string',
    title: 'Reverse a String',
    description: `Given a string \`s\`, print it reversed.

**Input**

A single line containing \`s\`.

**Output**

One line: the characters of \`s\` in reverse order.`,
    constraints: '1 <= s.length <= 10^5\ns contains printable ASCII characters',
    difficulty: 'EASY',
    topic: 'STRING',
    shape: 'line',
    hint: 'Print s reversed.',
    tests: [
      { input: 'hello', expectedOutput: 'olleh', isSample: true },
      { input: 'codenexus', expectedOutput: 'suxenedoc', isSample: false },
      { input: 'a', expectedOutput: 'a', isSample: false },
    ],
  },
  {
    slug: 'count-vowels',
    title: 'Count the Vowels',
    description: `Count how many characters of \`s\` are vowels — \`a\`, \`e\`, \`i\`, \`o\` or \`u\`.

**Input**

A single line containing the lowercase string \`s\`.

**Output**

One line: the number of vowels in \`s\`.`,
    constraints: '1 <= s.length <= 10^5\ns consists of lowercase English letters',
    difficulty: 'EASY',
    topic: 'HASHMAP',
    shape: 'line',
    hint: 'Print how many characters of s are vowels.',
    tests: [
      { input: 'education', expectedOutput: '5', isSample: true },
      { input: 'rhythm', expectedOutput: '0', isSample: false },
      { input: 'aeiou', expectedOutput: '5', isSample: false },
    ],
  },
  {
    slug: 'max-in-array',
    title: 'Maximum in an Array',
    description: `Find the largest value in an array.

**Input**

The first line contains \`n\`. The second line contains \`n\` space-separated
integers.

**Output**

One line: the maximum of those integers.`,
    constraints: '1 <= n <= 10^5\n-10^9 <= nums[i] <= 10^9',
    difficulty: 'EASY',
    topic: 'ARRAY',
    shape: 'array',
    hint: 'Print the largest value in nums.',
    tests: [
      { input: '5\n3 7 2 9 4', expectedOutput: '9', isSample: true },
      { input: '3\n-1 -5 -3', expectedOutput: '-1', isSample: false },
      { input: '1\n42', expectedOutput: '42', isSample: false },
    ],
  },
  {
    slug: 'second-largest',
    title: 'Second Largest Element',
    description: `Find the second largest **distinct** value in an array.

For \`[5, 5, 4, 1]\` the distinct values are \`5\`, \`4\` and \`1\`, so the answer
is \`4\` — repeats of the maximum do not count as the runner-up.

**Input**

The first line contains \`n\`. The second line contains \`n\` space-separated
integers, at least two of which are distinct.

**Output**

One line: the second largest distinct value.`,
    constraints:
      '2 <= n <= 10^5\n-10^9 <= nums[i] <= 10^9\nnums contains at least two distinct values',
    difficulty: 'EASY',
    topic: 'ARRAY',
    shape: 'array',
    hint: 'Print the second largest distinct value in nums.',
    tests: [
      { input: '5\n3 7 2 9 4', expectedOutput: '7', isSample: true },
      { input: '4\n5 5 4 1', expectedOutput: '4', isSample: false },
      { input: '2\n1 2', expectedOutput: '1', isSample: false },
      { input: '6\n-1 -1 -2 -9 -3 -2', expectedOutput: '-2', isSample: false },
    ],
  },
  {
    slug: 'two-sum-indices',
    title: 'Two Sum',
    description: `Given an array \`nums\` and an integer \`target\`, find the two
positions that add up to \`target\`.

Exactly one such pair exists, and you may not use the same element twice. Print
the smaller index first.

**Input**

The first line contains \`n\`. The second line contains \`n\` space-separated
integers. The third line contains \`target\`.

**Output**

One line: the two **0-based** indices, space-separated, smaller first.`,
    constraints:
      '2 <= n <= 10^4\n-10^9 <= nums[i] <= 10^9\n-10^9 <= target <= 10^9\nExactly one valid answer exists',
    difficulty: 'EASY',
    topic: 'HASHMAP',
    shape: 'array_target',
    hint: 'Print the two 0-based indices of the values that sum to target, smaller first.',
    tests: [
      { input: '4\n2 7 11 15\n9', expectedOutput: '0 1', isSample: true },
      { input: '3\n3 2 4\n6', expectedOutput: '1 2', isSample: false },
      { input: '2\n3 3\n6', expectedOutput: '0 1', isSample: false },
      { input: '5\n-3 4 3 90 0\n0', expectedOutput: '0 2', isSample: false },
    ],
  },
  {
    slug: 'binary-search',
    title: 'Binary Search',
    description: `\`nums\` is sorted in ascending order. Find \`target\` in it.

Your solution should run in \`O(log n)\` time — the array is sorted for a reason.

**Input**

The first line contains \`n\`. The second line contains \`n\` space-separated
integers in ascending order. The third line contains \`target\`.

**Output**

One line: the **0-based** index of \`target\`, or \`-1\` if it is not present.`,
    constraints:
      '1 <= n <= 10^5\n-10^9 <= nums[i], target <= 10^9\nnums is sorted in ascending order\nAll values in nums are distinct',
    difficulty: 'EASY',
    topic: 'ARRAY',
    shape: 'array_target',
    hint: 'Print the 0-based index of target in the sorted nums, or -1.',
    tests: [
      { input: '6\n-1 0 3 5 9 12\n9', expectedOutput: '4', isSample: true },
      { input: '6\n-1 0 3 5 9 12\n2', expectedOutput: '-1', isSample: false },
      { input: '1\n5\n5', expectedOutput: '0', isSample: false },
      { input: '1\n5\n-5', expectedOutput: '-1', isSample: false },
    ],
  },
  {
    slug: 'merge-sorted-arrays',
    title: 'Merge Two Sorted Arrays',
    description: `Merge two ascending arrays into one ascending array.

Both inputs are already sorted, so this is a single pass — do not sort the
result from scratch.

**Input**

Line 1: \`n\`. Line 2: \`n\` space-separated integers in ascending order.
Line 3: \`m\`. Line 4: \`m\` space-separated integers in ascending order.
A length of \`0\` is followed by an empty line.

**Output**

One line: all \`n + m\` values in ascending order, space-separated.`,
    constraints: '0 <= n, m <= 10^5\n1 <= n + m\n-10^9 <= values <= 10^9\nBoth arrays are sorted',
    difficulty: 'EASY',
    topic: 'ARRAY',
    shape: 'two_arrays',
    hint: 'Print every value of a and b in ascending order, space-separated on one line.',
    tests: [
      { input: '3\n1 3 5\n3\n2 4 6', expectedOutput: '1 2 3 4 5 6', isSample: true },
      { input: '2\n1 2\n0\n', expectedOutput: '1 2', isSample: false },
      { input: '1\n5\n2\n1 9', expectedOutput: '1 5 9', isSample: false },
      { input: '3\n-5 -5 0\n2\n-6 1', expectedOutput: '-6 -5 -5 0 1', isSample: false },
    ],
  },
  {
    slug: 'climbing-stairs',
    title: 'Climbing Stairs',
    description: `You are climbing a staircase of \`n\` steps. Each move you take
either **one** step or **two**. How many distinct ways can you reach the top?

For \`n = 3\` there are three ways: \`1+1+1\`, \`1+2\`, \`2+1\`.

**Input**

A single line containing \`n\`.

**Output**

One line: the number of distinct ways to climb \`n\` steps.`,
    constraints: '1 <= n <= 45',
    difficulty: 'EASY',
    topic: 'DP',
    shape: 'int',
    hint: 'Print the number of distinct ways to climb n steps taking 1 or 2 at a time.',
    tests: [
      { input: '3', expectedOutput: '3', isSample: true },
      { input: '2', expectedOutput: '2', isSample: false },
      { input: '5', expectedOutput: '8', isSample: false },
      { input: '45', expectedOutput: '1836311903', isSample: false },
    ],
  },
  {
    slug: 'balanced-brackets',
    title: 'Balanced Brackets',
    description: `A bracket string is balanced when every opening bracket is
closed by the same type, in the right order, and nothing is left over.

\`([]{})\` is balanced. \`([)]\` is not — the brackets overlap instead of nesting.

**Input**

A single line containing only the characters \`(\`, \`)\`, \`[\`, \`]\`, \`{\` and \`}\`.

**Output**

One line: \`YES\` if the string is balanced, otherwise \`NO\`.`,
    constraints: '1 <= s.length <= 10^5',
    difficulty: 'MEDIUM',
    topic: 'STACK_QUEUE',
    shape: 'line',
    hint: 'Print YES if the brackets in s are balanced, otherwise NO.',
    tests: [
      { input: '([]{})', expectedOutput: 'YES', isSample: true },
      { input: '([)]', expectedOutput: 'NO', isSample: false },
      { input: '(((', expectedOutput: 'NO', isSample: false },
      { input: '{[()]}', expectedOutput: 'YES', isSample: false },
      { input: ')(', expectedOutput: 'NO', isSample: false },
    ],
  },
  {
    slug: 'longest-unique-substring',
    title: 'Longest Substring Without Repeating Characters',
    description: `Find the length of the longest substring of \`s\` in which no
character appears twice.

In \`pwwkew\` the answer is \`3\` — \`wke\`. Note that \`pwke\` is a *subsequence*,
not a substring, so it does not count.

**Input**

A single line containing \`s\`.

**Output**

One line: the length of the longest substring with all distinct characters.`,
    constraints: '1 <= s.length <= 10^5\ns consists of lowercase English letters',
    difficulty: 'MEDIUM',
    topic: 'STRING',
    shape: 'line',
    hint: 'Print the length of the longest substring of s with no repeated character.',
    tests: [
      { input: 'abcabcbb', expectedOutput: '3', isSample: true },
      { input: 'bbbbb', expectedOutput: '1', isSample: false },
      { input: 'pwwkew', expectedOutput: '3', isSample: false },
      { input: 'abcdef', expectedOutput: '6', isSample: false },
    ],
  },
];
