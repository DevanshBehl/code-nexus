import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FeedbackDto, InterviewPeer } from '@code-nexus/types';
import { FeedbackForm, FeedbackList, InterviewStatusBadge, PeerRoster } from './InterviewBits.tsx';

describe('InterviewStatusBadge', () => {
  it('renders the status label', () => {
    render(<InterviewStatusBadge status="LIVE" />);
    expect(screen.getByText(/Live/)).toBeInTheDocument();
  });
});

describe('PeerRoster', () => {
  it('shows the in-room count and peer names', () => {
    const peers: InterviewPeer[] = [
      { peerId: 'p1', displayName: 'Asha', role: 'CANDIDATE' },
      { peerId: 'p2', displayName: 'Acme', role: 'INTERVIEWER' },
    ];
    render(<PeerRoster peers={peers} count={2} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Asha')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
});

describe('FeedbackForm', () => {
  it('validates + submits rating/notes/recommendation, with an advance option', () => {
    const onSubmit = vi.fn();
    render(<FeedbackForm onSubmit={onSubmit} canAdvance pending={false} />);
    // Empty notes → blocked.
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));
    expect(onSubmit).not.toHaveBeenCalled();
    // Fill notes, then submit.
    fireEvent.change(screen.getByPlaceholderText(/Strengths, concerns/i), {
      target: { value: 'Great communication' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: 'Great communication',
        recommendation: 'YES',
        rating: 3,
      }),
    );
    // The advance-application selector is present when canAdvance.
    expect(screen.getByText(/Advance linked application/i)).toBeInTheDocument();
  });

  it('hides the advance selector when canAdvance is false', () => {
    render(<FeedbackForm onSubmit={vi.fn()} canAdvance={false} />);
    expect(screen.queryByText(/Advance linked application/i)).toBeNull();
  });
});

describe('FeedbackList', () => {
  it('renders an empty state, then feedback rows', () => {
    const { rerender } = render(<FeedbackList feedback={[]} />);
    expect(screen.getByText(/No feedback submitted/i)).toBeInTheDocument();
    const feedback: FeedbackDto[] = [
      {
        publicId: 'f1',
        authorName: 'Interviewer abcd',
        rating: 4,
        notes: 'Solid.',
        recommendation: 'YES',
        submittedAt: new Date().toISOString(),
      },
    ];
    rerender(<FeedbackList feedback={feedback} />);
    expect(screen.getByText('Solid.')).toBeInTheDocument();
    expect(screen.getByText(/4\/5 · Yes/)).toBeInTheDocument();
  });
});
