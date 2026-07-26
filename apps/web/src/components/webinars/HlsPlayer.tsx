import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Radio, VideoOff } from 'lucide-react';

/**
 * Viewer HLS player. Plays `playbackUrl` (an .m3u8) via hls.js, or natively where
 * the browser supports HLS (Safari). When there is no stream — the stub media
 * provider, or before the host starts pushing — it shows a clear "stream not
 * connected" state. The room (chat/polls/presence) works regardless.
 */
export function HlsPlayer({ playbackUrl, live }: { playbackUrl: string | null; live: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const video = videoRef.current;
    if (!video || !playbackUrl) return;

    // Safari / native HLS.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playbackUrl;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ liveDurationInfinity: true });
      hls.loadSource(playbackUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) setFailed(true);
      });
      return () => hls.destroy();
    }
    setFailed(true);
  }, [playbackUrl]);

  const showPlaceholder = !playbackUrl || failed;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-line bg-black">
      {!showPlaceholder ? (
        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          muted
          className="h-full w-full"
          aria-label="Webinar stream"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-white/70">
          <VideoOff className="h-8 w-8" aria-hidden="true" />
          <p className="text-sm font-medium">
            {live ? 'Stream not connected' : 'The host has not gone live yet'}
          </p>
          <p className="max-w-xs text-[12px] text-white/50">
            {live
              ? 'The room is live — chat and polls are active. Video will appear once the host starts streaming.'
              : 'Hang tight — the session will begin shortly.'}
          </p>
        </div>
      )}
      {live ? (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
          <Radio className="h-3 w-3" aria-hidden="true" /> Live
        </span>
      ) : null}
    </div>
  );
}
