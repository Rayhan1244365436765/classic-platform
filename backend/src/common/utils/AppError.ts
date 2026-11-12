/**
 * Typed application error.
 *
 * Lets services signal an expected failure (validation, conflict, auth) with the
 * HTTP status and machine-readable code the global error handler should emit,
 * instead of everything collapsing into a 500.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
