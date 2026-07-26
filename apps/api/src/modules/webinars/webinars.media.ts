import type { AppConfig } from '@code-nexus/config';
import type { WebinarIngest } from '@code-nexus/types';

/**
 * The media plane is OUT OF BAND: the api never touches media bytes. A provider
 * only computes the host's ingest credentials (RTMP URL + stream key) and the
 * viewer's HLS playback URL from config. Which provider is used is selected by
 * `MEDIA_PROVIDER`:
 *
 *   stub       — no media server. playbackUrl is null (the viewer player shows a
 *                "stream not connected" state); the room still works fully. This
 *                is the default and what every test runs against.
 *   selfhosted — an RTMP->HLS media server (e.g. node-media-server / nginx-rtmp).
 *                The host pushes RTMP with the per-webinar stream key (OBS); the
 *                viewer plays `<HLS_BASE>/live/<streamKey>/index.m3u8` via hls.js.
 *
 * TODO(phaseN): browser-native publish (WHIP) + a 'managed' provider (Mux/Cloudflare).
 */
export interface MediaProvider {
  readonly kind: 'stub' | 'selfhosted';
  /** Host ingest credentials for a live webinar (host-only; never sent to viewers). */
  ingestFor(streamKey: string): WebinarIngest;
  /** Viewer HLS manifest URL, or null when there is no real media (stub). */
  playbackUrlFor(streamKey: string): string | null;
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export function createMediaProvider(config: AppConfig): MediaProvider {
  if (config.MEDIA_PROVIDER === 'selfhosted') {
    const rtmp = trimTrailingSlash(config.RTMP_INGEST_BASE);
    const hls = trimTrailingSlash(config.HLS_PLAYBACK_BASE);
    return {
      kind: 'selfhosted',
      ingestFor: (streamKey) => ({ ingestUrl: `${rtmp}/live`, streamKey }),
      playbackUrlFor: (streamKey) => `${hls}/live/${streamKey}/index.m3u8`,
    };
  }
  // stub
  return {
    kind: 'stub',
    ingestFor: (streamKey) => ({ ingestUrl: 'rtmp://stub/live', streamKey }),
    playbackUrlFor: () => null,
  };
}
