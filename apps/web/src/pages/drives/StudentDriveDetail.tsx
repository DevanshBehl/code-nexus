import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import type { DriveDto } from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { driveKeys, formatCtc, formatDeadline } from '../../lib/drives.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { Panel } from '../../components/dashboard/Panel.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { ApplicationStatusBadge } from '../../components/drives/DriveBadges.tsx';

export function StudentDriveDetail() {
  const { publicId = '' } = useParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string>();

  const {
    data: drive,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: driveKeys.detail(publicId),
    queryFn: () => api.get<DriveDto>(`/drives/${publicId}`),
  });

  const apply = useMutation({
    mutationFn: () => api.post(`/drives/${publicId}/apply`),
    onSuccess: () => {
      setError(undefined);
      void qc.invalidateQueries({ queryKey: driveKeys.detail(publicId) });
      void qc.invalidateQueries({ queryKey: driveKeys.list });
      void qc.invalidateQueries({ queryKey: driveKeys.myApplications });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not apply'),
  });

  const applied = drive?.myApplicationStatus != null && drive.myApplicationStatus !== 'WITHDRAWN';
  const eligible = drive?.eligibility?.eligible ?? false;

  return (
    <AppShell title="Drive">
      <Link
        to="/app/student/drives"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> All drives
      </Link>
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {drive ? (
          <Panel
            title={drive.title}
            action={
              drive.myApplicationStatus ? (
                <ApplicationStatusBadge status={drive.myApplicationStatus} />
              ) : null
            }
          >
            <p className="text-[13px] text-muted">{drive.company.name}</p>
            <p className="mt-3 whitespace-pre-wrap text-[13px] text-fg">{drive.description}</p>

            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Detail label="Role" value={drive.roleTitle} />
              <Detail label="Location" value={drive.location} />
              <Detail label="CTC" value={formatCtc(drive.ctcAnnual)} />
              <Detail label="Deadline" value={formatDeadline(drive.applyDeadline)} />
              <Detail label="Min CGPA" value={drive.minCgpa} />
              <Detail
                label="Branches"
                value={drive.allowedBranches.length ? drive.allowedBranches.join(', ') : 'All'}
              />
              <Detail
                label="Grad years"
                value={
                  drive.allowedGraduationYears.length
                    ? drive.allowedGraduationYears.join(', ')
                    : 'All'
                }
              />
            </dl>

            {/* Eligibility + apply */}
            <div className="mt-6 border-t border-line pt-5">
              {drive.eligibility ? (
                <div className="mb-4 flex items-start gap-2 text-[13px]">
                  {eligible ? (
                    <>
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                      <span className="text-fg">You're eligible for this drive.</span>
                    </>
                  ) : (
                    <div className="flex items-start gap-2">
                      <XCircle className="mt-0.5 h-4 w-4 text-red-500" />
                      <div>
                        <p className="font-medium text-fg">You're not eligible:</p>
                        <ul className="mt-1 list-inside list-disc text-muted">
                          {drive.eligibility.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {error ? (
                <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-500">
                  {error}
                </p>
              ) : null}

              <button
                type="button"
                disabled={apply.isPending || applied || !eligible}
                onClick={() => apply.mutate()}
                className="inline-flex items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {applied ? 'Application submitted' : apply.isPending ? 'Applying…' : 'Apply now'}
              </button>
            </div>
          </Panel>
        ) : null}
      </QueryState>
    </AppShell>
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
