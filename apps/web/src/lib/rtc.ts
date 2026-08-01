import {
  isOfferer,
  type InterviewChatMessage,
  type InterviewPeer,
  type InterviewQuestion,
  type InterviewServerMessage,
  type InterviewSurface,
  type LobbyWaiter,
  type RtcConfigResponse,
  type RtTokenResponse,
} from '@code-nexus/types';
import { api } from './api.ts';

/**
 * A WebRTC mesh for the Phase 9 interview room, signaled over the ws-gateway.
 * Media flows peer-to-peer (SRTP) — this class only relays SDP/ICE over the
 * socket and manages one RTCPeerConnection per remote peer. The gateway + api
 * never see media bytes. Also carries the shared code editor, whiteboard, chat,
 * and presence for the room. STUN (and optional TURN) come from the api's
 * `rtc-config`. Glare is avoided by `isOfferer` (lexicographic peer-id election).
 */
export type RtcStatus = 'connecting' | 'open' | 'closed' | 'unavailable';

export interface InterviewSessionCallbacks {
  onStatus?: (s: RtcStatus) => void;
  /** Parked in the lobby — connected, but outside the room until someone opens it. */
  onWaiting?: () => void;
  /** An interviewer let us in. `onReady` follows immediately. */
  onAdmitted?: () => void;
  /** An interviewer turned us away. */
  onDenied?: () => void;
  /** The people currently knocking (interviewers only). */
  onLobby?: (waiting: LobbyWaiter[]) => void;
  onReady?: (myPeerId: string, peers: InterviewPeer[]) => void;
  onRemoteStream?: (peerId: string, stream: MediaStream) => void;
  onPeerJoined?: (peer: InterviewPeer) => void;
  onPeerLeft?: (peerId: string) => void;
  onCode?: (content: string) => void;
  onWhiteboard?: (stroke: unknown) => void;
  onChat?: (message: InterviewChatMessage) => void;
  /** The room moved to a different shared stage (someone opened the board/IDE). */
  onSurface?: (surface: InterviewSurface) => void;
  /** An interviewer pinned (or cleared) the question everyone is working on. */
  onQuestion?: (question: InterviewQuestion | null) => void;
  onPresence?: (count: number) => void;
  onEnded?: () => void;
  /** A frame the gateway refused (e.g. an interviewer trying to type in the IDE). */
  onError?: (code: string, message: string) => void;
}

export class InterviewSession {
  private ws: WebSocket | null = null;
  private myPeerId = '';
  private closedByUser = false;
  private attempts = 0;
  private readonly peers = new Map<string, RTCPeerConnection>();
  private iceServers: RTCIceServer[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly publicId: string,
    private readonly localStream: MediaStream,
    private readonly cb: InterviewSessionCallbacks,
  ) {}

  connect(): void {
    this.closedByUser = false;
    void this.open();
  }

  private status(s: RtcStatus): void {
    this.cb.onStatus?.(s);
  }

