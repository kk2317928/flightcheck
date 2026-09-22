import { pathToFileURL } from 'node:url';
import {
  installWorkerSignalHandlers,
  runWorkerStartup,
  type WorkerRuntime,
} from './runtime.js';

export function startWorker(): WorkerRuntime {
  const runtime = runWorkerStartup();
  installWorkerSignalHandlers(runtime);
  return runtime;
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
)
  startWorker();
