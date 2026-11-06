import { describe, expect, it } from 'vitest';
import {
  containerProject,
  findContainerByName,
  parseAction,
  stopConfirmMessage,
} from './actions';
import { PROJECT_LABEL, type RawContainer } from './status';

const PROJECTS = ['hosting', 'network', 'dashboard'];

function named(name: string, project?: string): RawContainer {
  return {
    Id: `id-${name}`,
    Names: [`/${name}`],
    State: 'running',
    Status: 'Up',
    Created: 0,
    Labels: project ? { [PROJECT_LABEL]: project } : {},
  };
}

describe('parseAction', () => {
  // Review focus 2: stopping hosting without an explicit confirm is the one
  // dangerous action in the whitelist — it takes down public publishing.
  describe('stop-phase confirm gate (hosting)', () => {
    it('hosting without confirm → CONFIRM_REQUIRED with the exact message', () => {
      const result = parseAction({ kind: 'stop-phase', project: 'hosting' }, PROJECTS);
      expect(result).toEqual({
        error: {
          code: 'CONFIRM_REQUIRED',
          message: 'stopping hosting takes down public publishing — pass confirm:true',
        },
      });
    });

    it('hosting with confirm:false is still refused (must be exactly true)', () => {
      const result = parseAction(
        { kind: 'stop-phase', project: 'hosting', confirm: false },
        PROJECTS,
      );
      expect('error' in result && result.error.code).toBe('CONFIRM_REQUIRED');
    });

    it('hosting with confirm:true passes the gate', () => {
      const result = parseAction(
        { kind: 'stop-phase', project: 'hosting', confirm: true },
        PROJECTS,
      );
      expect(result).toEqual({ kind: 'stop-phase', project: 'hosting', confirm: true });
    });

    it('other phases stop without a confirm (no public publishing at stake)', () => {
      const result = parseAction({ kind: 'stop-phase', project: 'network' }, PROJECTS);
      expect(result).toEqual({ kind: 'stop-phase', project: 'network', confirm: false });
    });
  });

  describe('whitelist', () => {
    it('stop-phase with a project outside the whitelist → UNKNOWN_PROJECT', () => {
      const result = parseAction({ kind: 'stop-phase', project: 'evil' }, PROJECTS);
      expect('error' in result && result.error.code).toBe('UNKNOWN_PROJECT');
    });

    it('start-phase with a project outside the whitelist → UNKNOWN_PROJECT', () => {
      const result = parseAction({ kind: 'start-phase', project: 'some-other' }, PROJECTS);
      expect('error' in result && result.error.code).toBe('UNKNOWN_PROJECT');
    });

    it('an empty project is unknown, not valid', () => {
      const result = parseAction({ kind: 'start-phase', project: '  ' }, PROJECTS);
      expect('error' in result && result.error.code).toBe('UNKNOWN_PROJECT');
    });
  });

  describe('restart', () => {
    it('missing container → MISSING_CONTAINER', () => {
      const result = parseAction({ kind: 'restart' }, PROJECTS);
      expect('error' in result && result.error.code).toBe('MISSING_CONTAINER');
    });

    it('blank container → MISSING_CONTAINER', () => {
      const result = parseAction({ kind: 'restart', container: '   ' }, PROJECTS);
      expect('error' in result && result.error.code).toBe('MISSING_CONTAINER');
    });

    it('valid restart returns {kind, container} (trimmed)', () => {
      const result = parseAction({ kind: 'restart', container: ' coolify ' }, PROJECTS);
      expect(result).toEqual({ kind: 'restart', container: 'coolify' });
    });
  });

  describe('valid phase actions', () => {
    it('start-phase of a whitelisted project → {kind, project}', () => {
      const result = parseAction({ kind: 'start-phase', project: 'dashboard' }, PROJECTS);
      expect(result).toEqual({ kind: 'start-phase', project: 'dashboard' });
    });
  });

  describe('malformed input', () => {
    it('non-object body → INVALID_BODY', () => {
      expect('error' in (parseAction(null, PROJECTS) as object) && (parseAction(null, PROJECTS) as { error: { code: string } }).error.code).toBe('INVALID_BODY');
      expect('error' in (parseAction('restart', PROJECTS) as object) && (parseAction('restart', PROJECTS) as { error: { code: string } }).error.code).toBe('INVALID_BODY');
    });

    it('unknown kind → UNKNOWN_ACTION', () => {
      const result = parseAction({ kind: 'exec', container: 'x' }, PROJECTS);
      expect('error' in result && result.error.code).toBe('UNKNOWN_ACTION');
    });
  });
});

describe('stopConfirmMessage', () => {
  it('names the project in the spec copy', () => {
    expect(stopConfirmMessage('hosting')).toBe(
      'stopping hosting takes down public publishing — pass confirm:true',
    );
  });
});

describe('findContainerByName / containerProject', () => {
  const containers = [named('coolify', 'hosting'), named('adguardhome', 'network')];

  it('matches by name (leading slash tolerated) and by exact id', () => {
    expect(findContainerByName(containers, 'coolify')?.Id).toBe('id-coolify');
    expect(findContainerByName(containers, '/coolify')?.Id).toBe('id-coolify');
    expect(findContainerByName(containers, 'id-adguardhome')?.Id).toBe('id-adguardhome');
    expect(findContainerByName(containers, 'nope')).toBeUndefined();
  });

  it('exposes the compose project label', () => {
    expect(containerProject(containers[0])).toBe('hosting');
    expect(containerProject(named('orphan'))).toBeUndefined();
  });
});
