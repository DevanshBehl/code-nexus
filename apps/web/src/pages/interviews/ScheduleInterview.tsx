import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  interviewCreateSchema,
  type ApplicantsResponse,
  type DriveListResponse,
  type InterviewDetail,
  type RecruiterListRow,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { interviewKeys } from '../../lib/interviews.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { TextField, SelectField, FormError } from '../../components/forms/Field.tsx';

/**
 * Schedule an interview. The host picks a **university**, then a **shortlisted
 * candidate** from that university (aggregated across the host's drives there) —
 * which auto-links the candidate's application. No raw IDs are typed.
 */
export function ScheduleInterview() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [universityPublicId, setUniversityPublicId] = useState('');
  const [applicationPublicId, setApplicationPublicId] = useState('');
  const [scheduledStartsAt, setScheduledStartsAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('45');
  const [questionSlug, setQuestionSlug] = useState('');
  const [interviewerIds, setInterviewerIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  // The host's drives — each carries its target university.
  const drives = useQuery({
    queryKey: ['drives', 'own'],
    queryFn: () => api.get<DriveListResponse>('/drives'),
  });

  // The company's recruiters — the people who will conduct the interview.
  const recruiters = useQuery({
    queryKey: ['companies', 'recruiters'],
    queryFn: () => api.get<{ recruiters: RecruiterListRow[] }>('/companies/recruiters'),
  });
  const toggleInterviewer = (publicId: string): void =>
    setInterviewerIds((cur) =>
      cur.includes(publicId) ? cur.filter((x) => x !== publicId) : [...cur, publicId],
    );

  // Distinct universities the host has drives with.
  const universities = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of drives.data?.drives ?? []) map.set(d.university.publicId, d.university.name);
    return [...map.entries()].map(([publicId, name]) => ({ publicId, name }));
  }, [drives.data]);

  // Drives targeting the selected university.
  const relevantDrives = useMemo(
    () => (drives.data?.drives ?? []).filter((d) => d.university.publicId === universityPublicId),
    [drives.data, universityPublicId],
  );

  // Shortlisted applicants across those drives (parallel fetch), merged.
  const applicantQueries = useQueries({
    queries: relevantDrives.map((d) => ({
      queryKey: ['drives', d.publicId, 'applicants', 'SHORTLISTED'],
      queryFn: () =>
        api.get<ApplicantsResponse>(`/drives/${d.publicId}/applicants?status=SHORTLISTED`),
      enabled: !!universityPublicId,
    })),
  });

  const candidates = useMemo(() => {
    const rows: { applicationPublicId: string; studentPublicId: string; label: string }[] = [];
    for (const q of applicantQueries) {
      const data = q.data;
      if (!data) continue;
      for (const a of data.applicants) {
        const name = [a.firstName, a.lastName].filter(Boolean).join(' ') || 'Student';
        const meta = [a.rollNumber, data.drive.title].filter(Boolean).join(' · ');
        rows.push({
          applicationPublicId: a.applicationPublicId,
          studentPublicId: a.studentPublicId,
          label: meta ? `${name} — ${meta}` : name,
        });
      }
    }
    return rows;
  }, [applicantQueries]);

  const candidatesLoading = applicantQueries.some((q) => q.isLoading);
  const selected = candidates.find((c) => c.applicationPublicId === applicationPublicId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (!selected) {
      setError('Select a candidate.');
      return;
    }
    const payload = {
      title: title.trim() || undefined,
      candidateStudentPublicId: selected.studentPublicId,
      scheduledStartsAt: scheduledStartsAt ? new Date(scheduledStartsAt).toISOString() : '',
      durationMinutes: Number(durationMinutes),
      applicationPublicId: selected.applicationPublicId,
      questionSlug: questionSlug.trim() || undefined,
      interviewerPublicIds: interviewerIds.length > 0 ? interviewerIds : undefined,
    };
    const parsed = interviewCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setSaving(true);
    try {
      const iv = await api.post<InterviewDetail>('/interviews', parsed.data);
      await qc.invalidateQueries({ queryKey: interviewKeys.list });
      navigate(`/app/interviews/${iv.publicId}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not schedule the interview.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell title="Schedule interview">
      <Panel title="New interview">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError message={error} />
          <TextField
            id="title"
            label="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. SDE-1 technical screen"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              id="university"
              label="University"
              value={universityPublicId}
              onChange={(e) => {
                setUniversityPublicId(e.target.value);
                setApplicationPublicId('');
              }}
            >
              <option value="">Select a university…</option>
              {universities.map((u) => (
                <option key={u.publicId} value={u.publicId}>
                  {u.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              id="candidate"
              label="Shortlisted candidate"
              value={applicationPublicId}
              onChange={(e) => setApplicationPublicId(e.target.value)}
              disabled={!universityPublicId || candidatesLoading}
            >
              <option value="">
                {!universityPublicId
                  ? 'Pick a university first…'
                  : candidatesLoading
                    ? 'Loading candidates…'
                    : candidates.length === 0
                      ? 'No shortlisted candidates'
                      : 'Select a candidate…'}
              </option>
              {candidates.map((c) => (
                <option key={c.applicationPublicId} value={c.applicationPublicId}>
                  {c.label}
                </option>
              ))}
            </SelectField>
          </div>
          {universityPublicId && !candidatesLoading && candidates.length === 0 ? (
            <p className="text-[12px] text-muted">
              Shortlist applicants in a drive at this university first — they’ll appear here.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              id="startsAt"
              label="Starts at"
              type="datetime-local"
              value={scheduledStartsAt}
              onChange={(e) => setScheduledStartsAt(e.target.value)}
            />
            <TextField
              id="duration"
              label="Duration (min)"
              type="number"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
            />
            <TextField
              id="question"
              label="Coding question slug (optional)"
              value={questionSlug}
              onChange={(e) => setQuestionSlug(e.target.value)}
              placeholder="e.g. sum-of-two"
            />
          </div>

          {/* Extra interviewers. The scheduler always joins as one; these are the
              additional recruiters who may conduct the call. */}
          {recruiters.data && recruiters.data.recruiters.length > 0 ? (
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-fg">
                Additional interviewers (optional)
              </legend>
              <div className="flex flex-wrap gap-2">
                {recruiters.data.recruiters.map((r) => {
                  const name =
                    [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || r.email;
                  const checked = interviewerIds.includes(r.publicId);
                  return (
                    <label
                      key={r.publicId}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] ${
                        checked
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-line-strong text-muted hover:bg-surface-2'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => toggleInterviewer(r.publicId)}
                      />
                      {name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || !selected}
              className="inline-flex items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Scheduling…' : 'Schedule'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/interviews')}
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
