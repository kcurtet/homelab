import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPECTED_PROJECTS, parseExpectedProjects } from './cards';

describe('parseExpectedProjects', () => {
  it('falls back to the default list when unset', () => {
    expect(parseExpectedProjects(undefined)).toEqual(DEFAULT_EXPECTED_PROJECTS);
    expect(DEFAULT_EXPECTED_PROJECTS).toContain('hosting');
  });

  it('parses a comma-separated list, trimming and dropping empties', () => {
    expect(parseExpectedProjects(' hosting ,network, ,dashboard,')).toEqual([
      'hosting',
      'network',
      'dashboard',
    ]);
  });
});
