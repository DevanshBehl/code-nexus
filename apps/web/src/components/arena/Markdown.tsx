import type { ReactNode } from 'react';

/**
 * A small markdown renderer for problem statements.
 *
 * Problem text is authored as markdown (the `Question.description` column says
 * so), and a statement rendered as one flat pre-wrapped blob is the difference
 * between "read the problem" and "decode the problem". This covers what a DSA
 * statement actually uses — paragraphs, headings, bullet and numbered lists,
 * bold, italics, inline code, and fenced code blocks — and nothing else.
 *
 * It builds React nodes directly and never touches `dangerouslySetInnerHTML`, so
 * a problem statement cannot inject markup into the page no matter who wrote it.
 * Anything it does not understand renders as the literal text the author typed,
 * which is the right failure: a stray asterisk is a blemish, a swallowed
 * constraint is a wrong answer.
 */
export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return <div className={`cn-prose ${className}`}>{renderBlocks(children)}</div>;
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block — everything inside is literal, including markdown.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence (or the end of the source — both end the block)
      out.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed text-fg"
        >
          {body.join('\n')}
        </pre>,
      );
      continue;
    }

    // Heading.
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      out.push(
        <p
          key={key++}
          className={`mb-1.5 mt-4 font-semibold text-fg ${depth <= 2 ? 'text-[14.5px]' : 'text-[13.5px]'}`}
        >
          {renderInline(heading[2]!)}
        </p>,
      );
      i += 1;
      continue;
    }

    // List — bullets and numbers are the same shape with a different marker.
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      out.push(
        <ListTag
          key={key++}
          className={`my-2.5 space-y-1 pl-5 text-[13.5px] leading-[1.7] text-fg/90 ${
            ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {items.map((item, n) => (
            <li key={n} className="marker:text-faint">
              {renderInline(item)}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // Blank lines separate blocks and carry no meaning of their own.
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Paragraph — runs until a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^```/.test(lines[i]!) &&
      !/^#{1,4}\s/.test(lines[i]!) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i += 1;
    }
    out.push(
      <p key={key++} className="my-2.5 text-[13.5px] leading-[1.75] text-fg/90">
        {renderInline(para.join(' '))}
      </p>,
    );
  }

  return out;
}

/**
 * Inline spans. Order matters: code is taken first and kept verbatim, so
 * `**` inside a code span stays two asterisks rather than turning bold.
 */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('`')) {
      out.push(
        <code
          key={key++}
          className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-fg"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(
        <strong key={key++} className="font-semibold text-fg">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
