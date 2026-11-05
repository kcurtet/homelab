import { PROJECT_LABEL } from './status';

/**
 * Pure parsing/validation of dashboard action requests (task 5).
 *
 * The whitelist doctrine of spec 002 lives here: the ONLY actions the API
 * accepts are restart-container / stop-phase / start-phase, phases must be in
 * EXPECTED_PROJECTS, and stopping `hosting` (which fronts public publishing
 * via cloudflared) requires an explicit `confirm: true`. No action carries a
 * command, image or arbitrary payload — there is nothing to inject.
 */

export type ActionKind = 'restart' | 'stop-phase' | 'start-phase';

export type ActionErrorCode =
  | 'INVALID_BODY'
  | 'UNKNOWN_ACTION'
  | 'MISSING_CONTAINER'
  | 'UNKNOWN_PROJECT'
  | 'CONFIRM_REQUIRED';

export interface ActionError {
  code: ActionErrorCode;
  message: string;
}

export type ParsedAction =
  | { kind: 'restart'; container: string }
  | { kind: 'stop-phase'; project: string; confirm: boolean }
  | { kind: 'start-phase'; project: string };

export type ParseActionResult = ParsedAction | { error: ActionError };

export interface NamedContainer {
  Id: string;
  Names: string[];
  State: string;
  Labels: Record<string, string> | undefined;
}

/** Match a container by name (or exact id), docker `Names` leading slash aside. Pure. */
export function findContainerByName<T extends NamedContainer>(containers: T[], name: string): T | undefined {
  const wanted = name.trim().replace(/^\//, '');
  return containers.find(
    (c) => c.Id === wanted || c.Names?.some((n) => n.replace(/^\//, '') === wanted),
  );
}

/** The compose-project label value, if any. Pure. */
export function containerProject(c: NamedContainer): string | undefined {
  return c.Labels?.[PROJECT_LABEL];
}

/**
 * Phases whose stop takes down something public. Today: hosting includes
 * cloudflared, so stopping it drops the tunnel (spec decision).
 */
export const STOP_CONFIRM_PROJECTS = ['hosting'];

/** Spec copy for the confirm gate (exact message asserted by tests + e2e). */
export function stopConfirmMessage(project: string): string {
  return `stopping ${project} takes down public publishing — pass confirm:true`;
}

function invalid(message: string): { error: ActionError } {
  return { error: { code: 'INVALID_BODY', message } };
}

/**
 * Parse and whitelist-check one action body. Pure: no IO, no docker client.
 * Routes inject the kind server-side (the URL decides the action), so a
 * client cannot ask `/api/action/restart` to perform a phase stop.
 */
export function parseAction(body: unknown, expectedProjects: string[]): ParseActionResult {
  if (typeof body !== 'object' || body === null) {
    return invalid('body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const kind = b.kind as string;

  if (kind === 'restart') {
    const container = typeof b.container === 'string' ? b.container.trim() : '';
    if (!container) {
      return { error: { code: 'MISSING_CONTAINER', message: 'missing container' } };
    }
    return { kind: 'restart', container };
  }

  if (kind === 'stop-phase' || kind === 'start-phase') {
    const project = typeof b.project === 'string' ? b.project.trim() : '';
    if (!project || !expectedProjects.includes(project)) {
      return {
        error: {
          code: 'UNKNOWN_PROJECT',
          message: `unknown project: ${project || '(empty)'} — expected one of ${expectedProjects.join(', ')}`,
        },
      };
    }
    if (kind === 'stop-phase') {
      const confirm = b.confirm === true;
      if (!confirm && STOP_CONFIRM_PROJECTS.includes(project)) {
        return { error: { code: 'CONFIRM_REQUIRED', message: stopConfirmMessage(project) } };
      }
      return { kind: 'stop-phase', project, confirm };
    }
    return { kind: 'start-phase', project };
  }

  return {
    error: {
      code: 'UNKNOWN_ACTION',
      message: `unknown action: ${String(kind)} — the whitelist is restart, stop-phase, start-phase`,
    },
  };
}
