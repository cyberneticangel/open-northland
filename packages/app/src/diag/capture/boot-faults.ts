import { REPORT_ID } from '@open-northland/data';
import { diag } from '../log.js';
import { reportProblem } from '../report/problem.js';
import { reportErrorOf } from './report-error.js';

/** What the recorder inline in `index.html` keeps until the app takes over. */
interface BootFaultRecorder {
  /** This page's faults before the app's capture installed. */
  readonly faults: unknown;
  /** Stop recording and forget the stored faults; returns the ones other pages kept and never handed
   *  over, as their app did not come up. */
  stop(): unknown;
}

declare global {
  interface Window {
    __onBootFaults?: BootFaultRecorder;
  }
}

interface BootFault {
  readonly id: string;
  readonly at: string;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly source?: string;
}

function parseFaults(value: unknown): BootFault[] {
  if (!Array.isArray(value)) return [];
  const faults: BootFault[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, at, name, message, stack, source } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !REPORT_ID.test(id) || typeof at !== 'string') continue;
    if (typeof name !== 'string' || typeof message !== 'string') continue;
    faults.push({
      id,
      at,
      name,
      message,
      ...(typeof stack === 'string' ? { stack } : {}),
      ...(typeof source === 'string' ? { source } : {}),
    });
  }
  return faults;
}

/** Take over from the inline recorder: this page's early faults are reported as this page's, and an
 *  earlier page's as that page's, with its time and id. Call once the app's own capture listens. */
export function takeBootFaults(): void {
  const recorder = window.__onBootFaults;
  if (recorder === undefined) return;
  const stored = recorder.stop();
  delete window.__onBootFaults;
  for (const fault of parseFaults(stored)) {
    reportProblem({
      trigger: 'error',
      error: reportErrorOf('main', fault, fault.source),
      earlier: { id: fault.id, at: fault.at, previousSession: true },
    });
  }
  for (const fault of parseFaults(recorder.faults)) {
    const error = reportErrorOf('main', fault, fault.source);
    diag.error('crash', `before boot: ${error.message}`, error);
    reportProblem({ trigger: 'error', error });
  }
}
