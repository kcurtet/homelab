/**
 * Expected projects (the "phases" of the homelab, Task 1 names) that get a
 * card even when they have zero containers ('not-deployed' must be visible).
 */
import type { ProjectState, ProjectStatus, ContainerStatus, RawContainer } from './status';

export type { ProjectState, ProjectStatus, ContainerStatus, RawContainer };
export { aggregateProjects, PROJECT_LABEL } from './status';

export const DEFAULT_EXPECTED_PROJECTS = ['hosting', 'network', 'dashboard'];

/** Parse `EXPECTED_PROJECTS` (comma-separated) with sane trimming. Pure. */
export function parseExpectedProjects(raw: string | undefined): string[] {
  if (!raw) return [...DEFAULT_EXPECTED_PROJECTS];
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_EXPECTED_PROJECTS];
}

/**
 * Runtime env first (node adapter container: DOCKER_HOST-style ops), then
 * Astro's build/dev-time env (dev reads .env), then the default list.
 */
export const EXPECTED_PROJECTS: string[] = parseExpectedProjects(
  process.env.EXPECTED_PROJECTS ?? import.meta.env.EXPECTED_PROJECTS,
);
