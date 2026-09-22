import { randomUUID } from 'node:crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const VALID_JOB_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function createCorrelationId(prefix: 'request' | 'job'): string {
  return `${prefix}:${randomUUID()}`;
}

export function getOrCreateRequestCorrelationId(headers: Headers): string {
  const incoming = headers.get(CORRELATION_ID_HEADER);
  return incoming && VALID_CORRELATION_ID.test(incoming)
    ? incoming
    : createCorrelationId('request');
}

export function createJobCorrelationId(jobName: string): string {
  if (!VALID_JOB_NAME.test(jobName)) {
    throw new TypeError(
      'jobName must contain only lowercase letters, numbers, dot, dash or underscore',
    );
  }

  return `job:${jobName}:${randomUUID()}`;
}
