import type { APIRoute } from 'astro';
import { EXPECTED_PROJECTS } from '../../lib/cards';
import { getBackupStatus } from '../../lib/backupRunner';
import { inspectContainer, listContainers } from '../../lib/docker';
import { aggregateProjects } from '../../lib/status';
import { clearStatusCache, getStatusCache, setStatusCache, type StatusResponse } from '../../lib/statusCache';

export const prerender = false;

// Cache lives in lib/statusCache so the action routes can invalidate it.

/**
 * Refine startedAt with the real one from inspect. The list endpoint only
 * exposes Created (container creation), which never changes across restarts;
 * G3 wants the uptime to visibly reset. Best effort: on any inspect failure
 * the Created-based approximation from aggregateProjects stays.
 */
async function refineStartedAt(body: StatusResponse): Promise<void> {
  await Promise.all(
    body.projects.flatMap((p) =>
      p.containers
        .filter((c) => c.state === 'running')
        .map(async (c) => {
          try {
            const info = await inspectContainer(c.name);
            const started = new Date(info.State.StartedAt);
            if (!Number.isNaN(started.getTime())) c.startedAt = started.toISOString();
          } catch {
            // one flaky inspect never degrades the whole status page
          }
        }),
    ),
  );
}

function json(body: StatusResponse): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async () => {
  const cached = getStatusCache();
  if (cached) return json(cached);

  // Task 6: backup block (last snapshot via a cached probe container +
  // running flag). Owns its own error handling — a dead docker degrades
  // this to available:false instead of failing the whole status.
  const backup = await getBackupStatus();

  let body: StatusResponse;
  try {
    const containers = await listContainers();
    body = {
      projects: aggregateProjects(containers, EXPECTED_PROJECTS),
      backup,
      fetchedAt: new Date().toISOString(),
    };
    await refineStartedAt(body);
  } catch (error) {
    // Review focus 3: docker being down never 500s the UI — every card
    // degrades to 'unreachable' with HTTP 200.
    console.error(
      '[api/status] docker unreachable:',
      error instanceof Error ? error.message : String(error),
    );
    body = {
      projects: aggregateProjects([], EXPECTED_PROJECTS, { unreachable: true }),
      backup,
      fetchedAt: new Date().toISOString(),
    };
  }

  setStatusCache(body);
  return json(body);
};
