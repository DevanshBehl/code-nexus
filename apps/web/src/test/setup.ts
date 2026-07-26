import '@testing-library/jest-dom/vitest';

// jsdom implements neither IntersectionObserver nor matchMedia. Framer Motion's
// `whileInView` needs the former; reduced-motion checks need the latter. Provide
// minimal stubs so components render in tests.
if (!('IntersectionObserver' in globalThis)) {
  class IntersectionObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return [];
    }
  }
  // @ts-expect-error assigning a test stub to the global
  globalThis.IntersectionObserver = IntersectionObserverStub;
}

// jsdom does not implement scrollIntoView (used by the webinar chat auto-scroll).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
