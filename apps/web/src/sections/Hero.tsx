import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { ButtonLink } from '../components/Button.tsx';
import { ProductPreview } from '../components/ProductPreview.tsx';

const SPECS = [
  { k: '6', v: 'Domains' },
  { k: '5', v: 'Roles' },
  { k: '1', v: 'Platform' },
  { k: 'RBAC', v: 'By default' },
];

export function Hero() {
  const reduce = useReducedMotion();

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.07, delayChildren: 0.04 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <section id="top" className="relative overflow-hidden border-b border-line">
      <div aria-hidden="true" className="bg-dots pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-24">
        <motion.div
          variants={container}
          initial={reduce ? false : 'hidden'}
          animate="show"
          className="max-w-3xl"
        >
          <motion.div
            variants={item}
            className="mono-label mb-6 flex items-center gap-2.5 text-faint"
          >
            <span className="flex h-1.5 w-1.5 rounded-full bg-accent" />
            The campus placement platform
          </motion.div>

          <motion.h1
            variants={item}
            className="text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.03em] text-fg sm:text-[4.25rem]"
          >
            Campus placements,
            <br />
            engineered <span className="text-accent">end to end.</span>
          </motion.h1>

          <motion.p variants={item} className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Code Nexus unifies universities, companies, recruiters, and students — placement drives,
            DSA practice, live interviews, and recordings — behind one role-based platform.
          </motion.p>

          <motion.div variants={item} className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <ButtonLink href="#platform" variant="primary" size="lg">
              Request access
            </ButtonLink>
            <ButtonLink href="#how-it-works" variant="link">
              See how it works
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </ButtonLink>
          </motion.div>
        </motion.div>

        <motion.dl
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 0.4, duration: 0.5 }}
          className="mt-12 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4"
        >
          {SPECS.map((s) => (
            <div key={s.v} className="bg-bg px-4 py-3">
              <dt className="text-2xl font-semibold tracking-tight text-fg">{s.k}</dt>
              <dd className="mono-label mt-0.5 text-[10px] text-faint">{s.v}</dd>
            </div>
          ))}
        </motion.dl>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: reduce ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="mt-16"
        >
          <ProductPreview />
        </motion.div>
      </div>
    </section>
  );
}
