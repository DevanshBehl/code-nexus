import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from '../components/Logo.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';

const NAV_LINKS = [
  { href: '#platform', label: 'Platform' },
  { href: '#roles', label: 'Roles' },
  { href: '#how-it-works', label: 'Workflow' },
];

export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/80 backdrop-blur-xl">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6"
      >
        <div className="flex items-center gap-3">
          <a href="#top" aria-label="Code Nexus home">
            <Logo />
          </a>
          <span className="mono-label hidden rounded border border-line px-1.5 py-0.5 text-[10px] text-faint sm:inline">
            v0.1 · Phase 1
          </span>
        </div>

        <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="text-sm text-muted transition-colors hover:text-fg">
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/login"
            className="hidden px-3 py-2 text-sm text-muted transition-colors hover:text-fg sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            to="/login"
            className="hidden h-9 items-center rounded-lg bg-fg px-4 text-sm font-medium text-bg transition-opacity hover:opacity-90 sm:inline-flex"
          >
            Request access
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open ? (
        <div className="border-t border-line bg-bg px-6 py-4 md:hidden">
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-fg"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="mt-2">
              <Link
                to="/login"
                className="block rounded-lg bg-fg px-4 py-2.5 text-center text-sm font-medium text-bg"
              >
                Request access
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </header>
  );
}
