import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { WebinarMessageDto } from '@code-nexus/types';
import { CHAT_MAX_LENGTH } from '@code-nexus/types';

/**
 * Live chat panel. Renders messages as plain text (no HTML injection) and calls
 * `onSend` (which the room routes over WSS). Auto-scrolls to the newest message.
 * `disabled` when the room is not connected / has ended.
 */
export function ChatPanel({
  messages,
  onSend,
  disabled,
}: {
  messages: WebinarMessageDto[];
  onSend: (body: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const submit = (): void => {
    const body = draft.trim();
    if (!body) return;
    onSend(body.slice(0, CHAT_MAX_LENGTH));
    setDraft('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">No messages yet — say hello 👋</p>
        ) : (
          messages.map((m) => (
            <div key={m.publicId} className="text-[13px] leading-snug">
              <span className="font-semibold text-fg">{m.senderName}</span>{' '}
              <span className="whitespace-pre-wrap break-words text-muted">{m.body}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form
        className="mt-3 flex items-center gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={disabled}
          maxLength={CHAT_MAX_LENGTH}
          placeholder={disabled ? 'Chat unavailable' : 'Message…'}
          aria-label="Chat message"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-fg px-3 py-2 text-bg hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
