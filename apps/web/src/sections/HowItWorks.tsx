import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Section } from '../components/Section.tsx';
import { Kicker } from '../components/Kicker.tsx';
import { STEPS } from '../data.ts';

gsap.registerPlugin(ScrollTrigger);

export function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || !containerRef.current) return;

    const ctx = gsap.context(() => {
      gsap.from('[data-step]', {
        opacity: 0,
        y: 24,
        duration: 0.5,
        ease: 'power2.out',
        stagger: 0.1,
        scrollTrigger: { trigger: containerRef.current, start: 'top 80%' },
      });
      gsap.from('[data-line]', {
        scaleX: 0,
        transformOrigin: 'left center',
        duration: 1.2,
        ease: 'power2.out',
        scrollTrigger: { trigger: containerRef.current, start: 'top 80%' },
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <Section id="how-it-works">
      <div className="mb-14 max-w-2xl">
        <Kicker index="03">Workflow</Kicker>
        <h2 className="mt-5 text-3xl font-semibold tracking-tight text-fg sm:text-[2.5rem]">
          How a placement flows
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          From launching a drive to a final offer — every step tracked in one place.
        </p>
      </div>

      <div ref={containerRef} className="relative">
        <div className="absolute left-0 right-0 top-[13px] hidden h-px bg-line lg:block" />
        <div
          data-line
          className="absolute left-0 top-[13px] hidden h-px w-full bg-accent lg:block"
        />

        <ol className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-6 lg:gap-5">
          {STEPS.map((step, i) => (
            <li key={step.label} data-step className="relative">
              <div className="mb-5 flex items-center gap-3 lg:block">
                <span className="relative z-10 flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line-strong bg-bg">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
              </div>
              <span className="mono-label text-[10px] text-faint">
                Step {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-1 text-[15px] font-medium tracking-tight text-fg">{step.label}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{step.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
