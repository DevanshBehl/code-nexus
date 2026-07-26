import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  webinarCreateSchema,
  type UniversitiesResponse,
  type WebinarDetail,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { webinarKeys } from '../../lib/webinars.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { TextField, SelectField, FormError } from '../../components/forms/Field.tsx';

export function CreateWebinar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me } = useAuth();
  const needsUniversity = me?.role === 'COMPANY' || me?.role === 'ADMIN';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetUniversity, setTargetUniversity] = useState('');
  const [scheduledStartsAt, setScheduledStartsAt] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const unis = useQuery({
    queryKey: ['directory', 'universities'],
    queryFn: () => api.get<UniversitiesResponse>('/directory/universities'),
    enabled: needsUniversity,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const payload = {
      title,
      description,
      targetUniversityPublicId: needsUniversity ? targetUniversity || undefined : undefined,
      scheduledStartsAt: scheduledStartsAt ? new Date(scheduledStartsAt).toISOString() : '',
    };
    const parsed = webinarCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setSaving(true);
    try {
      const w = await api.post<WebinarDetail>('/webinars', parsed.data);
      await qc.invalidateQueries({ queryKey: webinarKeys.list });
      navigate(`/app/webinars/${w.publicId}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the webinar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="New webinar">
      <Panel title="Schedule a webinar">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={error} />
          <TextField
            id="title"
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <label className="block" htmlFor="description">
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Description</span>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
            />
          </label>

          {needsUniversity ? (
            <SelectField
              id="targetUniversity"
              label="Target university"
              value={targetUniversity}
              onChange={(e) => setTargetUniversity(e.target.value)}
            >
              <option value="" disabled>
                Select a university…
              </option>
              {unis.data?.universities.map((u) => (
                <option key={u.publicId} value={u.publicId}>
                  {u.name} ({u.code})
                </option>
              ))}
            </SelectField>
          ) : null}

          <TextField
            id="scheduledStartsAt"
            label="Scheduled start"
            type="datetime-local"
            value={scheduledStartsAt}
            onChange={(e) => setScheduledStartsAt(e.target.value)}
          />

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create draft'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/webinars')}
              className="text-[13px] font-medium text-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
          <p className="text-[12px] text-muted">
            The webinar is created as a <strong>draft</strong>. Publish it, then go live from the
            webinar console when you are ready to stream.
          </p>
        </form>
      </Panel>
    </AppShell>
  );
}
