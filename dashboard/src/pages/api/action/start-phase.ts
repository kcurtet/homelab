// POST /api/action/start-phase {project} — start every stopped container of a
// whitelisted phase (lifecycle of what exists; never creates anything).
import type { APIRoute } from 'astro';
import { containerProject, parseAction } from '../../../lib/actions';
import { fail, ok, readJsonBody } from '../../../lib/apiHelpers';
import { EXPECTED_PROJECTS } from '../../../lib/cards';
import { listContainers, startContainer } from '../../../lib/docker';
import { clearStatusCache } from '../../../lib/statusCache';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJsonBody(request);
  const parsed = parseAction({ ...body, kind: 'start-phase' }, EXPECTED_PROJECTS);
  if ('error' in parsed) return fail(400, parsed.error.message);
  if (parsed.kind !== 'start-phase') return fail(400, 'wrong action for this endpoint');

  try {
    const containers = await listContainers();
    const targets = containers.filter(
      (c) => containerProject(c) === parsed.project && c.State !== 'running',
    );
    // Already-running containers are untouched (docker start would 304).
    await Promise.all(targets.map((c) => startContainer(c.Id)));

    clearStatusCache();
    return ok({
      action: 'start-phase',
      project: parsed.project,
      started: targets.map((c) => (c.Names?.[0] ?? c.Id).replace(/^\//, '')),
    });
  } catch (error) {
    console.error('[api/action/start-phase] failed:', error);
    return fail(502, `start failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
