import { Navbar } from './sections/Navbar.tsx';
import { Hero } from './sections/Hero.tsx';
import { Features } from './sections/Features.tsx';
import { Roles } from './sections/Roles.tsx';
import { HowItWorks } from './sections/HowItWorks.tsx';
import { CTA } from './sections/CTA.tsx';
import { Footer } from './sections/Footer.tsx';

/** The public Code Nexus landing page. */
export default function App() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <Features />
        <Roles />
        <HowItWorks />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
