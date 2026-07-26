import { Logo } from '../components/Logo.tsx';

const COLUMNS: { title: string; links: string[] }[] = [
  { title: 'Platform', links: ['Placement Drives', 'Code Arena', 'Contests', 'Webinars'] },
  { title: 'Rooms', links: ['Live Interviews', 'Recordings', 'Leaderboards'] },
  { title: 'Roles', links: ['Students', 'Universities', 'Companies', 'Recruiters'] },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-bg-subtle px-6 pb-10 pt-16">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-10 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <Logo />
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-muted">
            The complete campus placement platform — drives, practice, contests, interviews, and
            recordings.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h3 className="mono-label text-[10px] text-faint">{col.title}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((link) => (
                <li key={link}>
                  <a
                    href="#platform"
                    className="text-[13px] text-muted transition-colors hover:text-fg"
                  >
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mx-auto mt-16 flex w-full max-w-6xl flex-col items-center justify-between gap-3 border-t border-line pt-6 sm:flex-row">
        <p className="mono-label text-[10px] text-faint">© {year} Code Nexus</p>
        <p className="mono-label text-[10px] text-faint">Local dev build · Phase 1 — foundation</p>
      </div>
    </footer>
  );
}
