import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import type {
  ProfileDto,
  StudentProfileDto,
  RecruiterProfileDto,
  OrgProfileDto,
} from '@code-nexus/types';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { AppShell } from '../components/dashboard/AppShell.tsx';
import { Panel } from '../components/dashboard/Panel.tsx';
import { QueryState } from '../components/dashboard/QueryState.tsx';
import { TextField, FormError } from '../components/forms/Field.tsx';

export function Settings() {
  const { me } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<ProfileDto>('/me/profile'),
  });

  return (
    <AppShell title="Settings">
      <QueryState isLoading={isLoading} isError={isError} onRetry={() => refetch()}>
        {data && me ? (
          <div className="mx-auto max-w-2xl space-y-6">
            {me.role === 'STUDENT' ? (
              <StudentSettings profile={data as StudentProfileDto} onSaved={() => refetch()} />
            ) : me.role === 'RECRUITER' ? (
              <RecruiterSettings profile={data as RecruiterProfileDto} onSaved={() => refetch()} />
            ) : (
              <OrgSettings
                role={me.role}
                profile={data as OrgProfileDto}
                onSaved={() => refetch()}
              />
            )}
            <ChangePassword />
          </div>
        ) : null}
      </QueryState>
    </AppShell>
  );
}

function useSaved() {
  const [saved, setSaved] = useState(false);
  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };
  return { saved, flash };
}

function SaveBar({ pending, saved }: { pending: boolean; saved: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-fg px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save changes'}
      </button>
      {saved ? (
        <span className="text-[13px] text-emerald-600 dark:text-emerald-400">Saved</span>
      ) : null}
    </div>
  );
}

function StudentSettings({
  profile,
  onSaved,
}: {
  profile: StudentProfileDto;
  onSaved: () => void;
}) {
  const [err, setErr] = useState<string>();
  const { saved, flash } = useSaved();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: {
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      rollNumber: profile.rollNumber ?? '',
      branch: profile.branch ?? '',
      graduationYear: profile.graduationYear ?? undefined,
      cgpa: profile.cgpa ?? undefined,
      phone: profile.phone ?? '',
    },
  });

  const submit = handleSubmit(async (v) => {
    setErr(undefined);
    try {
      await api.put('/me/profile', v);
      onSaved();
      flash();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save.');
    }
  });

  return (
    <Panel title="Profile">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={err} />
        <div className="grid grid-cols-2 gap-4">
          <TextField id="firstName" label="First name" {...register('firstName')} />
          <TextField id="lastName" label="Last name" {...register('lastName')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField id="rollNumber" label="Roll no." {...register('rollNumber')} />
          <TextField id="branch" label="Branch" {...register('branch')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField
            id="graduationYear"
            label="Graduation year"
            type="number"
            {...register('graduationYear', { valueAsNumber: true })}
          />
          <TextField
            id="cgpa"
            label="CGPA"
            type="number"
            step="0.01"
            {...register('cgpa', { valueAsNumber: true })}
          />
        </div>
        <TextField id="phone" label="Phone" {...register('phone')} />
        <SaveBar pending={formState.isSubmitting} saved={saved} />
      </form>
    </Panel>
  );
}

function RecruiterSettings({
  profile,
  onSaved,
}: {
  profile: RecruiterProfileDto;
  onSaved: () => void;
}) {
  const [err, setErr] = useState<string>();
  const { saved, flash } = useSaved();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: {
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      designation: profile.designation ?? '',
      phone: profile.phone ?? '',
    },
  });
  const submit = handleSubmit(async (v) => {
    setErr(undefined);
    try {
      await api.put('/me/profile', v);
      onSaved();
      flash();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save.');
    }
  });
  return (
    <Panel title="Profile">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={err} />
        <div className="grid grid-cols-2 gap-4">
          <TextField id="firstName" label="First name" {...register('firstName')} />
          <TextField id="lastName" label="Last name" {...register('lastName')} />
        </div>
        <TextField id="designation" label="Designation" {...register('designation')} />
        <TextField id="phone" label="Phone" {...register('phone')} />
        <SaveBar pending={formState.isSubmitting} saved={saved} />
      </form>
    </Panel>
  );
}

function OrgSettings({
  role,
  profile,
  onSaved,
}: {
  role: 'UNIVERSITY' | 'COMPANY' | 'ADMIN';
  profile: OrgProfileDto;
  onSaved: () => void;
}) {
  const [err, setErr] = useState<string>();
  const { saved, flash } = useSaved();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: {
      name: profile.name ?? '',
      code: profile.code ?? '',
      website: profile.website ?? '',
    },
  });
  const submit = handleSubmit(async (v) => {
    setErr(undefined);
    // Only send fields relevant to the role.
    const body: Record<string, unknown> =
      role === 'UNIVERSITY'
        ? { name: v.name, code: v.code, ...(v.website ? { website: v.website } : {}) }
        : role === 'COMPANY'
          ? { name: v.name, ...(v.website ? { website: v.website } : {}) }
          : { firstName: v.name.split(' ')[0], lastName: v.name.split(' ').slice(1).join(' ') };
    try {
      await api.put('/me/org', body);
      onSaved();
      flash();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save.');
    }
  });
  return (
    <Panel title="Organisation details">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={err} />
        <TextField
          id="name"
          label={role === 'ADMIN' ? 'Display name' : 'Name'}
          {...register('name')}
        />
        {role === 'UNIVERSITY' ? <TextField id="code" label="Code" {...register('code')} /> : null}
        {role !== 'ADMIN' ? (
          <TextField
            id="website"
            label="Website (optional)"
            placeholder="https://…"
            {...register('website')}
          />
        ) : null}
        <SaveBar pending={formState.isSubmitting} saved={saved} />
      </form>
    </Panel>
  );
}

function ChangePassword() {
  const [err, setErr] = useState<string>();
  const { saved, flash } = useSaved();
  const { register, handleSubmit, setError, reset, formState } = useForm<{
    currentPassword: string;
    newPassword: string;
    confirm: string;
  }>();
  const submit = handleSubmit(async (v) => {
    setErr(undefined);
    if (v.newPassword !== v.confirm) {
      setError('confirm', { message: 'Passwords do not match' });
      return;
    }
    try {
      await api.post('/auth/password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
      reset();
      flash();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not change password.');
    }
  });
  return (
    <Panel title="Change password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={err} />
        <TextField
          id="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          {...register('currentPassword', { required: true })}
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            id="newPassword"
            label="New password"
            type="password"
            autoComplete="new-password"
            error={formState.errors.newPassword?.message}
            {...register('newPassword', {
              required: 'Required',
              minLength: { value: 12, message: 'At least 12 characters' },
            })}
          />
          <TextField
            id="confirm"
            label="Confirm"
            type="password"
            autoComplete="new-password"
            error={formState.errors.confirm?.message}
            {...register('confirm', { required: 'Required' })}
          />
        </div>
        <p className="text-[12px] text-muted">
          Changing your password logs out your other sessions.
        </p>
        <SaveBar pending={formState.isSubmitting} saved={saved} />
      </form>
    </Panel>
  );
}
