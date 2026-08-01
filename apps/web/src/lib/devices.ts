import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The camera/microphone check behind the interview lobby — the "green room" every
 * video product has, for the reason every video product has one: the first thirty
 * seconds of a call are otherwise spent discovering that the wrong microphone is
 * selected, in front of the person deciding whether to hire you.
 *
 * The stream this hook acquires is the SAME object the room goes on to use. That
 * is the point of doing it here: the browser prompts for permission once, the
 * device you picked in the preview is the device you join on, and a muted mic in
 * the lobby is still muted when you walk in. `release()` hands ownership over.
 */

export type DevicePermission = 'prompt' | 'granted' | 'denied';

export interface DeviceCheck {
  /** Live preview stream. Null until permission resolves (or forever, if denied). */
  stream: MediaStream | null;
  permission: DevicePermission;
  /** Why the check failed, in words a candidate can act on. */
  error: string | null;
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  cameraId: string;
  micId: string;
  selectCamera: (deviceId: string) => void;
  selectMic: (deviceId: string) => void;
  micOn: boolean;
  camOn: boolean;
  toggleMic: () => void;
  toggleCam: () => void;
  /** Smoothed input level, 0–1 — proof the microphone actually hears you. */
  level: number;
  retry: () => void;
  /**
   * Give the stream to the caller and stop managing it, so unmounting the lobby
   * does not kill the tracks the room is about to join on.
   */
  release: () => MediaStream | null;
}

/** Turn a getUserMedia rejection into something worth reading. */
function describe(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera and microphone are blocked. Allow them in your browser’s address bar, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone found. Plug one in, then try again.';
    case 'NotReadableError':
      return 'Your camera or microphone is already in use by another app.';
    default:
      return 'Could not start your camera and microphone.';
  }
}

export function useDeviceCheck(): DeviceCheck {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [permission, setPermission] = useState<DevicePermission>('prompt');
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [level, setLevel] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const released = useRef(false);
  // Read inside the acquire effect without making it re-run on every toggle —
  // the toggles apply to live tracks directly, they must not re-prompt.
  const wanted = useRef({ micOn, camOn });
  wanted.current = { micOn, camOn };

  // ---- Acquire (and re-acquire when the chosen device changes) --------------
  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;

    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: cameraId ? { deviceId: { exact: cameraId } } : true,
          audio: micId ? { deviceId: { exact: micId } } : true,
        });
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = media;
        // Carry the lobby's mute state onto the new tracks.
        media.getAudioTracks().forEach((t) => (t.enabled = wanted.current.micOn));
        media.getVideoTracks().forEach((t) => (t.enabled = wanted.current.camOn));
        setStream(media);
        setPermission('granted');
        setError(null);

        // Labels are blank until permission is granted, so enumerate only now.
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCameras(devices.filter((d) => d.kind === 'videoinput'));
        setMicrophones(devices.filter((d) => d.kind === 'audioinput'));
      } catch (err) {
        if (cancelled) return;
        setStream(null);
        setPermission(
          err instanceof DOMException && err.name === 'NotAllowedError' ? 'denied' : 'prompt',
        );
        setError(describe(err));
      }
    })();

    return () => {
      cancelled = true;
      // The room owns the stream once released — do not stop its tracks.
      if (!released.current) acquired?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraId, micId, attempt]);

  // ---- Input level ----------------------------------------------------------
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track) {
      setLevel(0);
      return;
    }
    type AudioCtor = typeof AudioContext;
    const Ctor: AudioCtor | undefined =
      window.AudioContext ?? (window as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    source.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);

    // Sampled on a timer rather than requestAnimationFrame: this drives a React
    // state update, and 60 of those a second to move a meter is not a trade worth
    // making.
    const id = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const centred = (v - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / buf.length);
      // Muting silences the meter honestly — the track is disabled, so it reads 0.
      setLevel(Math.min(1, rms * 3));
    }, 100);

    return () => {
      clearInterval(id);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [stream]);

  const toggleMic = useCallback((): void => {
    setMicOn((on) => {
      const next = !on;
      stream?.getAudioTracks().forEach((t) => (t.enabled = next));
      return next;
    });
  }, [stream]);

  const toggleCam = useCallback((): void => {
    setCamOn((on) => {
      const next = !on;
      stream?.getVideoTracks().forEach((t) => (t.enabled = next));
      return next;
    });
  }, [stream]);

  const retry = useCallback((): void => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const release = useCallback((): MediaStream | null => {
    released.current = true;
    return stream;
  }, [stream]);

  return {
    stream,
    permission,
    error,
    cameras,
    microphones,
    cameraId,
    micId,
    selectCamera: setCameraId,
    selectMic: setMicId,
    micOn,
    camOn,
    toggleMic,
    toggleCam,
    level,
    retry,
    release,
  };
}
