import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('purge_all_keys.mjs guard', () => {
  it('refuses to run against key-collective-d1', () => {
    const result = spawnSync(
      'node',
      ['scripts/qa/purge_all_keys.mjs', '--db', 'key-collective-d1'],
      { cwd: process.cwd(), stdio: 'pipe', encoding: 'utf-8' },
    );

    expect(result.status).not.toBe(0);
  });
});
