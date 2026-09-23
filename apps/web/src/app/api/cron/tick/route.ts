import { createWorkerServices } from '@flightcheck/worker/composition';
import { createCronDispatch } from '../../../../lib/cron/dispatch';
import { normalizeWebRuntimeEnvironment } from '../../../../lib/runtime-env';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = createCronDispatch({
  secret: process.env.CRON_SECRET,
  now: () => new Date(),
  buildServices: () =>
    createWorkerServices(normalizeWebRuntimeEnvironment(process.env)),
});
