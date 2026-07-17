/** Error de aplicación con código y HTTP status */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    /** Si es true, el mensaje es seguro para mostrar al cliente */
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** Devuelve un mensaje seguro para el cliente */
export function toSafeMessage(err: unknown): string {
  if (err instanceof AppError && err.isOperational) return err.message;
  if (err instanceof Error) return 'Error interno del servidor';
  return 'Error desconocido';
}

/** Extrae el mensaje para logging (puede incluir stack) */
export function toLogMessage(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}