  private async open(): Promise<void> {
    this.status('connecting');
    let tok: RtTokenResponse;
    try {
      const [t, rtc] = await Promise.all([
        api.get<RtTokenResponse>(`/interviews/${this.publicId}/rt-token`),
        api.get<RtcConfigResponse>(`/interviews/${this.publicId}/rtc-config`),
      ]);
      tok = t;
      this.iceServers = rtc.iceServers as RTCIceServer[];
    } catch {
      this.status('unavailable');
      this.scheduleReconnect();
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${tok.url}?token=${encodeURIComponent(tok.token)}`);
    } catch {
      this.status('unavailable');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.status('open');
      this.heartbeat = setInterval(() => this.sendRaw({ t: 'presence:heartbeat' }), 15_000);
    };
    ws.onmessage = (ev) => {
      let msg: InterviewServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as InterviewServerMessage;
      } catch {
        return;
      }
      void this.handle(msg);
    };
    ws.onclose = () => {
      this.clearHeartbeat();
      this.status('closed');
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    this.attempts += 1;
    if (this.attempts > 6) return;
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

  // ---- Signaling + peer management -----------------------------------------

  private async handle(msg: InterviewServerMessage): Promise<void> {
    switch (msg.t) {
      case 'lobby:waiting':
        this.cb.onWaiting?.();
        break;
      case 'lobby:admitted':
        this.cb.onAdmitted?.();
        break;
      case 'lobby:denied':
        // Being turned away is final for this attempt — stop reconnecting, or the
        // socket would knock again on its own a second later.
        this.cb.onDenied?.();
        this.close();
        break;
      case 'lobby:updated':
        this.cb.onLobby?.(msg.waiting);
        break;
      case 'ready': {
        this.myPeerId = msg.peerId;
        this.cb.onReady?.(msg.peerId, msg.peers);
        // I offer to every existing peer for which I win the election.
        for (const peer of msg.peers) {
          if (isOfferer(this.myPeerId, peer.peerId)) await this.makeOffer(peer.peerId);
        }
        break;
      }
      case 'peer:joined':
        this.cb.onPeerJoined?.(msg.peer);
        if (isOfferer(this.myPeerId, msg.peer.peerId)) await this.makeOffer(msg.peer.peerId);
        break;
      case 'peer:left':
        this.peers.get(msg.peerId)?.close();
        this.peers.delete(msg.peerId);
        this.cb.onPeerLeft?.(msg.peerId);
        break;
      case 'rtc:offer': {
        const pc = this.ensurePeer(msg.from);
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendRaw({ t: 'rtc:answer', to: msg.from, sdp: answer.sdp ?? '' });
        break;
      }
      case 'rtc:answer':
        await this.peers.get(msg.from)?.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        break;
      case 'rtc:ice':
        try {
          await this.peers.get(msg.from)?.addIceCandidate(msg.candidate as RTCIceCandidateInit);
        } catch {
          /* ignore late/duplicate candidates */
        }
        break;
      case 'code:sync':
      case 'code:update':
        this.cb.onCode?.(msg.content);
        break;
      case 'whiteboard:stroke':
        this.cb.onWhiteboard?.(msg.stroke);
        break;
      case 'chat:new':
        this.cb.onChat?.(msg.message);
        break;
      case 'surface:changed':
        this.cb.onSurface?.(msg.surface);
        break;
      case 'question:set':
        this.cb.onQuestion?.(msg.question);
        break;
      case 'error':
        this.cb.onError?.(msg.code, msg.message);
        break;
      case 'presence:count':
        this.cb.onPresence?.(msg.count);
        break;
      case 'interview:ended':
        this.cb.onEnded?.();
        this.close();
        break;
      default:
        break;
    }
  }

  private ensurePeer(peerId: string): RTCPeerConnection {
    let pc = this.peers.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: this.iceServers });
    for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendRaw({ t: 'rtc:ice', to: peerId, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (stream) this.cb.onRemoteStream?.(peerId, stream);
    };
    this.peers.set(peerId, pc);
    return pc;
  }

  private async makeOffer(peerId: string): Promise<void> {
    const pc = this.ensurePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendRaw({ t: 'rtc:offer', to: peerId, sdp: offer.sdp ?? '' });
  }

  // ---- Outbound helpers -----------------------------------------------------

  private sendRaw(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendCode(content: string): void {
    this.sendRaw({ t: 'code:update', content });
  }
  sendWhiteboard(stroke: unknown): void {
    this.sendRaw({ t: 'whiteboard:stroke', stroke });
  }
  sendChat(body: string): void {
    this.sendRaw({ t: 'chat:send', body });
  }
  /**
   * Ask the gateway to move the WHOLE room to a surface. Deliberately fire-and-
   * forget: the caller does not flip its own view, it waits for the broadcast
   * back, so every participant switches off the same authoritative frame.
   */
  sendSurface(surface: InterviewSurface): void {
    this.sendRaw({ t: 'surface:set', surface });
  }

  /** Open the door for someone waiting (interviewer only; the gateway re-checks). */
  admit(peerId: string): void {
    this.sendRaw({ t: 'lobby:admit', peerId });
  }
  /** Turn someone away. */
  deny(peerId: string): void {
    this.sendRaw({ t: 'lobby:deny', peerId });
  }

  /** Replace the outgoing video track on every peer (used for screen-share toggle). */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(track);
    }
  }

  close(): void {
    this.closedByUser = true;
    this.clearHeartbeat();
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.ws?.close();
    this.ws = null;
  }
}
