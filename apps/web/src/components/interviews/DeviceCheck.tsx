import { useEffect, useRef } from 'react';
import { AlertTriangle, Mic, MicOff, Video as VideoIcon, VideoOff } from 'lucide-react';
import type { DeviceCheck } from '../../lib/devices.ts';

/**
 * The self-view panel of the lobby: your camera, your microphone level, and the
 * two toggles — exactly the state you will walk into the room with.
 *
 * The mic meter is not ornamental. "Can you hear me?" is the most common first
 * minute of any interview, and a bar that moves when you speak answers it before
 * anyone has to ask.
 */
export function DeviceCheckPanel({ check }: { check: DeviceCheck }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = check.stream;
    if (check.stream) void el.play().catch(() => undefined);
  }, [check.stream]);

  const showPreview = !!check.stream && check.camOn;

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-neutral-900">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-label="Your camera preview"
          className={`h-full w-full object-cover ${showPreview ? '' : 'invisible'}`}
        />
        {!showPreview ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            {check.error ? (
              <>
                <AlertTriangle className="h-6 w-6 text-amber-400" aria-hidden="true" />
                <p className="text-[13px] leading-relaxed text-white/70">{check.error}</p>
                <button
                  type="button"
                  onClick={check.retry}
                  className="mt-1 rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-900 hover:bg-white/90"
                >
                  Try again
                </button>
              </>
            ) : check.stream ? (
              <p className="text-[13px] text-white/60">Camera is off</p>
            ) : (
              <p className="text-[13px] text-white/60">Starting your camera…</p>
            )}
          </div>
        ) : null}

        {/* Toggles sit on the preview, where they will be in the room. */}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-3">
          <PreviewToggle
            on={check.micOn}
            onIcon={Mic}
            offIcon={MicOff}
            label={check.micOn ? 'Turn off microphone' : 'Turn on microphone'}
            onClick={check.toggleMic}
            disabled={!check.stream}
          />
          <PreviewToggle
            on={check.camOn}
            onIcon={VideoIcon}
            offIcon={VideoOff}
            label={check.camOn ? 'Turn off camera' : 'Turn on camera'}
            onClick={check.toggleCam}
            disabled={!check.stream}
          />
        </div>
      </div>

      <MicMeter level={check.level} muted={!check.micOn} active={!!check.stream} />

      <div className="grid gap-2 sm:grid-cols-2">
        <DevicePicker
          label="Microphone"
          devices={check.microphones}
          value={check.micId}
          onChange={check.selectMic}
          fallback="Default microphone"
        />
        <DevicePicker
          label="Camera"
          devices={check.cameras}
          value={check.cameraId}
          onChange={check.selectCamera}
          fallback="Default camera"
        />
      </div>
    </div>
  );
}

function PreviewToggle({
  on,
  onIcon: OnIcon,
  offIcon: OffIcon,
  label,
  onClick,
  disabled,
}: {
  on: boolean;
  onIcon: typeof Mic;
  offIcon: typeof MicOff;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        on ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-red-600 text-white hover:bg-red-500'
      }`}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}

/** Twelve segments that light up with your voice. */
function MicMeter({ level, muted, active }: { level: number; muted: boolean; active: boolean }) {
  const segments = 12;
  const lit = muted || !active ? 0 : Math.round(level * segments);
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <span className="mono-label w-16 shrink-0 text-[9px] text-faint">
        {muted ? 'Muted' : 'Mic'}
      </span>
      <div className="flex flex-1 gap-1">
        {Array.from({ length: segments }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < lit ? 'bg-emerald-500' : 'bg-surface-2'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function DevicePicker({
  label,
  devices,
  value,
  onChange,
  fallback,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  fallback: string;
}) {
  return (
    <label className="block">
      <span className="mono-label mb-1 block text-[9px] text-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={devices.length === 0}
        className="w-full truncate rounded-lg border border-line-strong bg-surface-2 px-2.5 py-2 text-[13px] text-fg focus:border-accent focus:outline-none disabled:opacity-50"
      >
        <option value="">{fallback}</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${d.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
    </label>
  );
}
