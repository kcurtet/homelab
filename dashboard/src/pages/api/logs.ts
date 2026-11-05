// GET /api/logs?container=X&lines=200 — last N lines of a whitelisted-phase
// container (default 200, max 1000). Read-only, no follow, no exec.
import type { APIRoute } from 'astro';
import { fail, ok, whitelistedContainer } from '../../lib/apiHelpers';
import { EXPECTED_PROJECTS } from '../../lib/cards';
import { getContainerLogs, listContainers } from '../../lib/docker';

export const prerender = false;

const DEFAULT_LINES = 200;
const MAX_LINES = 1000;

function clampLines(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LINES;
  return Math.min(MAX_LINES, Math.trunc(n));
}

export const GET: APIRoute = async ({ url }) => {
  const name = url.searchParams.get('container')?.trim() ?? '';
  if (!name) return fail(400, 'missing container query parameter');
  const lines = clampLines(url.searchParams.get('lines'));

  try {
    const containers = await listContainers();
    const found = whitelistedContainer(containers, name, EXPECTED_PROJECTS);
    if ('response' in found) return found.response;

    const text = await getContainerLogs(found.container.Id, lines);
    return ok({
      container: name,
      lines,
      // Drop the trailing empty string after the last newline; render as-is.
      logs: text.length > 0 ? text.replace(/\n$/, '').split('\n') : [],
    });
  } catch (error) {
    console.error('[api/logs] failed:', error);
    return fail(502, `logs failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
