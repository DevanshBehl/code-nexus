/**
 * Typed application error. Carries an HTTP status and a stable machine `code`
 * so the error-handling middleware can render the canonical error envelope.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { expose?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    // `expose` decides whether `message` is safe to send to the client.
    this.expose = options.expose ?? statusCode < 500;
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static serviceUnavailable(message = 'Service unavailable'): AppError {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }
}
