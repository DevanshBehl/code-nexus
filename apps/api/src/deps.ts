import type { Logger } from '@code-nexus/logger';
import type { SessionStore } from '@code-nexus/auth';
import type { AppConfig } from '@code-nexus/config';
import type { Publisher } from '@code-nexus/mq';
import type { RecordingStorage } from './modules/recordings/recordings.storage.js';

/**
 * The real-time fan-out bus (Phase 8 webinars + Phase 9 interviews). The api
 * PUBLISHES host-originated events to a room channel (e.g. `webinar:<id>` /
 * `interview:<id>`); the ws-gateway subscribes and relays them to the live room.
 * `null` when Redis pub/sub is unavailable — the api still persists everything;
 * only the live push is lost. The bus is channel-agnostic: callers build the
 * channel (via `webinarChannel`/`interviewChannel`) and the event.
 */
export interface RoomBus {
  publish(channel: string, event: unknown): Promise<void>;
}

/** Dependencies injected into the app factory and router factories. */
export interface ApiDeps {
  logger: Logger;
  config: AppConfig;
  sessionStore: SessionStore;
  /**
   * Phase 6 — Code Arena job publisher. `null` when RabbitMQ is unavailable; the
   * arena routes then return 503 (the rest of the API is unaffected). The API
   * NEVER executes code — it only publishes jobs for the execution-worker.
   */
  publisher: Publisher | null;
  /** Phase 8/9 — real-time room event bus (Redis pub/sub). `null` if unavailable. */
  roomBus: RoomBus | null;
  /**
   * Phase 10 — interview-recording storage (local disk or S3/MinIO). `null` when
   * the driver could not initialize; the recording routes then return 503 while
   * live interviews and the rest of the platform continue unaffected.
   */
  recordingStorage: RecordingStorage | null;
}
