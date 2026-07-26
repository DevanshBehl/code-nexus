import type { RtClientMessage, RtServerMessage, RtTokenResponse } from '@code-nexus/types';
import { api } from './api.ts';

/**
 * A thin WSS client for the Phase 8 webinar room. It fetches a short-lived RT
 * token from the api, connects to the ws-gateway, exposes typed send/receive, and
 * reconnects with backoff (re-minting the token each attempt). It carries no
 * media — that is HLS, played separately. If the gateway is unreachable the rest
 * of the app is unaffected; the caller just shows a "live room unavailable" state.
 */
export interface RtClientOptions {
  webinarPublicId: string;
  onMessage: (msg: RtServerMessage) => void;
  onStatus?: (status: RtStatus) => void;
}

export type RtStatus = 'connecting' | 'open' | 'closed' | 'unavailable';

export class RtClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private attempts = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: RtClientOptions) {}

  connect(): void {
    this.closedByUser = false;
    void this.open();
  }

  private setStatus(s: RtStatus): void {
    this.opts.onStatus?.(s);
  }

  private async open(): Promise<void> {
    this.setStatus('connecting');
    let tok: RtTokenResponse;
    try {
      tok = await api.get<RtTokenResponse>(`/webinars/${this.opts.webinarPublicId}/rt-token`);
    } catch {
      // Not live / not eligible / api down — surface as unavailable and retry.
      this.setStatus('unavailable');
      this.scheduleReconnect();
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${tok.url}?token=${encodeURIComponent(tok.token)}`);
    } catch {
      this.setStatus('unavailable');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.setStatus('open');
      // Keep attendance fresh + let the gateway's stale sweep see us.
      this.heartbeat = setInterval(() => this.send({ t: 'presence:heartbeat' }), 15_000);
    };
    ws.onmessage = (ev) => {
      try {
        this.opts.onMessage(JSON.parse(ev.data as string) as RtServerMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.clearHeartbeat();
      if (this.closedByUser) {
        this.setStatus('closed');
        return;
      }
      this.setStatus('closed');
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose will follow; nothing to do here.
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    this.attempts += 1;
    if (this.attempts > 6) return; // give up quietly after ~30s of failures
    const delay = Math.min(1000 * 2 ** (this.attempts - 1), 15_000);
    setTimeout(() => {
      if (!this.closedByUser) void this.open();
    }, delay);
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  send(msg: RtClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closedByUser = true;
    this.clearHeartbeat();
    this.ws?.close();
    this.ws = null;
  }
}
