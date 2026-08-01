import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, WifiOff } from 'lucide-react';
import type { WebinarDetail } from '@code-nexus/types';
import { api } from '../../lib/api.ts';
import { webinarKeys } from '../../lib/webinars.ts';
import { useWebinarRoom } from '../../lib/useWebinarRoom.ts';
import { AppShell } from '../../components/dashboard/AppShell.tsx';
import { QueryState } from '../../components/dashboard/QueryState.tsx';
import { HlsPlayer } from '../../components/webinars/HlsPlayer.tsx';
import { ChatPanel } from '../../components/webinars/ChatPanel.tsx';
import { PollCard } from '../../components/webinars/PollCard.tsx';
import { PresencePill } from '../../components/webinars/WebinarBits.tsx';

/**
 * The student webinar room: HLS player + live chat + polls + presence, all over
 * the ws-gateway (RT-token authenticated). Media is separate from the real-time
 * plane, so chat/polls work even with the stub media provider (no video).
 */
export function WebinarRoom({ publicId }: { publicId: string }) {
  const detail = useQuery({
    queryKey: webinarKeys.detail(publicId),
    queryFn: () => api.get<WebinarDetail>(`/webinars/${publicId}`),
  });
  const w = detail.data;

  return (
    <AppShell title={w?.title ?? 'Webinar'} fullBleed>
      <div className="mx-auto w-full max-w-6xl px-4 py-4">
        <Link
          to="/app/webinars"
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4" /> Webinars
        </Link>
        <QueryState
          isLoading={detail.isLoading}
          isError={detail.isError}
          onRetry={() => detail.refetch()}
        >
          {w ? <LiveRoom webinar={w} publicId={publicId} /> : null}
        </QueryState>
      </div>
    </AppShell>
  );
}

function LiveRoom({ webinar, publicId }: { webinar: WebinarDetail; publicId: string }) {
  const live = webinar.status === 'LIVE';
  const room = useWebinarRoom(publicId, live, webinar.status === 'ENDED');
  const openPolls = useMemo(() => room.polls.filter((p) => p.status === 'OPEN'), [room.polls]);
  const chatDisabled = !live || room.ended || room.status !== 'open';

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      {/* Media + polls */}
      <div className="space-y-4">
        <div className="relative">
          <HlsPlayer playbackUrl={webinar.playbackUrl} live={live && !room.ended} />
          {room.ended ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80 text-center text-white">
              <p className="text-base font-semibold">This webinar has ended</p>
              <p className="text-[13px] text-white/60">Thanks for attending.</p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-fg">{webinar.title}</h1>
          {live && !room.ended ? <PresencePill count={room.presence} /> : null}
        </div>
        <p className="whitespace-pre-wrap text-[13px] text-muted">{webinar.description}</p>

        {openPolls.length > 0 ? (
          <div className="space-y-3">
            <h2 className="mono-label text-[10px] text-faint">Live polls</h2>
            {openPolls.map((p) => (
              <PollCard
                key={p.publicId}
                poll={p}
                canVote
                onVote={(opt) => room.vote(p.publicId, opt)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Chat */}
      <aside className="flex h-[70vh] flex-col rounded-2xl border border-line bg-surface p-4 lg:h-[calc(100vh-9rem)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-fg">Chat</h2>
          {room.status !== 'open' && live && !room.ended ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-warn">
              <WifiOff className="h-3 w-3" />{' '}
              {room.status === 'unavailable' ? 'Room offline' : 'Connecting…'}
            </span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1">
          <ChatPanel messages={room.messages} onSend={room.sendChat} disabled={chatDisabled} />
        </div>
      </aside>
    </div>
  );
}
