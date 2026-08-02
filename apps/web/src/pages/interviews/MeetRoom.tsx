import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CircleDot,
  Code2,
  DoorClosed,
  DoorOpen,
  FileText,
  Loader2,
  Lock,
  MessageSquare,
  Mic,
  MicOff,
  Presentation,
  ScreenShare,
  ScreenShareOff,
  Square,
  Users,
  Video as VideoIcon,
  VideoOff,
  X,
} from 'lucide-react';
import {
  electRecorder,
  isTerminalSubmissionStatus,
  type EnqueueResponse,
  type InterviewChatMessage,
  type InterviewDetail,
  type InterviewPeer,
  type InterviewQuestion,
  type InterviewSurface,
  type LobbyWaiter,
  type ProgrammingLanguage,
  type SubmissionDto,
} from '@code-nexus/types';
import { api, ApiError } from '../../lib/api.ts';
import { interviewKeys } from '../../lib/interviews.ts';
import { InterviewSession, type RtcStatus } from '../../lib/rtc.ts';
import { useExitGuard, useFullscreenLock } from '../../lib/roomLock.ts';
import { FullscreenGate } from '../../components/rooms/FullscreenGate.tsx';
import { ChatPanel } from '../../components/webinars/ChatPanel.tsx';
import { VideoTile } from '../../components/interviews/VideoTile.tsx';
import { CodePad } from '../../components/interviews/CodePad.tsx';
import { Whiteboard, type Stroke } from '../../components/interviews/Whiteboard.tsx';
import { QuestionPanel } from '../../components/interviews/QuestionPanel.tsx';
import { DockButton, MeetDock } from '../../components/interviews/MeetDock.tsx';
import {
  RecordingBadge,
  RecordingConsentNotice,
} from '../../components/recordings/RecordingBadge.tsx';
import { InterviewRecorder, isRecordingSupported } from '../../lib/recording.ts';

/**
 * The live interview room — a full-viewport, Meet-style call that deliberately
 * replaces the app shell: while an interview is running there is no sidebar and
 * no navigation out, so neither side can wander into the rest of the platform
 * mid-question.
 *
 * The room is LOCKED for everyone in it, whatever their role. It takes the
 * browser fullscreen on entry and covers itself if that is ever lost, Back is
 * trapped, and there is no "leave" button: the interview is over when the
 * interviewer ENDS it, and only then does a way out appear. The one exception is
 * the recording consent notice — a candidate who does not agree to being
 * recorded must be able to walk away, and that stays true here.
 *
 * The room opens as a PLAIN CALL. The whiteboard and the IDE are opt-in from the
 * dock, and opening either one is a SHARED move: the request goes to the gateway,
 * which broadcasts the new surface to everybody, so all participants land on the
 * same stage with the video tiles collapsing to a filmstrip. Chat, people and the
 * question reader are local side panels.
 *
 * Write access is asymmetric by design: the whiteboard is collaborative, the IDE
 * belongs to the candidate alone (interviewers watch it stream read-only), and
 * only an interviewer can pin a question from the bank. All three rules are
 * enforced server-side — this component only mirrors them.
 */

/** Which local side panel is open (independent per participant). */
type Panel = 'chat' | 'people' | 'question' | null;

interface ChatRow {
  publicId: string;
  senderName: string;
  senderPublicId: string;
  body: string;
  sentAt: string;
}

