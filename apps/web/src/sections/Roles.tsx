import { Section } from '../components/Section.tsx';
import { Kicker } from '../components/Kicker.tsx';
import { ROLES } from '../data.ts';

export function Roles() {
  return (
    <Section id="roles" className="border-y border-line bg-bg-subtle">
      <div className="mb-12 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <Kicker index="02">Roles</Kicker>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight text-fg sm:text-[2.5rem]">
            One platform, five focused roles
          </h2>
        </div>
        <p className="max-w-sm text-[15px] leading-relaxed text-muted">
          Each role gets a tailored surface — with strict, role-based permissions enforced on every
          request behind it.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {ROLES.map((role, i) => (
          <article key={role.name} className="flex flex-col bg-bg p-6">
            <div className="mb-6 flex items-center justify-between">
              <role.icon className="h-5 w-5 text-fg" />
              <span className="mono-label text-[10px] text-faint">
                {String(i + 1).padStart(2, '0')}
              </span>
            </div>
            <h3 className="text-[15px] font-medium tracking-tight text-fg">{role.name}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{role.blurb}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}
