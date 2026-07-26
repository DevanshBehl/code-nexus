/** Formatting helpers + query keys for the Phase 4 drives/applications UI. */

/** CTC is stored as whole INR/year (see README). Format compactly (₹12L, ₹1.2Cr). */
export function formatCtc(ctcAnnual: number | null | undefined): string {
  if (ctcAnnual == null) return 'Undisclosed';
  if (ctcAnnual >= 10_000_000) return `₹${(ctcAnnual / 10_000_000).toFixed(2)} Cr/yr`;
  if (ctcAnnual >= 100_000) return `₹${(ctcAnnual / 100_000).toFixed(2)} L/yr`;
  return `₹${ctcAnnual.toLocaleString('en-IN')}/yr`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const label = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (d.getTime() < now) return `${label} (passed)`;
  return label;
}

export const driveKeys = {
  list: ['drives'] as const,
  detail: (publicId: string) => ['drives', publicId] as const,
  applicants: (publicId: string) => ['drives', publicId, 'applicants'] as const,
  universities: ['directory', 'universities'] as const,
  myApplications: ['applications', 'mine'] as const,
  universityApplications: ['applications', 'university'] as const,
};
