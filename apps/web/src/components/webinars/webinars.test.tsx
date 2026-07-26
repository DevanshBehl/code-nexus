import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PollDto } from '@code-nexus/types';
import { PollCard } from './PollCard.tsx';
import { HlsPlayer } from './HlsPlayer.tsx';
import { ChatPanel } from './ChatPanel.tsx';
import { AttendanceTable } from './WebinarBits.tsx';

const poll: PollDto = {
  publicId: 'p1',
  question: 'Favourite stack?',
  status: 'OPEN',
  options: [
    { publicId: 'o1', text: 'React', ordinal: 1, count: 0 },
    { publicId: 'o2', text: 'Vue', ordinal: 2, count: 0 },
  ],
  myVoteOptionPublicId: null,
};

describe('PollCard', () => {
  it('shows vote buttons before voting and calls onVote', () => {
    const onVote = vi.fn();
    render(<PollCard poll={poll} canVote onVote={onVote} />);
    const btn = screen.getByRole('button', { name: 'React' });
    fireEvent.click(btn);
    expect(onVote).toHaveBeenCalledWith('o1');
  });

  it('shows aggregate results (not vote buttons) once voted', () => {
    render(
      <PollCard
        poll={{
          ...poll,
          myVoteOptionPublicId: 'o1',
          options: [
            { publicId: 'o1', text: 'React', ordinal: 1, count: 3 },
            { publicId: 'o2', text: 'Vue', ordinal: 2, count: 1 },
          ],
        }}
        canVote
        onVote={vi.fn()}
      />,
    );
    // No vote buttons remain; results percentages are shown.
    expect(screen.queryByRole('button', { name: 'React' })).toBeNull();
    expect(screen.getByText(/75% · 3/)).toBeInTheDocument();
  });
});

describe('HlsPlayer', () => {
  it('shows a "stream not connected" placeholder when live with no playbackUrl (stub)', () => {
    render(<HlsPlayer playbackUrl={null} live />);
    expect(screen.getByText(/stream not connected/i)).toBeInTheDocument();
  });
  it('shows a pre-live message when not live', () => {
    render(<HlsPlayer playbackUrl={null} live={false} />);
    expect(screen.getByText(/has not gone live/i)).toBeInTheDocument();
  });
});

describe('ChatPanel', () => {
  it('sends trimmed non-empty messages and clears the input', () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} onSend={onSend} />);
    const input = screen.getByLabelText('Chat message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  hi there  ' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalledWith('hi there');
    expect(input.value).toBe('');
  });
  it('disables input when disabled', () => {
    render(<ChatPanel messages={[]} onSend={vi.fn()} disabled />);
    expect(screen.getByLabelText('Chat message')).toBeDisabled();
  });
});

describe('AttendanceTable', () => {
  it('renders an empty state and rows', () => {
    const { rerender } = render(<AttendanceTable rows={[]} />);
    expect(screen.getByText(/no attendees/i)).toBeInTheDocument();
    rerender(
      <AttendanceTable
        rows={[
          {
            studentPublicId: 's1',
            displayName: 'Asha Rao',
            firstJoinedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            attendedSeconds: 125,
            present: true,
          },
        ]}
      />,
    );
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText(/Present/)).toBeInTheDocument();
  });
});
