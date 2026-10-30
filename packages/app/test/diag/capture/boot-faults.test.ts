// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { takeBootFaults } from '../../../src/diag/capture/boot-faults.js';
import { type Problem, setProblemSink } from '../../../src/diag/report/problem.js';

const reported: Problem[] = [];

/** The pre-boot recorder inline in `index.html`, the page's first script. */
const recorderSource = (() => {
  const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (script === undefined) throw new Error('index.html has no inline recorder');
  return script;
})();

/** One page's start: its recorder installs, as `index.html` runs it. */
function startPage(): NonNullable<Window['__onBootFaults']> {
  new Function(recorderSource)();
  const recorder = window.__onBootFaults;
  if (recorder === undefined) throw new Error('the recorder did not install');
  return recorder;
}

function reject(reason: unknown): void {
  const event = new Event('unhandledrejection') as Event & { reason: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
}

function errorWithStack(message: string, frame: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}\n    at f (${frame})`;
  return error;
}

const OWN_FRAME = `${location.origin}/src/main.ts:1:1`;
const EXTENSION_FRAME = 'chrome-extension://abc/inject.js:1:1';

describe('boot faults', () => {
  let recorders: NonNullable<Window['__onBootFaults']>[] = [];
  const page = (): NonNullable<Window['__onBootFaults']> => {
    const recorder = startPage();
    recorders.push(recorder);
    return recorder;
  };

  beforeAll(() => setProblemSink((problem) => reported.push(problem)));
  beforeEach(() => {
    localStorage.clear();
    reported.length = 0;
  });
  afterEach(() => {
    for (const recorder of recorders) recorder.stop();
    recorders = [];
    delete window.__onBootFaults;
  });

  it('keeps a rejection from the game and drops one from another origin', () => {
    const recorder = page();
    reject(errorWithStack('extension', EXTENSION_FRAME));
    reject(errorWithStack('game', OWN_FRAME));
    expect(recorder.faults).toMatchObject([{ name: 'Error', message: 'game' }]);
  });

  it('forgets what fails after the page started to go away', () => {
    page();
    window.dispatchEvent(new Event('pagehide'));
    reject(errorWithStack('teardown', OWN_FRAME));
    page();
    takeBootFaults();
    expect(reported).toEqual([]);
  });

  it('keeps recording when the page comes back from the back-forward cache', () => {
    const recorder = page();
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    reject(errorWithStack('restored', OWN_FRAME));
    expect(recorder.faults).toMatchObject([{ message: 'restored' }]);
  });

  it("reports a page's fault as an earlier session's when that page never came up", () => {
    page();
    reject(errorWithStack('gone', OWN_FRAME));
    page();
    takeBootFaults();
    expect(reported).toMatchObject([{ trigger: 'error', earlier: { previousSession: true } }]);
  });

  it('leaves a fault to the tab that kept it when that tab came up meanwhile', () => {
    const first = page();
    reject(errorWithStack('booting', OWN_FRAME));
    page();
    first.stop();
    takeBootFaults();
    expect(reported).toEqual([]);
  });
});
