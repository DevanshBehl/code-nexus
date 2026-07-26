import { Section } from '../components/Section.tsx';
import { Reveal } from '../components/Reveal.tsx';
import { ButtonLink } from '../components/Button.tsx';

export function CTA() {
  return (
    <Section className="border-t border-line">
      <Reveal>
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div className="max-w-xl">
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-fg sm:text-[2.75rem] sm:leading-[1.05]">
              Bring your campus placements together.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              Built for universities and their students, and the companies that recruit them.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <ButtonLink href="#platform" variant="primary" size="lg">
              Request access
            </ButtonLink>
            <ButtonLink href="#top" variant="secondary" size="lg">
              Back to top
            </ButtonLink>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
