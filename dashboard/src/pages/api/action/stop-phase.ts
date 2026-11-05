// POST /api/action/stop-phase {project, confirm?} — stop every container of a
// phase. Stopping `hosting` drops cloudflared (public publishing): the parser
// refuses it without an explicit confirm:true (review focus 2).
import type { APIRoute } from 'astro';
import { containerProject, parseAction } from '../../../lib/actions';
import { fail, ok, readJsonBody } from '../../../lib/apiHelpers';
import { EXPECTED_PROJECTS } from '../../../lib/cards';
import { listContainers, stopContainer } from '../../../lib/docker';
import { clearStatusCache } from '../../../lib/statusCache';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJsonBody(request);
  const parsed = parseAction({ ...body, kind: 'stop-phase' }, EXPECTED_PROJECTS);
  if ('error' in parsed) return fail(400, parsed.error.message);
  if (parsed.kind !== 'stop-phase') return fail(400, 'wrong action for this endpoint');

  try {
    const containers = await listContainers();
    const targets = containers.filter(
      (c) => containerProject(c) === parsed.project && c.State === 'running',
    );
    // Idempotent: already-stopped containers are left alone (docker stop on a
    // stopped container answers 304, which dockerode reports as an error).
    await Promise.all(targets.map((c) => stopContainer(c.Id)));

    clearStatusCache();
    return ok({
      action: 'stop-phase',
      project: parsed.project,
      stopped: targets.map((c) => (c.Names?.[0] ?? c.Id).replace(/^\//, '')),
    });
  } catch (error) {
    console.error('[api/action/stop-phase] failed:', error);
    return fail(502, `stop failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
