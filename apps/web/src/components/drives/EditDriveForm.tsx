import { useState } from 'react';
import { driveUpdateSchema, type DriveDto } from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { TextField, FormError } from '../forms/Field.tsx';

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ISO → the `YYYY-MM-DDTHH:mm` a datetime-local input expects (in local time). */
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

interface EditDriveFormProps {
  drive: DriveDto;
  onCancel: () => void;
  onSaved: () => void;
}

/**
 * Edit an existing drive's fields (Phase 4). The API allows edits while the drive
 * is DRAFT or OPEN; editing an OPEN drive changes eligibility for students who
 * have not yet applied — existing applications are unaffected. The target
 * university is fixed and cannot be changed here.
 */
export function EditDriveForm({ drive, onCancel, onSaved }: EditDriveFormProps) {
  const [title, setTitle] = useState(drive.title);
  const [description, setDescription] = useState(drive.description);
  const [roleTitle, setRoleTitle] = useState(drive.roleTitle ?? '');
  const [location, setLocation] = useState(drive.location ?? '');
  const [ctcAnnual, setCtcAnnual] = useState(
    drive.ctcAnnual != null ? String(drive.ctcAnnual) : '',
  );
  const [minCgpa, setMinCgpa] = useState(drive.minCgpa != null ? String(drive.minCgpa) : '');
  const [branches, setBranches] = useState(drive.allowedBranches.join(', '));
  const [years, setYears] = useState(drive.allowedGraduationYears.join(', '));
  const [deadline, setDeadline] = useState(toDateTimeLocal(drive.applyDeadline));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const payload = {
      title,
      description,
      roleTitle: roleTitle.trim() || null,
      location: location.trim() || null,
      ctcAnnual: ctcAnnual ? Number(ctcAnnual) : null,
      minCgpa: minCgpa ? Number(minCgpa) : null,
      allowedBranches: parseList(branches),
      allowedGraduationYears: parseList(years)
        .map(Number)
        .filter((n) => Number.isInteger(n)),
      applyDeadline: deadline ? new Date(deadline).toISOString() : undefined,
    };
    const parsed = driveUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/drives/${drive.publicId}`, parsed.data);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
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
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="roleTitle"
          label="Role (optional)"
          value={roleTitle}
          onChange={(e) => setRoleTitle(e.target.value)}
        />
        <TextField
          id="location"
          label="Location (optional)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField
          id="ctcAnnual"
          label="CTC ₹/year (optional)"
          type="number"
          value={ctcAnnual}
          onChange={(e) => setCtcAnnual(e.target.value)}
        />
        <TextField
          id="minCgpa"
          label="Min CGPA (optional)"
          type="number"
          step="0.01"
          value={minCgpa}
          onChange={(e) => setMinCgpa(e.target.value)}
        />
      </div>

      <TextField
        id="allowedBranches"
        label="Allowed branches (comma-separated; blank = all)"
        placeholder="CSE, ECE"
        value={branches}
        onChange={(e) => setBranches(e.target.value)}
      />
      <TextField
        id="allowedGraduationYears"
        label="Allowed graduation years (comma-separated; blank = all)"
        placeholder="2026, 2027"
        value={years}
        onChange={(e) => setYears(e.target.value)}
      />
      <TextField
        id="applyDeadline"
        label="Apply deadline"
        type="datetime-local"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
      />

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[13px] font-medium text-muted hover:text-fg"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
