import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Search } from 'lucide-react';
import { composeMailSchema, type MailContact, type MailContactsResponse } from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { mailKeys, roleLabel } from '../../lib/mail.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { TextField, FormError } from '../../components/forms/Field.tsx';

interface ReplyState {
  recipient?: MailContact;
  subject?: string;
}

export function Compose() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { state } = useLocation() as { state: ReplyState | null };

  const [selected, setSelected] = useState<MailContact[]>(
    state?.recipient ? [state.recipient] : [],
  );
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState(state?.subject ?? '');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();

  const contactsQuery = useQuery({
    queryKey: mailKeys.contacts(q),
    queryFn: () => api.get<MailContactsResponse>(`/mail/contacts?q=${encodeURIComponent(q)}`),
  });
  const contacts = contactsQuery.data;

  const selectedIds = new Set(selected.map((c) => c.publicId));
  const available = (contacts?.contacts ?? []).filter((c) => !selectedIds.has(c.publicId));

  const add = (c: MailContact) => setSelected((s) => [...s, c]);
  const remove = (publicId: string) => setSelected((s) => s.filter((c) => c.publicId !== publicId));

  const send = useMutation({
    mutationFn: () =>
      api.post<{ publicId: string }>('/mail', {
        recipientPublicIds: selected.map((c) => c.publicId),
        subject,
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mail', 'sent'] });
      void qc.invalidateQueries({ queryKey: ['mail', 'inbox'] });
      void qc.invalidateQueries({ queryKey: mailKeys.unread });
      navigate('/app/mail/sent', { replace: true });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not send the message.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const parsed = composeMailSchema.safeParse({
      recipientPublicIds: selected.map((c) => c.publicId),
      subject,
      body,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    send.mutate();
  };

  return (
    <AppShell title="Compose">
      <Panel title="New message">
        <form onSubmit={submit} className="space-y-4">
          <FormError message={error} />

          {/* Recipients */}
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-fg">To</span>
            {selected.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selected.map((c) => (
                  <span
                    key={c.publicId}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 text-[12px] text-fg"
                  >
                    {c.displayName}
                    <span className="mono-label text-[8px] text-faint">{roleLabel(c.role)}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${c.displayName}`}
                      onClick={() => remove(c.publicId)}
                      className="text-faint hover:text-fg"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={
                  contacts?.searchRequired ? 'Search people to add…' : 'Filter recipients…'
                }
                aria-label="Search recipients"
                className="w-full rounded-lg border border-line-strong bg-surface py-2 pl-8 pr-3 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
              />
            </div>

            {contacts?.searchRequired && q.trim().length < 2 ? (
              <p className="mt-2 text-[12px] text-muted">Type at least 2 characters to search.</p>
            ) : available.length > 0 ? (
              <ul className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-line">
                {available.map((c) => (
                  <li key={c.publicId}>
                    <button
                      type="button"
                      onClick={() => add(c)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                    >
                      <span className="text-fg">{c.displayName}</span>
                      <span className="mono-label text-[9px] text-faint">{roleLabel(c.role)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-muted">No matching people.</p>
            )}
          </div>

          <TextField
            id="subject"
            label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
          />

          <label className="block" htmlFor="body">
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Message</span>
            <textarea
              id="body"
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={send.isPending || selected.length === 0}
              className="inline-flex items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/mail')}
              className="text-[13px] font-medium text-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </form>
      </Panel>
    </AppShell>
  );
}
