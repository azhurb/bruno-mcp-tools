export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.name = 'AppError';
  }
}

export function assert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) {
    throw new AppError(code, message);
  }
}
