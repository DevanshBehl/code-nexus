interface LogoProps {
  className?: string;
  withWordmark?: boolean;
}

/** Code Nexus mark — a linked-node hexagon (built inline, no external asset). */
export function Logo({ className = '', withWordmark = true }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="relative inline-flex h-8 w-8 items-center justify-center">
        <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
          <defs>
            <linearGradient
              id="cn-logo"
              x1="0"
              y1="0"
              x2="32"
              y2="32"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--color-brand-500)" />
              <stop offset="1" stopColor="var(--color-accent-500)" />
            </linearGradient>
          </defs>
          <path
            d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z"
            fill="url(#cn-logo)"
            fillOpacity="0.14"
            stroke="url(#cn-logo)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="10.5" r="2.1" fill="url(#cn-logo)" />
          <circle cx="10" cy="20" r="2.1" fill="url(#cn-logo)" />
          <circle cx="22" cy="20" r="2.1" fill="url(#cn-logo)" />
          <path
            d="M16 10.5 10 20m6-9.5L22 20m-12 0h12"
            stroke="url(#cn-logo)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {withWordmark ? (
        <span className="text-[17px] font-semibold tracking-tight text-fg">Code Nexus</span>
      ) : null}
    </span>
  );
}
