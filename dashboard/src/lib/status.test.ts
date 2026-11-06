import { describe, expect, it } from 'vitest';
import { aggregateProjects, type RawContainer } from './status';

const PROJECT_LABEL = 'com.docker.compose.project';

/** Minimal factory for a raw Docker API container entry (GET /containers/json?all=1). */
function raw(opts: {
  name: string;
  project?: string;
  state?: string;
  created?: number;
}): RawContainer {
  return {
    Id: `id-${opts.name}`,
    Names: [`/${opts.name}`],
    State: opts.state ?? 'running',
    Status: opts.state === 'running' ? 'Up 2 hours' : 'Exited (0) 5 minutes ago',
    Created: opts.created ?? Math.floor(Date.now() / 1000),
    Labels: opts.project ? { [PROJECT_LABEL]: opts.project } : {},
  };
}

describe('aggregateProjects', () => {
  it('all containers running → project is up', () => {
    const containers = [
      raw({ name: 'coolify', project: 'hosting' }),
      raw({ name: 'postgres', project: 'hosting' }),
    ];
    const [hosting] = aggregateProjects(containers, ['hosting']);
    expect(hosting.state).toBe('up');
    expect(hosting.containers).toHaveLength(2);
  });

  it('mix of running and exited containers → partial', () => {
    const containers = [
      raw({ name: 'coolify', project: 'hosting' }),
      raw({ name: 'soketi', project: 'hosting', state: 'exited' }),
    ];
    const [hosting] = aggregateProjects(containers, ['hosting']);
    expect(hosting.state).toBe('partial');
  });

  it('project exists with all containers exited → down', () => {
    const containers = [
      raw({ name: 'coolify', project: 'hosting', state: 'exited' }),
      raw({ name: 'postgres', project: 'hosting', state: 'exited' }),
    ];
    const [hosting] = aggregateProjects(containers, ['hosting']);
    expect(hosting.state).toBe('down');
  });

  it('expected project with zero containers → not-deployed', () => {
    const containers = [raw({ name: 'coolify', project: 'hosting' })];
    const projects = aggregateProjects(containers, ['hosting', 'network']);
    expect(projects.map((p) => [p.name, p.state])).toEqual([
      ['hosting', 'up'],
      ['network', 'not-deployed'],
    ]);
  });

  it('connection error flag → every expected project unreachable, no container list', () => {
    const projects = aggregateProjects(
      [raw({ name: 'coolify', project: 'hosting' })],
      ['hosting', 'network', 'dashboard'],
      { unreachable: true },
    );
    expect(projects.map((p) => [p.name, p.state, p.containers])).toEqual([
      ['hosting', 'unreachable', []],
      ['network', 'unreachable', []],
      ['dashboard', 'unreachable', []],
    ]);
  });

  it('routes containers by com.docker.compose.project label and ignores unlabeled/unexpected ones', () => {
    const containers = [
      raw({ name: 'coolify', project: 'hosting' }),
      raw({ name: 'adguardhome', project: 'network' }),
      raw({ name: 'orphan' }), // no project label → ignored
      raw({ name: 'other', project: 'some-other-project' }), // not expected → ignored
    ];
    const projects = aggregateProjects(containers, ['hosting', 'network']);
    expect(projects).toHaveLength(2);
    expect(projects[0]).toMatchObject({ name: 'hosting', state: 'up' });
    expect(projects[0].containers.map((c) => c.name)).toEqual(['coolify']);
    expect(projects[1]).toMatchObject({ name: 'network', state: 'up' });
    expect(projects[1].containers.map((c) => c.name)).toEqual(['adguardhome']);
  });

  it('exposes per-container name, state and startedAt (null when not running)', () => {
    const created = Math.floor(Date.parse('2025-11-05T10:00:00Z') / 1000);
    const containers = [
      raw({ name: 'coolify', project: 'hosting', created }),
      raw({ name: 'soketi', project: 'hosting', state: 'exited', created }),
    ];
    const [hosting] = aggregateProjects(containers, ['hosting']);
    const [coolify, soketi] = hosting.containers;
    expect(coolify.state).toBe('running');
    expect(coolify.startedAt).toBe('2025-11-05T10:00:00.000Z');
    expect(soketi.state).toBe('exited');
    expect(soketi.startedAt).toBeNull();
  });
});
