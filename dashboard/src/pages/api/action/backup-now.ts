// POST /api/action/backup-now — spawn the one-shot backup container.
//
// The button does NOT run a backup itself: it creates + starts a container
// from the fixed spec (lib/backup.ts) that executes the repo's own
// backup/restic/backup.sh — same script as the systemd timer, same mounted
// /etc/homelab/backup.env, so the scope is identical by construction.
//
// Responses: 200 {ok, started}; 409 while a manual backup is already running
// (lock semantics); 503 when host prerequisites are missing (staging case:
// no /mnt/backup or /etc/homelab — the UI keeps the button disabled).
import type { APIRoute } from 'astro';
import { backupNow } from '../../../lib/backupRunner';
import { fail, ok } from '../../../lib/apiHelpers';
import { clearStatusCache } from '../../../lib/statusCache';

export const prerender = false;

export const POST: APIRoute = async () => {
  let result;
  try {
    result = await backupNow();
  } catch (error) {
    console.error('[api/action/backup-now] failed:', error);
    return fail(502, `backup-now failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  switch (result.status) {
    case 'started':
      clearStatusCache(); // next poll must show running:true
      return ok({ action: 'backup-now', started: true });
    case 'conflict':
      return fail(409, result.message);
    case 'unavailable':
      return fail(503, result.message);
    default:
      return fail(502, result.message);
  }
};
