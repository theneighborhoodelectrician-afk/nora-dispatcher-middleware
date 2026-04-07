export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly publicMessage = message,
  ) {
    super(message);
  }
}

export class ExternalServiceError extends AppError {
  constructor(
    message: string,
    publicMessage = "We hit a scheduling issue. Please try again.",
    public readonly details?: unknown,
  ) {
    super(message, 502, publicMessage);
  }
}
