import { pathToFileURL } from 'node:url';
import {
  installWorkerSignalHandlers,
  runWorkerStartup,
  type WorkerRuntime,
} from './runtime.js';

export async function startWorker(): Promise<WorkerRuntime> {
  const runtime = await runWorkerStartup();
  installWorkerSignalHandlers(runtime);
  return runtime;
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
)
  void startWorker();
