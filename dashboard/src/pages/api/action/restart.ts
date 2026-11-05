// POST /api/action/restart {container} — restart ONE container.
//
// Whitelisted twice: the container must exist AND belong to one of the
// expected compose phases. Nothing else about the body reaches docker.
import type { APIRoute } from 'astro';
import { parseAction, type NamedContainer } from '../../../lib/actions';
import { fail, ok, readJsonBody, whitelistedContainer } from '../../../lib/apiHelpers';
import { EXPECTED_PROJECTS } from '../../../lib/cards';
import { listContainers, restartContainer } from '../../../lib/docker';
import { clearStatusCache } from '../../../lib/statusCache';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJsonBody(request);
  // The URL fixes the action kind; a client cannot smuggle another one in.
  const parsed = parseAction({ ...body, kind: 'restart' }, EXPECTED_PROJECTS);
  if ('error' in parsed) return fail(400, parsed.error.message);
  if (parsed.kind !== 'restart') return fail(400, 'wrong action for this endpoint');

  let container: NamedContainer;
  try {
    const containers = await listContainers();
    const found = whitelistedContainer(containers, parsed.container, EXPECTED_PROJECTS);
    if ('response' in found) return found.response;
    container = found.container;
    await restartContainer(container.Id);
  } catch (error) {
    console.error('[api/action/restart] failed:', error);
    return fail(502, `restart failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  clearStatusCache();
  return ok({ action: 'restart', container: parsed.container });
};
