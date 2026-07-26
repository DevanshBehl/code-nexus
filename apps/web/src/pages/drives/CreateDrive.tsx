import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { driveCreateSchema, type DriveDto, type UniversitiesResponse } from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { driveKeys } from '../../lib/drives.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { TextField, SelectField, FormError } from '../../components/forms/Field.tsx';

interface FormValues {
  universityPublicId: string;
  title: string;
  description: string;
  roleTitle: string;
  location: string;
  ctcAnnual: string;
  minCgpa: string;
  allowedBranches: string;
  allowedGraduationYears: string;
  applyDeadline: string; // datetime-local
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function CreateDrive() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string>();

  const unisQuery = useQuery({
    queryKey: driveKeys.universities,
    queryFn: () => api.get<UniversitiesResponse>('/directory/universities'),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  const submit = handleSubmit(async (v) => {
    setFormError(undefined);
    const payload = {
      universityPublicId: v.universityPublicId,
      title: v.title,
      description: v.description,
      roleTitle: v.roleTitle || undefined,
      location: v.location || undefined,
      ctcAnnual: v.ctcAnnual ? Number(v.ctcAnnual) : undefined,
      minCgpa: v.minCgpa ? Number(v.minCgpa) : undefined,
      allowedBranches: parseList(v.allowedBranches),
      allowedGraduationYears: parseList(v.allowedGraduationYears)
        .map(Number)
        .filter((n) => Number.isInteger(n)),
      applyDeadline: v.applyDeadline ? new Date(v.applyDeadline).toISOString() : '',
    };
    const parsed = driveCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFormError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    try {
      const drive = await api.post<DriveDto>('/drives', parsed.data);
      await qc.invalidateQueries({ queryKey: driveKeys.list });
      navigate(`/app/company/drives/${drive.publicId}`, { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create the drive.');
    }
  });

  return (
    <AppShell title="New drive">
      <QueryState
        isLoading={unisQuery.isLoading}
        isError={unisQuery.isError}
        onRetry={() => unisQuery.refetch()}
      >
        <Panel title="Create a placement drive">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError message={formError} />

            <SelectField
              id="universityPublicId"
              label="Target university"
              defaultValue=""
              error={errors.universityPublicId?.message}
              {...register('universityPublicId', { required: 'Select a university' })}
            >
              <option value="" disabled>
                Select a university…
              </option>
              {unisQuery.data?.universities.map((u) => (
                <option key={u.publicId} value={u.publicId}>
                  {u.name} ({u.code})
                </option>
              ))}
            </SelectField>

            <TextField
              id="title"
              label="Title"
              placeholder="e.g. Backend Engineer Intern"
              error={errors.title?.message}
              {...register('title', { required: 'Title is required' })}
            />

            <label className="block" htmlFor="description">
              <span className="mb-1.5 block text-[13px] font-medium text-fg">Description</span>
              <textarea
                id="description"
                rows={4}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
                {...register('description', { required: true })}
              />
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField id="roleTitle" label="Role (optional)" {...register('roleTitle')} />
              <TextField id="location" label="Location (optional)" {...register('location')} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                id="ctcAnnual"
                label="CTC ₹/year (optional)"
                type="number"
                placeholder="1200000"
                {...register('ctcAnnual')}
              />
              <TextField
                id="minCgpa"
                label="Min CGPA (optional)"
                type="number"
                step="0.01"
                placeholder="7.5"
                {...register('minCgpa')}
              />
            </div>

            <TextField
              id="allowedBranches"
              label="Allowed branches (comma-separated; blank = all)"
              placeholder="CSE, ECE"
              {...register('allowedBranches')}
            />
            <TextField
              id="allowedGraduationYears"
              label="Allowed graduation years (comma-separated; blank = all)"
              placeholder="2026, 2027"
              {...register('allowedGraduationYears')}
            />
            <TextField
              id="applyDeadline"
              label="Apply deadline"
              type="datetime-local"
              error={errors.applyDeadline?.message}
              {...register('applyDeadline', { required: 'Deadline is required' })}
            />

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isSubmitting ? 'Creating…' : 'Create draft'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/app/company/drives')}
                className="text-[13px] font-medium text-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
            <p className="text-[12px] text-muted">
              The drive is created as a <strong>draft</strong>. Publish it from the drive page to
              open applications.
            </p>
          </form>
        </Panel>
      </QueryState>
    </AppShell>
  );
}
