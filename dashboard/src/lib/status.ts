/**
 * Pure aggregation: raw Docker API containers → per-project card status.
 * No IO here — docker.ts fetches, the API route caches, tests stay deterministic.
 */

/** Subset of GET /containers/json?all=1 entries that we consume. */
export interface RawContainer {
  Id: string;
  Names: string[];
  State: string; // 'running' | 'exited' | 'created' | 'paused' | ...
  Status: string; // human string, e.g. "Up 2 hours"
  Created: number; // unix seconds
  Labels: Record<string, string>;
}

/** A phase == a compose project, identified by this label (Task 1 decision). */
export const PROJECT_LABEL = 'com.docker.compose.project';

export type ProjectState = 'up' | 'partial' | 'down' | 'not-deployed' | 'unreachable';

export interface ContainerStatus {
  name: string;
  state: string; // raw docker state, e.g. 'running' / 'exited'
  startedAt: string | null; // ISO; null when the container is not running
}

export interface ProjectStatus {
  name: string;
  state: ProjectState;
  containers: ContainerStatus[];
}

export interface AggregateOptions {
  /** Docker/socket-proxy unreachable: report every expected project degraded. */
  unreachable?: boolean;
}

/**
 * Aggregate containers into one ProjectStatus per expected project.
 *
 * Card state = worst of the project's containers (spec decision: soketi dead →
 * hosting degrades, never a lying all-green): all running → 'up', mix →
 * 'partial', none running → 'down', zero containers → 'not-deployed'.
 */
export function aggregateProjects(
  containers: RawContainer[],
  expected: string[],
  opts: AggregateOptions = {},
): ProjectStatus[] {
  if (opts.unreachable) {
    return expected.map((name) => ({ name, state: 'unreachable', containers: [] }));
  }

  const byProject = new Map<string, ContainerStatus[]>(
    expected.map((name) => [name, [] as ContainerStatus[]]),
  );

  for (const c of containers) {
    const project = c.Labels?.[PROJECT_LABEL];
    // Only expected projects are shown; unlabeled/foreign containers are ignored.
    if (!project || !byProject.has(project)) continue;
    byProject.get(project)!.push({
      name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
      state: c.State,
      // The list endpoint only exposes Created; for compose-managed containers
      // that is effectively the start time. Refine via inspect in T5 if needed.
      startedAt: c.State === 'running' ? new Date(c.Created * 1000).toISOString() : null,
    });
  }

  return expected.map((name) => {
    const projectContainers = byProject.get(name)!;
    let state: ProjectState;
    if (projectContainers.length === 0) {
      state = 'not-deployed';
    } else if (projectContainers.every((c) => c.state === 'running')) {
      state = 'up';
    } else if (projectContainers.some((c) => c.state === 'running')) {
      state = 'partial';
    } else {
      state = 'down';
    }
    return { name, state, containers: projectContainers };
  });
}
