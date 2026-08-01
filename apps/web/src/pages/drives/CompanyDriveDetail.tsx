import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users, Pencil } from 'lucide-react';
import {
  canCompanyTransition,
  type ApplicantRow,
  type ApplicantsResponse,
  type ApplicationStatus,
  type DriveDto,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { driveKeys, formatCtc, formatDeadline } from '../../lib/drives.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { EmptyState } from '../../components/dashboard/EmptyState.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { DataTable, type Column } from '../../components/dashboard/DataTable.tsx';
import { DriveStatusBadge, ApplicationStatusBadge } from '../../components/drives/DriveBadges.tsx';
import { EditDriveForm } from '../../components/drives/EditDriveForm.tsx';

interface Filters {
  branch: string;
  minCgpa: string;
  graduationYear: string;
  status: '' | ApplicationStatus;
}

function toQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.branch) p.set('branch', f.branch);
  if (f.minCgpa) p.set('minCgpa', f.minCgpa);
  if (f.graduationYear) p.set('graduationYear', f.graduationYear);
  if (f.status) p.set('status', f.status);
  p.set('sort', 'cgpa_desc');
  return p.toString();
}

export function CompanyDriveDetail() {
  const { publicId = '' } = useParams();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>({
    branch: '',
    minCgpa: '',
    graduationYear: '',
    status: '',
  });
  const [actionError, setActionError] = useState<string>();
  const [editing, setEditing] = useState(false);

  const driveQuery = useQuery({
    queryKey: driveKeys.detail(publicId),
    queryFn: () => api.get<DriveDto>(`/drives/${publicId}`),
  });

  const qs = toQuery(filters);
  const applicantsQuery = useQuery({
    queryKey: [...driveKeys.applicants(publicId), qs],
    queryFn: () => api.get<ApplicantsResponse>(`/drives/${publicId}/applicants?${qs}`),
  });

  const lifecycle = useMutation({
    mutationFn: (action: 'publish' | 'close') =>
      api.post<DriveDto>(`/drives/${publicId}/${action}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: driveKeys.detail(publicId) });
      void qc.invalidateQueries({ queryKey: driveKeys.list });
    },
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Action failed'),
  });

  const decide = useMutation({
    mutationFn: (v: { applicationPublicId: string; status: ApplicationStatus }) =>
      api.patch(`/applications/${v.applicationPublicId}`, { status: v.status }),
    onSuccess: () => {
      setActionError(undefined);
      void qc.invalidateQueries({ queryKey: driveKeys.applicants(publicId) });
      void qc.invalidateQueries({ queryKey: driveKeys.detail(publicId) });
    },
    onError: (e) =>
      setActionError(e instanceof ApiError ? e.message : 'Could not update applicant'),
  });

  const drive = driveQuery.data;

  const columns: Column<ApplicantRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => [a.firstName, a.lastName].filter(Boolean).join(' ') || '—',
    },
    { key: 'roll', header: 'Roll no.', render: (a) => a.rollNumber ?? '—' },
    { key: 'branch', header: 'Branch', render: (a) => a.branch ?? '—' },
    { key: 'grad', header: 'Grad yr', render: (a) => a.graduationYear ?? '—' },
    { key: 'cgpa', header: 'CGPA', render: (a) => a.cgpa ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (a) => <ApplicationStatusBadge status={a.status} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (a) => (
        <div className="flex flex-wrap gap-1.5">
          {(['SHORTLISTED', 'OFFERED', 'REJECTED'] as const)
            .filter((s) => canCompanyTransition(a.status, s))
            .map((s) => (
              <button
                key={s}
                type="button"
                disabled={decide.isPending}
                onClick={() =>
                  decide.mutate({ applicationPublicId: a.applicationPublicId, status: s })
                }
                className="rounded-md border border-line-strong px-2 py-1 text-[11px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
              >
                {s === 'SHORTLISTED' ? 'Shortlist' : s === 'OFFERED' ? 'Offer' : 'Reject'}
              </button>
            ))}
        </div>
      ),
    },
  ];

  return (
    <AppShell title="Drive">
      <Link
        to="/app/company/drives"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> All drives
      </Link>

      <QueryState
        isLoading={driveQuery.isLoading}
        isError={driveQuery.isError}
        onRetry={() => driveQuery.refetch()}
      >
        {drive ? (
          <div className="space-y-6">
            <Panel
              title={editing ? `Edit · ${drive.title}` : drive.title}
              action={
                <div className="flex items-center gap-2">
                  <DriveStatusBadge status={drive.status} />
                  {!editing && drive.status !== 'CLOSED' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(undefined);
                        setEditing(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  ) : null}
                  {!editing && drive.status === 'DRAFT' ? (
                    <button
                      type="button"
                      disabled={lifecycle.isPending}
                      onClick={() => lifecycle.mutate('publish')}
                      className="rounded-lg bg-fg px-3 py-1.5 text-[13px] font-medium text-bg hover:opacity-90 disabled:opacity-50"
                    >
                      Publish
                    </button>
                  ) : null}
                  {!editing && drive.status === 'OPEN' ? (
                    <button
                      type="button"
                      disabled={lifecycle.isPending}
                      onClick={() => lifecycle.mutate('close')}
                      className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50"
                    >
                      Close
                    </button>
                  ) : null}
                </div>
              }
            >
              {editing ? (
                <>
                  <p className="mb-4 text-[12px] text-muted">
                    Editing changes eligibility for students who haven&apos;t applied yet; existing
                    applications are unaffected. The target university can&apos;t be changed.
                  </p>
                  <EditDriveForm
                    drive={drive}
                    onCancel={() => setEditing(false)}
                    onSaved={() => {
                      setEditing(false);
                      void qc.invalidateQueries({ queryKey: driveKeys.detail(publicId) });
                      void qc.invalidateQueries({ queryKey: driveKeys.list });
                    }}
                  />
                </>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-[13px] text-muted">{drive.description}</p>
                  <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Detail label="University" value={drive.university.name} />
                    <Detail label="Role" value={drive.roleTitle} />
                    <Detail label="Location" value={drive.location} />
                    <Detail label="CTC" value={formatCtc(drive.ctcAnnual)} />
                    <Detail label="Min CGPA" value={drive.minCgpa} />
                    <Detail
                      label="Branches"
                      value={
                        drive.allowedBranches.length ? drive.allowedBranches.join(', ') : 'All'
                      }
                    />
                    <Detail
                      label="Grad years"
                      value={
                        drive.allowedGraduationYears.length
                          ? drive.allowedGraduationYears.join(', ')
                          : 'All'
                      }
                    />
                    <Detail label="Deadline" value={formatDeadline(drive.applyDeadline)} />
                  </dl>
                </>
              )}
            </Panel>

            <Panel title="Applicants" action={<Filters value={filters} onChange={setFilters} />}>
              {actionError ? (
                <p className="mb-3 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  {actionError}
                </p>
              ) : null}
              <QueryState
                isLoading={applicantsQuery.isLoading}
                isError={applicantsQuery.isError}
                onRetry={() => applicantsQuery.refetch()}
              >
                <DataTable
                  columns={columns}
                  rows={applicantsQuery.data?.applicants ?? []}
                  rowKey={(a) => a.applicationPublicId}
                  empty={
                    <EmptyState
                      icon={Users}
                      title="No applicants"
                      hint={
                        drive.status === 'DRAFT'
                          ? 'Publish this drive so eligible students can apply.'
                          : 'No students match the current filters yet.'
                      }
                    />
                  }
                />
              </QueryState>
            </Panel>
          </div>
        ) : null}
      </QueryState>
    </AppShell>
  );
}

function Filters({ value, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  const input =
    'rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-[12px] text-fg placeholder:text-faint focus:border-accent focus:outline-none';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        aria-label="Filter by branch"
        placeholder="Branch"
        value={value.branch}
        onChange={(e) => onChange({ ...value, branch: e.target.value })}
        className={`w-24 ${input}`}
      />
      <input
        aria-label="Minimum CGPA"
        placeholder="Min CGPA"
        type="number"
        step="0.01"
        value={value.minCgpa}
        onChange={(e) => onChange({ ...value, minCgpa: e.target.value })}
        className={`w-24 ${input}`}
      />
      <input
        aria-label="Graduation year"
        placeholder="Grad yr"
        type="number"
        value={value.graduationYear}
        onChange={(e) => onChange({ ...value, graduationYear: e.target.value })}
        className={`w-24 ${input}`}
      />
      <select
        aria-label="Filter by status"
        value={value.status}
        onChange={(e) => onChange({ ...value, status: e.target.value as Filters['status'] })}
        className={input}
      >
        <option value="">All statuses</option>
        <option value="APPLIED">Applied</option>
        <option value="SHORTLISTED">Shortlisted</option>
        <option value="OFFERED">Offered</option>
        <option value="REJECTED">Rejected</option>
        <option value="WITHDRAWN">Withdrawn</option>
      </select>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="mono-label text-[10px] text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-fg">{value ?? '—'}</dd>
    </div>
  );
}
