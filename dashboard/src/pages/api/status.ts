import type { APIRoute } from 'astro';
import { EXPECTED_PROJECTS } from '../../lib/cards';
import { listContainers } from '../../lib/docker';
import { aggregateProjects, type ProjectStatus } from '../../lib/status';

export const prerender = false;

interface StatusResponse {
  projects: ProjectStatus[];
  fetchedAt: string;
}

// In-memory cache (spec: no DB, state is "now") so concurrent polls don't
// hammer the socket-proxy. Module-level: one entry per endpoint, survives
// across requests within the node server process.
const TTL_MS = 10_000;
const cache = new Map<string, { body: StatusResponse; expiresAt: number }>();

function json(body: StatusResponse): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async () => {
  const now = Date.now();
  const cached = cache.get('status');
  if (cached && cached.expiresAt > now) {
    return json(cached.body);
  }

  let body: StatusResponse;
  try {
    const containers = await listContainers();
    body = {
      projects: aggregateProjects(containers, EXPECTED_PROJECTS),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Review focus 3: docker being down never 500s the UI — every card
    // degrades to 'unreachable' with HTTP 200.
    console.error(
      '[api/status] docker unreachable:',
      error instanceof Error ? error.message : String(error),
    );
    body = {
      projects: aggregateProjects([], EXPECTED_PROJECTS, { unreachable: true }),
      fetchedAt: new Date().toISOString(),
    };
  }

  cache.set('status', { body, expiresAt: now + TTL_MS });
  return json(body);
};
