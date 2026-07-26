import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { LogIn, KeyRound } from 'lucide-react';
import { ROLE_HOME } from '@code-nexus/types';
import { api, ApiError } from '../lib/api.ts';
import { useAuth, type Me } from '../lib/auth.tsx';
import { Logo } from '../components/Logo.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import { TextField, FormError } from '../components/forms/Field.tsx';

interface LoginForm {
  emailOrPublicId: string;
  password: string;
}
interface PwForm {
  newPassword: string;
  confirm: string;
}

/**
 * Real login (replaces the Phase-1 placeholder). Handles the forced
 * password-change step and routes the user onward based on /auth/me.
 */
export function Login() {
  const navigate = useNavigate();
  const { refetch } = useAuth();
  const [step, setStep] = useState<'login' | 'password'>('login');
  const [formError, setFormError] = useState<string>();

  const loginForm = useForm<LoginForm>();
  const pwForm = useForm<PwForm>();

  const routeAfter = (me: Me | null) => {
    if (!me) return;
    if (me.mustResetPassword) {
      setStep('password');
      return;
    }
    if (me.status === 'PENDING_PROFILE') {
      navigate('/complete-profile', { replace: true });
      return;
    }
    navigate(ROLE_HOME[me.role], { replace: true });
  };

  const onLogin = loginForm.handleSubmit(async (values) => {
    setFormError(undefined);
    try {
      const me = await api.post<Me>('/auth/login', values);
      await refetch();
      routeAfter(me);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RATE_LIMITED') {
        setFormError('Too many attempts. Please wait and try again.');
      } else {
        setFormError('Invalid credentials. Please try again.');
      }
    }
  });

  const onChangePassword = pwForm.handleSubmit(async (values) => {
    setFormError(undefined);
    if (values.newPassword !== values.confirm) {
      pwForm.setError('confirm', { message: 'Passwords do not match' });
      return;
    }
    try {
      await api.post('/auth/password', { newPassword: values.newPassword });
      const me = await api.get<Me>('/auth/me');
      await refetch();
      if (me.status === 'PENDING_PROFILE') navigate('/complete-profile', { replace: true });
      else navigate(ROLE_HOME[me.role], { replace: true });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not change password. Try again.');
    }
  });

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div aria-hidden="true" className="bg-dots pointer-events-none absolute inset-0" />
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-sm rounded-2xl border border-line-strong bg-surface p-8 shadow-lift">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>

        {step === 'login' ? (
          <>
            <h1 className="text-center text-xl font-semibold tracking-tight text-fg">
              Log in to Code Nexus
            </h1>
            <p className="mt-1.5 text-center text-[13px] text-muted">
              Accounts are provisioned by universities and companies.
            </p>
            <form onSubmit={onLogin} className="mt-6 space-y-4" noValidate>
              <FormError message={formError} />
              <TextField
                id="emailOrPublicId"
                label="Email or ID"
                autoComplete="username"
                {...loginForm.register('emailOrPublicId', { required: true })}
              />
              <TextField
                id="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                {...loginForm.register('password', { required: true })}
              />
              <button
                type="submit"
                disabled={loginForm.formState.isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" />
                {loginForm.formState.isSubmitting ? 'Signing in…' : 'Log in'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-center text-xl font-semibold tracking-tight text-fg">
              Set a new password
            </h1>
            <p className="mt-1.5 text-center text-[13px] text-muted">
              Your account uses a temporary password — choose a new one to continue.
            </p>
            <form onSubmit={onChangePassword} className="mt-6 space-y-4" noValidate>
              <FormError message={formError} />
              <TextField
                id="newPassword"
                label="New password"
                type="password"
                autoComplete="new-password"
                error={pwForm.formState.errors.newPassword?.message}
                {...pwForm.register('newPassword', {
                  required: 'Required',
                  minLength: { value: 12, message: 'At least 12 characters' },
                })}
              />
              <TextField
                id="confirm"
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                error={pwForm.formState.errors.confirm?.message}
                {...pwForm.register('confirm', { required: 'Required' })}
              />
              <button
                type="submit"
                disabled={pwForm.formState.isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <KeyRound className="h-4 w-4" />
                {pwForm.formState.isSubmitting ? 'Saving…' : 'Set password & continue'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