export function MeetRoom({
  iv,
  publicId,
  stream,
  initialMic,
  initialCam,
  onEnded,
  onLeave,
}: {
  iv: InterviewDetail;
  publicId: string;
  /** The stream the lobby already acquired — never re-prompt on the way in. */
  stream: MediaStream | null;
  initialMic: boolean;
  initialCam: boolean;
  onEnded: () => void;
  /** Back to the lobby (turned away, or the candidate declined recording). */
  onLeave: () => void;
}) {
  const qc = useQueryClient();
  const sessionRef = useRef<InterviewSession | null>(null);
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Media + connection ---------------------------------------------------
  const localStream = stream;
  const [remotes, setRemotes] = useState<Map<string, MediaStream>>(new Map());
  const [peers, setPeers] = useState<InterviewPeer[]>([]);
  const [presence, setPresence] = useState(1);
  const [status, setStatus] = useState<RtcStatus>('connecting');
  const [ended, setEnded] = useState(false);
  /** This person opened the room in a newer tab; this one has been retired. */
  const [displaced, setDisplaced] = useState(false);
  // Set only on the sanctioned way out (declining to be recorded) so the exit
  // guard stands down for the navigation that follows.
  const [exiting, setExiting] = useState(false);
  const [micOn, setMicOn] = useState(initialMic);
  const [camOn, setCamOn] = useState(initialCam);
  const [sharing, setSharing] = useState(false);
  const mediaDenied = !stream || stream.getTracks().length === 0;

  // ---- Admission (the lobby) ------------------------------------------------
  /**
   * `knocking` until the gateway answers. An interviewer is admitted on connect
   * and never sees this; a candidate waits here until somebody opens the door.
   */
  const [admission, setAdmission] = useState<'knocking' | 'waiting' | 'in' | 'denied'>('knocking');
  const [lobbyQueue, setLobbyQueue] = useState<LobbyWaiter[]>([]);

  // ---- Shared room state (driven by the gateway, never set optimistically) ---
  const [surface, setSurface] = useState<InterviewSurface>('call');
  const [question, setQuestion] = useState<InterviewQuestion | null>(iv.activeQuestion);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState<ProgrammingLanguage>('PYTHON');
  const [wbIncoming, setWbIncoming] = useState<{ seq: number; stroke: Stroke } | null>(null);
  const wbSeq = useRef(0);

  // ---- Local UI state -------------------------------------------------------
  const [panel, setPanel] = useState<Panel>(null);
  const [messages, setMessages] = useState<ChatRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<SubmissionDto | null>(null);
  const [runError, setRunError] = useState<string | undefined>();
  const [running, setRunning] = useState(false);

  // ---- Recording (Phase 10) -------------------------------------------------
  const recorderRef = useRef<InterviewRecorder | null>(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [recording, setRecording] = useState(false);
  const [consentAcked, setConsentAcked] = useState(false);

  const isCandidate = iv.isCandidate;
  const canEditCode = isCandidate; // mirrors the gateway's write-lock

  /**
   * Who captures. Computed identically on every client from the shared roster,
   * so exactly one browser records and no negotiation is needed.
   */
  const recorderPeerId = useMemo(() => {
    if (!myPeerId) return null;
    const me: InterviewPeer = {
      peerId: myPeerId,
      displayName: 'You',
      role: isCandidate ? 'CANDIDATE' : 'INTERVIEWER',
    };
    // The roster from the gateway lists everyone *else*, so add ourselves before
    // electing — otherwise a lone interviewer would never record.
    return electRecorder([...peers, me]);
  }, [peers, myPeerId, isCandidate]);
  const iAmRecorder = !!myPeerId && recorderPeerId === myPeerId;

  // Connect the WebRTC mesh + room socket. The media is already in hand from the
  // lobby, so this is the one place the room touches the network on arrival.
  useEffect(() => {
    const media = stream ?? new MediaStream();
    const session = new InterviewSession(publicId, media, {
      onStatus: setStatus,
      onWaiting: () => setAdmission('waiting'),
      onAdmitted: () => setAdmission('in'),
      onDenied: () => setAdmission('denied'),
      onLobby: setLobbyQueue,
      onReady: (id, initial) => {
        setAdmission('in');
        setMyPeerId(id);
        setPeers(initial);
      },
      onPeerJoined: (peer) =>
        setPeers((cur) => [...cur.filter((p) => p.peerId !== peer.peerId), peer]),
      onRemoteStream: (peerId, s) => setRemotes((cur) => new Map(cur).set(peerId, s)),
      onPeerLeft: (peerId) => {
        setRemotes((cur) => {
          const next = new Map(cur);
          next.delete(peerId);
          return next;
        });
        setPeers((cur) => cur.filter((p) => p.peerId !== peerId));
      },
      // The socket dropped: every peer id we knew died with it. Clear the roster
      // and the streams so the reconnect rebuilds the room instead of stacking a
      // second set of tiles on top of frozen ones.
      onReset: () => {
        setPeers([]);
        setRemotes(new Map());
      },
      onDisplaced: () => setDisplaced(true),
      onCode: setCode,
      onWhiteboard: (stroke) => {
        wbSeq.current += 1;
        setWbIncoming({ seq: wbSeq.current, stroke: stroke as Stroke });
      },
      onChat: (m: InterviewChatMessage) =>
        setMessages((cur) => [...cur, { ...m, publicId: `${cur.length}-${m.sentAt}` }]),
      onSurface: setSurface,
      onQuestion: (q) => {
        setQuestion(q);
        // The whole point of pinning a question is that the other side sees it,
        // so surface the reader rather than leaving a silent badge behind.
        if (q) setPanel('question');
      },
      onPresence: setPresence,
      onError: (_code, message) => setNotice(message),
      onEnded: () => {
        setEnded(true);
        onEnded();
      },
    });
    sessionRef.current = session;
    session.connect();
    return () => {
      session.close();
      sessionRef.current = null;
    };
  }, [publicId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Badge chat that arrives while the panel is closed; opening it clears the count.
  useEffect(() => {
    if (messages.length === 0) return;
    setUnread((n) => (panel === 'chat' ? 0 : n + 1));
    // Intentionally keyed on the message count alone: `panel` is read, not tracked,
    // so switching panels does not itself look like a new message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);
  useEffect(() => {
    if (panel === 'chat') setUnread(0);
  }, [panel]);

  /**
   * Start capture. Driven by a click rather than an effect because
   * `getDisplayMedia` — how we record the whole interview surface and not just
   * a camera — is only available from a user gesture. Capture does NOT wait for
   * the candidate: it covers the interview from whenever the interviewer starts
   * it, so the video and the event timeline describe the same stretch of time.
   */
  const startCapture = useCallback(async (): Promise<void> => {
    if (!iAmRecorder || ended || recorderRef.current || !localStream) return;
    if (status !== 'open') {
      setNotice('Not connected to the room yet');
      return;
    }
    if (!isRecordingSupported()) {
      setNotice('This browser cannot record — the interview is not being saved');
      return;
    }
    const rec = new InterviewRecorder(publicId, {
      onStarted: () => setRecording(true),
      onError: (m) => {
        setRecording(false);
        setNotice(m);
      },
      onStopped: () => {
        setRecording(false);
        setNotice('Screen sharing stopped — the recording has ended');
      },
      onCameraOnly: () =>
        setNotice('Screen not shared — recording the camera only, without the code or whiteboard'),
      onChunkLost: () => setNotice('Part of the recording could not be uploaded'),
    });
    recorderRef.current = rec;
    const ok = await rec.start(localStream, [...remotes.values()]);
    if (!ok) recorderRef.current = null;
  }, [iAmRecorder, ended, status, localStream, remotes, publicId]);

  /**
   * Tell the elected recorder once that capture is theirs to start. Nothing
   * else in the room announces it, and an interviewer who assumes it is
   * automatic finds out only when there is no recording to review.
   */
  const nudged = useRef(false);
  useEffect(() => {
    if (!iAmRecorder || ended || recording || nudged.current) return;
    if (status !== 'open') return;
    nudged.current = true;
    setNotice('Press Record to capture this interview');
  }, [iAmRecorder, ended, recording, status]);

  /**
   * Mix peers who arrive after capture began. Recording now starts before the
   * candidate is necessarily in the room, so without this their voice would be
   * missing from the entire recording.
   */
  useEffect(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    for (const stream of remotes.values()) rec.addPeer(stream);
  }, [remotes]);

  // Stop capture when the room ends or this component unmounts.
  useEffect(() => {
    if (!ended) return;
    const rec = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    void rec?.stop();
  }, [ended]);

  useEffect(
    () => () => {
      const rec = recorderRef.current;
      recorderRef.current = null;
      void rec?.stop();
    },
    [],
  );

  // Auto-dismiss the transient notice (a refused frame, a run failure…).
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * The room is locked from the moment it opens until the interview ends: Back
   * is swallowed, closing the tab warns, and the viewport is held fullscreen.
   * Applies to every participant — candidate, recruiter and company side alike.
   */
  // Only once you are actually IN. Someone still knocking — or turned away — has
  // not started an interview, and trapping them at the door would be absurd. A
  // retired tab is not in the interview either: the person is in the newer one,
  // and holding this window hostage would trap them in a room they already left.
  const locked = admission === 'in' && !ended && !exiting && !displaced;
  useExitGuard(locked, () =>
    setNotice('You cannot leave a live interview — the interviewer ends it for everyone.'),
  );
  const fullscreen = useFullscreenLock(locked);

  // Escape closes the open side panel (never the room itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && panel) setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel]);

  const end = useMutation({
    mutationFn: () => api.post(`/interviews/${publicId}/end`, { codeSnapshot: code }),
    onSuccess: () => {
      setEnded(true);
      void qc.invalidateQueries({ queryKey: interviewKeys.detail(publicId) });
    },
    onError: (e) => setNotice(e instanceof ApiError ? e.message : 'Could not end the interview'),
  });

  // ---- Controls -------------------------------------------------------------

  const toggleMic = (): void => {
    const t = localStream?.getAudioTracks()[0];
    if (!t) {
      setNotice('No microphone available');
      return;
    }
    t.enabled = !t.enabled;
    setMicOn(t.enabled);
  };

  const toggleCam = (): void => {
    const t = localStream?.getVideoTracks()[0];
    if (!t) {
      setNotice('No camera available');
      return;
    }
    t.enabled = !t.enabled;
    setCamOn(t.enabled);
  };

  const toggleShare = async (): Promise<void> => {
    if (sharing) {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
      await sessionRef.current?.replaceVideoTrack(cam?.getVideoTracks()[0] ?? null);
      setSharing(false);
      return;
    }
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true }).catch(() => null);
    const track = display?.getVideoTracks()[0];
    if (!track) return;
    await sessionRef.current?.replaceVideoTrack(track);
    track.onended = () => {
      setSharing(false);
      void navigator.mediaDevices
        .getUserMedia({ video: true })
        .then((cam) => sessionRef.current?.replaceVideoTrack(cam.getVideoTracks()[0] ?? null))
        .catch(() => undefined);
    };
    setSharing(true);
  };

  /**
   * Ask the room to move to a surface (or back to the plain call if it is already
   * showing). We do NOT flip `surface` here — the gateway echoes the change back
   * to everyone, so all participants switch on the same frame.
   */
  const requestSurface = useCallback(
    (target: Exclude<InterviewSurface, 'call'>): void => {
      if (status !== 'open') {
        setNotice('Not connected to the room yet');
        return;
      }
      sessionRef.current?.sendSurface(surface === target ? 'call' : target);
    },
    [status, surface],
  );

  const onCodeChange = (v: string): void => {
    if (!canEditCode) return; // observers cannot type; the gateway agrees
    setCode(v);
    if (codeTimer.current) clearTimeout(codeTimer.current);
    codeTimer.current = setTimeout(() => sessionRef.current?.sendCode(v), 250);
  };

  /**
   * Run the shared code against the pinned question's samples. Polled rather than
   * pushed: an interview run is one-off and short, and the judge already reports
   * a terminal state, so a loop that gives up after 30s is the whole protocol.
   * The full verdict is kept — the room renders it the same way the arena does,
   * so a candidate reads the result they are used to reading.
   */
  const run = async (): Promise<void> => {
    setRunning(true);
    setRunError(undefined);
    setRunResult(null);
    try {
      const res = await api.post<EnqueueResponse>(`/interviews/${publicId}/run`, {
        language,
        sourceCode: code,
      });
      const id = res.submissionPublicId;
      for (let i = 0; i < 30; i += 1) {
        await new Promise((r) => setTimeout(r, 1000));
        const s = await api.get<SubmissionDto>(`/arena/submissions/${id}`);
        if (isTerminalSubmissionStatus(s.status)) {
          setRunResult(s);
          return;
        }
      }
      setRunError('The judge is taking longer than usual — try running again.');
    } catch (e) {
      setRunError(e instanceof ApiError ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  /**
   * The single exit that is not "the interview ended": a candidate who declines
   * to be recorded. Consent has to stay refusable, so this one path — and only
   * this one — is allowed to release the lock and walk out.
   */
  const leaveWithoutRecording = (): void => {
    setExiting(true);
    sessionRef.current?.close();
    onLeave();
  };

  const admit = (peerId: string): void => sessionRef.current?.admit(peerId);
  const deny = (peerId: string): void => sessionRef.current?.deny(peerId);

  // ---- Derived --------------------------------------------------------------

  const candidateName = iv.candidate.displayName;
  /**
   * One tile per person in the room, and the ROSTER decides who that is — not the
   * set of streams we happen to be holding. A stream outlives its peer (a dropped
   * socket, a renegotiation, a tab that was retired), and rendering by stream is
   * how an interview booked for two ends up showing five frozen copies of the
   * same two faces. A peer with no stream yet gets a named placeholder instead.
   */
  const remoteTiles = useMemo(
    () =>
      peers.map((p) => ({
        peerId: p.peerId,
        name: p.displayName,
        stream: remotes.get(p.peerId) ?? null,
      })),
    [peers, remotes],
  );
  const onStage = surface !== 'call';

  const tiles = (
    <>
      <VideoTile
        stream={localStream}
        label={mediaDenied ? 'You (no camera/mic)' : 'You'}
        muted
        micOff={!micOn}
        camOff={!camOn}
      />
      {remoteTiles.map((t) => (
        <VideoTile key={t.peerId} stream={t.stream} label={t.name} />
      ))}
    </>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      {/* Header — status only. No links out while the interview is running. */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-600/20 px-2.5 py-1 text-[11px] font-semibold text-red-400">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"
              aria-hidden="true"
            />
            LIVE
          </span>
          <RecordingBadge live={recording} />
          <h1 className="truncate text-[14px] font-medium text-white">
            {iv.title ?? `Interview with ${candidateName}`}
          </h1>
          <ElapsedClock startedAt={iv.startedAt} />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {status !== 'open' && !ended ? (
            <span className="text-[12px] text-amber-400">
              {status === 'unavailable' ? 'Room offline — retrying…' : 'Connecting…'}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5 text-[12px] text-white/60">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular-nums">{presence}</span>
          </span>
          {locked ? (
            <span
              title="You cannot leave or navigate away until the interview is ended"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/70"
            >
              <Lock className="h-3 w-3" aria-hidden="true" /> Locked
            </span>
          ) : null}
        </div>
      </header>

      {notice ? (
        <div
          role="status"
          className="shrink-0 bg-amber-500/15 px-4 py-2 text-center text-[12px] text-amber-300"
        >
          {notice}
        </div>
      ) : null}

      {/* Stage + side panel */}
      <main className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 p-4">
          {onStage ? (
            <div className="flex h-full min-h-0 gap-3">
              <div className="min-w-0 flex-1">
                {surface === 'code' ? (
                  <CodePad
                    language={language}
                    onLanguageChange={setLanguage}
                    value={code}
                    onChange={onCodeChange}
                    onRun={() => void run()}
                    running={running}
                    canRun={isCandidate}
                    result={runResult}
                    resultError={runError}
                    readOnly={!canEditCode}
                    authorName={candidateName}
                  />
                ) : (
                  <Whiteboard
                    incoming={wbIncoming}
                    onStroke={(s) => sessionRef.current?.sendWhiteboard(s)}
                  />
                )}
              </div>
              {/* Video collapses to a filmstrip so the surface owns the stage. */}
              <div className="hidden w-48 shrink-0 space-y-3 overflow-y-auto lg:block xl:w-56">
                {tiles}
              </div>
            </div>
          ) : (
            <div
              className={`grid h-full min-h-0 content-center gap-3 ${
                remoteTiles.length === 0 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'
              }`}
            >
              {tiles}
            </div>
          )}
        </section>

        {panel ? (
          <aside className="flex w-full max-w-sm shrink-0 flex-col border-l border-white/10 bg-neutral-900 sm:w-80 lg:w-96">
            {panel === 'question' ? (
              <QuestionPanel publicId={publicId} question={question} canPick={iv.canManage} />
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                  <h2 className="text-[13px] font-semibold text-white">
                    {panel === 'chat' ? 'Chat' : 'People'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setPanel(null)}
                    aria-label="Close panel"
                    className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {panel === 'chat' ? (
                    <ChatPanel
                      messages={messages}
                      onSend={(b) => sessionRef.current?.sendChat(b)}
                      disabled={status !== 'open' || ended}
                    />
                  ) : (
                    <PeopleList peers={peers} />
                  )}
                </div>
              </>
            )}
          </aside>
        ) : null}
      </main>

      <MeetDock>
        <DockButton
          icon={micOn ? Mic : MicOff}
          label={micOn ? 'Mute' : 'Unmute'}
          active={micOn}
          onClick={toggleMic}
        />
        <DockButton
          icon={camOn ? VideoIcon : VideoOff}
          label={camOn ? 'Stop video' : 'Start video'}
          active={camOn}
          onClick={toggleCam}
        />
        <DockButton
          icon={sharing ? ScreenShareOff : ScreenShare}
          label={sharing ? 'Stop share' : 'Present'}
          active={sharing}
          onClick={() => void toggleShare()}
        />
        {/* Only the elected recorder sees this — one browser captures, and the
            browser will only hand over the tab from a real click. */}
        {iAmRecorder ? (
          <DockButton
            icon={CircleDot}
            label={recording ? 'Recording' : 'Record'}
            active={recording}
            disabled={recording}
            onClick={() => void startCapture()}
          />
        ) : null}
        <DockButton
          icon={Presentation}
          label="Whiteboard"
          shared
          active={surface === 'board'}
          onClick={() => requestSurface('board')}
        />
        <DockButton
          icon={Code2}
          label="Code"
          shared
          active={surface === 'code'}
          onClick={() => requestSurface('code')}
        />
        <DockButton
          icon={MessageSquare}
          label={unread > 0 ? `Chat (${unread})` : 'Chat'}
          active={panel === 'chat'}
          onClick={() => setPanel((p) => (p === 'chat' ? null : 'chat'))}
        />
        <DockButton
          icon={Users}
          label="People"
          active={panel === 'people'}
          onClick={() => setPanel((p) => (p === 'people' ? null : 'people'))}
        />
        <DockButton
          icon={FileText}
          label="Question"
          active={panel === 'question'}
          onClick={() => setPanel((p) => (p === 'question' ? null : 'question'))}
        />
        {/* No "leave": the room is locked until it is ended. Only the host has
            an exit, and taking it ends the interview for everyone. */}
        {iv.canManage ? (
          <DockButton
            icon={Square}
            label="End for all"
            danger
            disabled={end.isPending}
            onClick={() => {
              if (confirm('End the interview for everyone?')) end.mutate();
            }}
          />
        ) : (
          <DockButton icon={Lock} label="Locked until ended" disabled onClick={() => undefined} />
        )}
      </MeetDock>

      {/* The candidate is told BEFORE any capture begins, and can walk away. */}
      {/* Someone is knocking. Shown to interviewers wherever they are looking —
          a waiting candidate is time-sensitive in a way a panel badge is not. */}
      {lobbyQueue.length > 0 && iv.canManage && admission === 'in' && !ended ? (
        <LobbyRequests waiting={lobbyQueue} onAdmit={admit} onDeny={deny} />
      ) : null}

      {isCandidate && !consentAcked && !ended ? (
        <RecordingConsentNotice
          onAcknowledge={() => setConsentAcked(true)}
          onDecline={leaveWithoutRecording}
        />
      ) : null}

      <FullscreenGate
        open={locked && !fullscreen.held}
        onEnter={fullscreen.request}
        refused={fullscreen.refused}
        title="This interview runs fullscreen"
        detail="The room needs the whole screen while the interview is live. It stays that way until the interviewer ends the session."
      />

      {/* Retired in favour of a newer tab. Shown above the admission gate because
          it is the more specific answer to "why is nothing happening here". */}
      {displaced && !ended ? (
        <div
          role="status"
          className="absolute inset-0 z-40 flex items-center justify-center bg-neutral-950 p-6 text-center"
        >
          <div className="max-w-sm">
            <DoorClosed className="mx-auto mb-4 h-8 w-8 text-white/60" aria-hidden="true" />
            <p className="text-[15px] font-medium text-white">You joined from another window</p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/60">
              This interview is open somewhere newer, so this window has left the room — one
              connection per person, or everybody sees two of you. Carry on in the other window.
            </p>
            <button
              type="button"
              onClick={onLeave}
              className="mt-5 rounded-lg border border-white/20 px-4 py-2 text-[13px] font-medium text-white/80 hover:bg-white/10"
            >
              Close this one
            </button>
          </div>
        </div>
      ) : null}

      {/* Until the door opens, the room behind this is empty by construction: the
          gateway sends a waiting socket no roster, no signaling and no chat. */}
      {admission !== 'in' && !ended ? (
        <AdmissionGate state={admission} hostName={iv.host.name} onGiveUp={onLeave} />
      ) : null}

      {ended ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/90 p-6 text-center">
          <div>
            <p className="text-[15px] font-medium text-white">This interview has ended.</p>
            <a
              href="/app/interviews"
              className="mt-4 inline-block rounded-lg bg-white px-4 py-2 text-[13px] font-medium text-neutral-900 hover:bg-white/90"
            >
              Back to interviews
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What a candidate sees between knocking and being let in.
 *
 * Deliberately a full cover rather than a banner: there is genuinely nothing
 * behind it yet, and a room that looks half-joined invites people to start
 * talking to an empty call.
 */
function AdmissionGate({
  state,
  hostName,
  onGiveUp,
}: {
  state: 'knocking' | 'waiting' | 'denied';
  hostName: string;
  onGiveUp: () => void;
}) {
  const denied = state === 'denied';
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex items-center justify-center bg-neutral-950 p-6 text-center"
    >
      <div className="max-w-sm">
        {denied ? (
          <>
            <DoorClosed className="mx-auto mb-4 h-8 w-8 text-white/60" aria-hidden="true" />
            <p className="text-[15px] font-medium text-white">You were not let in</p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/60">
              {hostName} did not admit you to this interview. If this is unexpected, contact your
              placement office — you can also ask to join again from the lobby.
            </p>
          </>
        ) : (
          <>
            <Loader2
              className="mx-auto mb-4 h-8 w-8 animate-spin text-white/60 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="text-[15px] font-medium text-white">Asking to be let in…</p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/60">
              {hostName} has been told you are here. You will join automatically the moment they
              admit you — keep this tab open.
            </p>
          </>
        )}
        <button
          type="button"
          onClick={onGiveUp}
          className="mt-5 rounded-lg border border-white/20 px-4 py-2 text-[13px] font-medium text-white/80 hover:bg-white/10"
        >
          {denied ? 'Back to the lobby' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

/**
 * The interviewer's side of the door. Sits above the dock as a card rather than
 * hiding in the People panel: someone is standing outside waiting on this exact
 * decision, and a badge they might not notice is not good enough.
 */
function LobbyRequests({
  waiting,
  onAdmit,
  onDeny,
}: {
  waiting: LobbyWaiter[];
  onAdmit: (peerId: string) => void;
  onDeny: (peerId: string) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-sm space-y-2 rounded-2xl border border-white/15 bg-neutral-900/95 p-3 shadow-xl backdrop-blur">
        {waiting.map((w) => (
          <div key={w.peerId} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <DoorOpen className="h-4 w-4 shrink-0 text-white/50" aria-hidden="true" />
              <p className="truncate text-[13px] text-white">
                <strong className="font-medium">{w.displayName}</strong> wants to join
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => onDeny(w.peerId)}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-white/60 hover:bg-white/10 hover:text-white"
              >
                Deny
              </button>
              <button
                type="button"
                onClick={() => onAdmit(w.peerId)}
                className="rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-900 hover:bg-white/90"
              >
                Admit
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Wall-clock since the room went live. */
function ElapsedClock({ startedAt }: { startedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <span className="hidden shrink-0 tabular-nums text-[12px] text-white/50 sm:inline">
      {mm}:{ss}
    </span>
  );
}

function PeopleList({ peers }: { peers: InterviewPeer[] }) {
  if (peers.length === 0) {
    return <p className="py-6 text-center text-[13px] text-white/45">You are the only one here.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {peers.map((p) => (
        <li
          key={p.peerId}
          className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-white/5"
        >
          <span className="truncate text-[13px] text-white">{p.displayName}</span>
          <span className="mono-label shrink-0 text-[9px] text-white/40">
            {p.role === 'CANDIDATE' ? 'Candidate' : 'Interviewer'}
          </span>
        </li>
      ))}
    </ul>
  );
}
