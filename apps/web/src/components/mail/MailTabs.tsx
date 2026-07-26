import { Link } from 'react-router-dom';

const TABS = [
  { key: 'inbox', label: 'Inbox', to: '/app/mail' },
  { key: 'sent', label: 'Sent', to: '/app/mail/sent' },
] as const;

export function MailTabs({ active }: { active: 'inbox' | 'sent' }) {
  return (
    <nav className="flex items-center gap-1" aria-label="Mail folders">
      {TABS.map((t) => (
        <Link
          key={t.key}
          to={t.to}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
            active === t.key
              ? 'bg-surface-2 text-fg'
              : 'text-muted hover:bg-surface-2 hover:text-fg'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
