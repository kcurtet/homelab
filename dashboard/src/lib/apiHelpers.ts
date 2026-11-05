/**
 * Shared helpers for the action routes (task 5): JSON envelopes, body parsing
 * and the whitelist check every container-addressed endpoint performs.
 */
import { containerProject, findContainerByName, type NamedContainer } from './actions';

export function ok(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * POST body as a JSON object (never throws — an unparseable body is an empty
 * object, which the parser rejects as invalid).
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

export type WhitelistResult =
  | { container: NamedContainer }
  | { response: Response };

/**
 * Locate a container by name and require it to belong to a whitelisted phase.
 * This is the fence every container-addressed endpoint goes through: an
 * existing-but-foreign container is as rejected as a missing one.
 */
export function whitelistedContainer(
  containers: NamedContainer[],
  name: string,
  expectedProjects: string[],
): WhitelistResult {
  const target = findContainerByName(containers, name);
  if (!target) {
    return { response: fail(404, `container not found: ${name}`) };
  }
  const project = containerProject(target);
  if (!project || !expectedProjects.includes(project)) {
    return {
      response: fail(400, `container ${name} does not belong to a known phase (found: ${project ?? 'none'})`),
    };
  }
  return { container: target };
}
