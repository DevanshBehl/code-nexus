import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  contestCreateSchema,
  LANGUAGE_META,
  PROGRAMMING_LANGUAGES,
  type ContestDetail,
  type ProgrammingLanguage,
  type UniversitiesResponse,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { contestKeys } from '../../lib/contests.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { TextField, SelectField, FormError } from '../../components/forms/Field.tsx';

export function CreateContest() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me } = useAuth();
  const needsUniversity = me?.role === 'COMPANY' || me?.role === 'ADMIN';

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetUniversity, setTargetUniversity] = useState('');
  const [languages, setLanguages] = useState<ProgrammingLanguage[]>(['PYTHON']);
  const [startsAt, setStartsAt] = useState('');
  const [entryDeadline, setEntryDeadline] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('90');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const unis = useQuery({
    queryKey: ['directory', 'universities'],
    queryFn: () => api.get<UniversitiesResponse>('/directory/universities'),
    enabled: needsUniversity,
  });

  const toggleLang = (l: ProgrammingLanguage) =>
    setLanguages((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const payload = {
      title,
      description,
      targetUniversityPublicId: needsUniversity ? targetUniversity || undefined : undefined,
      allowedLanguages: languages,
      startsAt: startsAt ? new Date(startsAt).toISOString() : '',
      entryDeadline: entryDeadline ? new Date(entryDeadline).toISOString() : '',
      durationMinutes: Number(durationMinutes),
    };
    const parsed = contestCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setSaving(true);
    try {
      const c = await api.post<ContestDetail>('/contests', parsed.data);
      await qc.invalidateQueries({ queryKey: contestKeys.list });
      navigate(`/app/contests/${c.publicId}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the contest.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="New contest">
      <Panel title="Schedule a contest">
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

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Allowed languages</span>
            <div className="flex flex-wrap gap-2">
              {PROGRAMMING_LANGUAGES.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => toggleLang(l)}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    languages.includes(l)
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line-strong text-muted hover:bg-surface-2'
                  }`}
                >
                  {LANGUAGE_META[l].label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              id="startsAt"
              label="Entry opens"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <TextField
              id="entryDeadline"
              label="Entry deadline"
              type="datetime-local"
              value={entryDeadline}
              onChange={(e) => setEntryDeadline(e.target.value)}
            />
            <TextField
              id="durationMinutes"
              label="Attempt length (min)"
              type="number"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
            />
          </div>
          <p className="text-[12px] text-muted">
            Students may <strong>start</strong> any time between “Entry opens” and “Entry deadline”,
            then get the full attempt length from when they start.
          </p>

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
              onClick={() => navigate('/app/contests')}
              className="text-[13px] font-medium text-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
          <p className="text-[12px] text-muted">
            The contest is created as a <strong>draft</strong>. Add questions and publish it from
            the contest page.
          </p>
        </form>
      </Panel>
    </AppShell>
  );
}
