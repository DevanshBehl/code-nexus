import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Settings,
  LogOut,
  Menu,
  Briefcase,
  FileText,
  Mail,
  Code2,
  Trophy,
  Video,
  Film,
  MonitorPlay,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import type { Role, UnreadCountResponse } from '@code-nexus/types';
import { ROLE_HOME } from '@code-nexus/types';
import { Logo } from '../Logo.tsx';
import { ThemeToggle } from '../ThemeToggle.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { api } from '../../lib/api.ts';
import { mailKeys } from '../../lib/mail.ts';

const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  UNIVERSITY: 'University',
  COMPANY: 'Company',
  RECRUITER: 'Recruiter',
  ADMIN: 'Admin',
};

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

// Phase 4 — role-specific navigation into the drives/applications surface.
const ROLE_NAV: Record<Role, NavItem[]> = {
  STUDENT: [
    { label: 'Drives', to: '/app/student/drives', icon: Briefcase },
    { label: 'My applications', to: '/app/student/applications', icon: FileText },
    { label: 'Code Arena', to: '/app/arena', icon: Code2 },
    { label: 'Contests', to: '/app/contests', icon: Trophy },
    { label: 'Webinars', to: '/app/webinars', icon: Video },
    { label: 'Interviews', to: '/app/interviews', icon: MonitorPlay },
    { label: 'Recordings', to: '/app/recordings', icon: Film },
  ],
  COMPANY: [
    { label: 'Drives', to: '/app/company/drives', icon: Briefcase },
    { label: 'Contests', to: '/app/contests', icon: Trophy },
    { label: 'Webinars', to: '/app/webinars', icon: Video },
    { label: 'Interviews', to: '/app/interviews', icon: MonitorPlay },
    { label: 'Recordings', to: '/app/recordings', icon: Film },
  ],
  UNIVERSITY: [
    { label: 'Drives', to: '/app/university/drives', icon: Briefcase },
    { label: 'Contests', to: '/app/contests', icon: Trophy },
    { label: 'Webinars', to: '/app/webinars', icon: Video },
    { label: 'Interviews', to: '/app/interviews', icon: MonitorPlay },
    { label: 'Recordings', to: '/app/recordings', icon: Film },
  ],
  RECRUITER: [
    { label: 'Interviews', to: '/app/interviews', icon: MonitorPlay },
    { label: 'Recordings', to: '/app/recordings', icon: Film },
  ],
  ADMIN: [{ label: 'Recordings', to: '/app/recordings', icon: Film }],
};

const COLLAPSE_KEY = 'cn-sidebar-collapsed';

interface AppShellProps {
  title: string;
  children: ReactNode;
  /** Full-height, no max-width/padding — for IDE-like pages (e.g. the arena). */
  fullBleed?: boolean;
}

export function AppShell({ title, children, fullBleed = false }: AppShellProps) {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const { data: unread } = useQuery({
    queryKey: mailKeys.unread,
    queryFn: () => api.get<UnreadCountResponse>('/mail/unread-count'),
    enabled: !!me,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const unreadCount = unread?.count ?? 0;

  if (!me) return null;

  const nav: NavItem[] = [
    { label: 'Dashboard', to: ROLE_HOME[me.role], icon: LayoutDashboard },
    ...ROLE_NAV[me.role],
    { label: 'Mail', to: '/app/mail', icon: Mail },
    { label: 'Settings', to: '/app/settings', icon: Settings },
  ];

  const initials = me.email.split('@')[0]!.slice(0, 2).toUpperCase() || 'CN';

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // `mini` = icon-only rendering (desktop collapsed). The mobile drawer is always full.
  const SidebarInner = ({ mini }: { mini: boolean }) => (
    <>
      <div className={`flex h-16 items-center ${mini ? 'justify-center px-0' : 'px-5'}`}>
        <Link to={ROLE_HOME[me.role]} aria-label="Home">
          <Logo withWordmark={!mini} />
        </Link>
      </div>
      <nav className={`flex-1 py-2 ${mini ? 'px-2' : 'px-3'}`} aria-label="Sidebar">
        <ul className="space-y-1">
          {nav.map((item) => {
            const active =
              location.pathname === item.to ||
              (item.to === '/app/mail' && location.pathname.startsWith('/app/mail')) ||
              (item.to === '/app/arena' && location.pathname.startsWith('/app/arena')) ||
              (item.to === '/app/contests' && location.pathname.startsWith('/app/contests'));
            const showBadge = item.to === '/app/mail' && unreadCount > 0;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  title={mini ? item.label : undefined}
                  className={`relative flex items-center rounded-lg text-sm transition-colors ${
                    mini ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'
                  } ${
                    active
                      ? 'bg-surface-2 font-medium text-fg'
                      : 'text-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  {!mini ? <span className="flex-1">{item.label}</span> : null}
                  {showBadge ? (
                    mini ? (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />
                    ) : (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className={`border-t border-line ${mini ? 'p-2' : 'p-3'}`}>
        <button
          type="button"
          onClick={onLogout}
          title={mini ? 'Log out' : undefined}
          className={`flex w-full items-center rounded-lg text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg ${
            mini ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2'
          }`}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          {!mini ? 'Log out' : null}
        </button>
      </div>
    </>
  );

  const sidebarWidth = collapsed ? 'lg:w-16' : 'lg:w-60';
  const contentPad = collapsed ? 'lg:pl-16' : 'lg:pl-60';

  return (
    <div className="min-h-screen bg-bg">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex ${sidebarWidth}`}
      >
        <SidebarInner mini={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-surface">
            <SidebarInner mini={false} />
          </aside>
        </div>
      ) : null}

      <div className={`flex min-h-screen flex-col ${contentPad}`}>
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-line bg-bg/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </button>
            <h1 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-2 font-mono text-[11px] font-medium text-muted">
                {initials}
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-[13px] font-medium leading-tight text-fg">{me.email}</p>
                <p className="mono-label text-[9px] text-faint">{ROLE_LABEL[me.role]}</p>
              </div>
            </div>
          </div>
        </header>

        {fullBleed ? (
          <main className="min-h-0 flex-1">{children}</main>
        ) : (
          <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
        )}
      </div>
    </div>
  );
}
