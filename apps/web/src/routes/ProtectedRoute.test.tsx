import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Me } from '../lib/auth.tsx';
import { ProtectedRoute } from './ProtectedRoute.tsx';

// Mock useAuth to drive the guard logic directly.
const mockAuth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../lib/auth.tsx', () => ({
  useAuth: () => mockAuth.value,
}));

function renderAt(me: Me | null, isLoading = false) {
  mockAuth.value = { me, isLoading, isAuthenticated: !!me, refetch: vi.fn(), logout: vi.fn() };
  return render(
    <MemoryRouter initialEntries={['/app/student']}>
      <Routes>
        <Route
          path="/app/student"
          element={
            <ProtectedRoute role="STUDENT">
              <div>STUDENT HOME</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/complete-profile" element={<div>COMPLETE PROFILE</div>} />
        <Route path="/app/university" element={<div>UNIVERSITY HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const base: Me = {
  publicId: 'p',
  email: 'a@b.c',
  role: 'STUDENT',
  status: 'ACTIVE',
  mustResetPassword: false,
  permissions: [],
};

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    renderAt(null);
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });

  it('redirects a must-reset user to /login', () => {
    renderAt({ ...base, mustResetPassword: true });
    expect(screen.getByText('LOGIN')).toBeInTheDocument();
  });

  it('redirects a PENDING_PROFILE user to /complete-profile', () => {
    renderAt({ ...base, status: 'PENDING_PROFILE' });
    expect(screen.getByText('COMPLETE PROFILE')).toBeInTheDocument();
  });

  it('redirects a wrong-role user to their own home', () => {
    renderAt({ ...base, role: 'UNIVERSITY' });
    expect(screen.getByText('UNIVERSITY HOME')).toBeInTheDocument();
  });

  it('renders the page for the right, active role', () => {
    renderAt(base);
    expect(screen.getByText('STUDENT HOME')).toBeInTheDocument();
  });
});
