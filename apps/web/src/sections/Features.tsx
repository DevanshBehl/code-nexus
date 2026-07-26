import { ArrowUpRight } from 'lucide-react';
import { Section } from '../components/Section.tsx';
import { Kicker } from '../components/Kicker.tsx';
import { Reveal } from '../components/Reveal.tsx';
import { FEATURES } from '../data.ts';

export function Features() {
  return (
    <Section id="platform">
      <div className="grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-[0.85fr_1.4fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Kicker index="01">Platform</Kicker>
          <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight text-fg sm:text-[2.5rem] sm:leading-[1.08]">
            Six domains, one connected system
          </h2>
          <p className="mt-4 max-w-sm leading-relaxed text-muted">
            Every part of the placement lifecycle, built to work together — not six disconnected
            tools stitched at the seams.
          </p>
        </div>

        <Reveal>
          <ol className="border-t border-line">
            {FEATURES.map((feature, i) => (
              <li key={feature.title} className="group border-b border-line">
                <a href="#how-it-works" className="flex items-start gap-5 py-6 transition-colors">
                  <span className="mono-label w-6 shrink-0 pt-1 text-faint transition-colors group-hover:text-accent">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <feature.icon className="mt-0.5 h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-fg" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-medium tracking-tight text-fg">{feature.title}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-muted">
                      {feature.description}
                    </p>
                  </div>
                  <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-faint opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </a>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </Section>
  );
}
