import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.tsx';

describe('landing page', () => {
  it('renders the brand and all primary sections', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    // Brand appears (navbar + footer).
    expect(screen.getAllByText('Code Nexus').length).toBeGreaterThan(0);

    // Section headings are present.
    expect(
      screen.getByRole('heading', { name: /six domains, one connected system/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /one platform, five focused roles/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /how a placement flows/i })).toBeInTheDocument();
  });
});
