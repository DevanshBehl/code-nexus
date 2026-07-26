import { useNavigate, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  studentProfileSchema,
  recruiterProfileSchema,
  ROLE_HOME,
  type StudentProfileInput,
  type RecruiterProfileInput,
} from '@code-nexus/types';
import { useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Logo } from '../components/Logo.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import { FullPageSpinner } from '../components/dashboard/FullPageSpinner.tsx';
import { TextField, FormError } from '../components/forms/Field.tsx';

/** First-login profile completion for Students and Recruiters. */
export function CompleteProfile() {
  const { me, isLoading, refetch } = useAuth();
  const navigate = useNavigate();

  if (isLoading) return <FullPageSpinner />;
  if (!me) return <Navigate to="/login" replace />;
  if (me.mustResetPassword) return <Navigate to="/login" replace />;
  if (me.status === 'ACTIVE') return <Navigate to={ROLE_HOME[me.role]} replace />;
  if (me.role !== 'STUDENT' && me.role !== 'RECRUITER') {
    return <Navigate to={ROLE_HOME[me.role]} replace />;
  }

  return (
    <main className="relative min-h-screen px-6 py-10">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-line-strong bg-surface p-8 shadow-soft">
          <h1 className="text-xl font-semibold tracking-tight text-fg">Complete your profile</h1>
          <p className="mt-1.5 text-[13px] text-muted">
            Fill in your details to access your dashboard.
          </p>
          <div className="mt-6">
            {me.role === 'STUDENT' ? (
              <StudentForm
                onDone={async () => {
                  await refetch();
                  navigate(ROLE_HOME.STUDENT, { replace: true });
                }}
              />
            ) : (
              <RecruiterForm
                onDone={async () => {
                  await refetch();
                  navigate(ROLE_HOME.RECRUITER, { replace: true });
                }}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function StudentForm({ onDone }: { onDone: () => Promise<void> }) {
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StudentProfileInput>({ resolver: zodResolver(studentProfileSchema) });

  const submit = handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      await api.post('/auth/complete-onboarding', values);
      await onDone();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    }
  });

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={formError} />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="firstName"
          label="First name"
          error={errors.firstName?.message}
          {...register('firstName')}
        />
        <TextField
          id="lastName"
          label="Last name"
          error={errors.lastName?.message}
          {...register('lastName')}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="rollNumber"
          label="Roll / enrollment no."
          error={errors.rollNumber?.message}
          {...register('rollNumber')}
        />
        <TextField
          id="branch"
          label="Branch"
          placeholder="e.g. CSE"
          error={errors.branch?.message}
          {...register('branch')}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="graduationYear"
          label="Graduation year"
          type="number"
          error={errors.graduationYear?.message}
          {...register('graduationYear', { valueAsNumber: true })}
        />
        <TextField
          id="cgpa"
          label="CGPA (0–10)"
          type="number"
          step="0.01"
          error={errors.cgpa?.message}
          {...register('cgpa', { valueAsNumber: true })}
        />
      </div>
      <TextField id="phone" label="Phone" error={errors.phone?.message} {...register('phone')} />
      <SubmitButton pending={isSubmitting} />
    </form>
  );
}

function RecruiterForm({ onDone }: { onDone: () => Promise<void> }) {
  const [formError, setFormError] = useState<string>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecruiterProfileInput>({ resolver: zodResolver(recruiterProfileSchema) });

  const submit = handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      await api.post('/auth/complete-onboarding', values);
      await onDone();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    }
  });

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <FormError message={formError} />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          id="firstName"
          label="First name"
          error={errors.firstName?.message}
          {...register('firstName')}
        />
        <TextField
          id="lastName"
          label="Last name"
          error={errors.lastName?.message}
          {...register('lastName')}
        />
      </div>
      <TextField
        id="designation"
        label="Designation"
        error={errors.designation?.message}
        {...register('designation')}
      />
      <TextField id="phone" label="Phone" error={errors.phone?.message} {...register('phone')} />
      <SubmitButton pending={isSubmitting} />
    </form>
  );
}

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save & continue'}
    </button>
  );
}
