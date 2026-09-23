import {
  createFlightQueryRepository,
  createPrismaClient,
} from '@flightcheck/db';
import { validateWebEnvironment } from '../runtime-env';
import { createFlightQueryService } from './query-service';
let service: ReturnType<typeof createFlightQueryService> | undefined;
export function getFlightQueryService() {
  service ??= createFlightQueryService(
    createFlightQueryRepository(
      createPrismaClient(validateWebEnvironment().DATABASE_URL),
    ),
  );
  return service;
}
