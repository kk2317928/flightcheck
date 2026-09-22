type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;
type LogSink = (line: string) => void;

export type StructuredLogger = Readonly<{
  debug: (event: string, context?: LogContext) => void;
  error: (event: string, context?: LogContext) => void;
  info: (event: string, context?: LogContext) => void;
  warn: (event: string, context?: LogContext) => void;
}>;

type LoggerOptions = Readonly<{
  service: string;
  sink?: LogSink;
}>;

const SENSITIVE_KEY = /(authorization|cookie|password|secret|token)/i;
const REDACTED = '[REDACTED]';

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'function') {
    return '[Function]';
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redactValue(nestedValue, seen),
    ]),
  );
}

export function redactSensitiveFields(context: LogContext): LogContext {
  return redactValue(context, new WeakSet()) as LogContext;
}

export function createLogger({
  service,
  sink = (line) => process.stdout.write(`${line}\n`),
}: LoggerOptions): StructuredLogger {
  function write(
    level: LogLevel,
    event: string,
    context: LogContext = {},
  ): void {
    sink(
      JSON.stringify({
        ...redactSensitiveFields(context),
        timestamp: new Date().toISOString(),
        level,
        service,
        event,
      }),
    );
  }

  return {
    debug: (event, context) => write('debug', event, context),
    error: (event, context) => write('error', event, context),
    info: (event, context) => write('info', event, context),
    warn: (event, context) => write('warn', event, context),
  };
}
