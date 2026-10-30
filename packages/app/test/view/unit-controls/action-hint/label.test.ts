import { describe, expect, it } from 'vitest';
import { formatMessage, messages } from '../../../../src/i18n/index.js';
import { hintLine } from '../../../../src/view/unit-controls/action-hint/label.js';

const SMITH_JOB = 1013;
const jobName = (jobType: number): string => `job ${jobType}`;

describe('the right-click label', () => {
  it('puts the named thing before the verb, and the new trade in brackets', () => {
    const words = messages().hud.actionHint;
    const gather = { tone: 'action', action: 'gather', job: null, target: null } as const;
    expect(hintLine('Iron', gather, jobName)).toEqual({ text: `Iron · ${words.gather}`, muted: false });
    expect(hintLine('Iron', null, jobName)).toEqual({ text: 'Iron', muted: false });
    expect(hintLine(null, null, jobName)).toBeNull();
    const work = { tone: 'action', action: 'work', job: SMITH_JOB, target: null } as const;
    expect(hintLine(null, work, jobName)?.text).toBe(
      formatMessage(words.workAs, { job: `job ${SMITH_JOB}` }),
    );
  });

  it('mutes a refusal', () => {
    const full = { tone: 'refusal', refusal: 'noFreePlaces' } as const;
    expect(hintLine(null, full, jobName)).toEqual({
      text: messages().hud.actionHint.noFreePlaces,
      muted: true,
    });
  });
});
