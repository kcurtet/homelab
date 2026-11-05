/**
 * Minimal Docker API client: list + inspect (status) and the whitelisted
 * lifecycle actions restart/stop/start + logs (task 5). Nothing else — no
 * exec, no build, no create.
 *
 * Client choice: dockerode. It speaks both unix:// (podman rootless socket for
 * local dev on lynx) and tcp:// (tecnativa socket-proxy in production) behind
 * one API, and task 5 (restart/stop/logs) reuses it. Plain fetch cannot talk
 * to unix sockets without an extra undici dependency.
 */
import Docker from 'dockerode';
import type { RawContainer } from './status';

/** Rootless podman socket on the dev machine (lynx); prod sets DOCKER_HOST=tcp://socket-proxy:2375. */
const DEV_FALLBACK_HOST = 'unix:///run/user/1000/podman/podman.sock';

export interface DockerHost {
  socketPath?: string;
  host?: string;
  port?: number;
}

/** Parse DOCKER_HOST (`unix:///path`, `tcp://host:port`, `http://host:port`). Pure. */
export function parseDockerHost(raw: string | undefined): DockerHost {
  const value = raw?.trim() || DEV_FALLBACK_HOST;
  const url = new URL(value);
  if (url.protocol === 'unix:' || url.protocol === 'http+unix:') {
    return { socketPath: url.pathname };
  }
  if (url.protocol === 'tcp:' || url.protocol === 'http:') {
    return { host: url.hostname, port: Number(url.port) || 2375 };
  }
  throw new Error(`unsupported DOCKER_HOST protocol: ${value}`);
}

let clients: Map<number, Docker> | null = null;

/**
 * One client per timeout. Status reads want a fast 3s bail-out so a dead
 * socket degrades the page quickly; lifecycle actions are patient (a stop
 * waits out its grace period — podman's compat API can sit silent ~10s and a
 * 3s socket timeout would abort it mid-stop and report a hang-up).
 */
function dockerClient(timeout: number): Docker {
  if (!clients) clients = new Map();
  if (!clients.has(timeout)) {
    const { socketPath, host, port } = parseDockerHost(process.env.DOCKER_HOST);
    clients.set(timeout, new Docker({ ...(socketPath ? { socketPath } : { host, port }), timeout }));
  }
  return clients.get(timeout)!;
}

/** GET /containers/json?all=1 (running + stopped). Throws on connection errors. */
export async function listContainers(): Promise<RawContainer[]> {
  const containers = await dockerClient(3_000).listContainers({ all: true });
  // dockerode can resolve `undefined` for an empty 200 body — normalize.
  return containers ?? [];
}

/* ---- task 5: whitelisted container actions (no exec, no build, ever) ---- */

const ACTION_TIMEOUT_MS = 20_000;

/** POST /containers/{id}/restart. */
export async function restartContainer(id: string): Promise<void> {
  await dockerClient(ACTION_TIMEOUT_MS).getContainer(id).restart();
}

/** POST /containers/{id}/stop (t = grace seconds, docker default 10). */
export async function stopContainer(id: string, t = 10): Promise<void> {
  await dockerClient(ACTION_TIMEOUT_MS).getContainer(id).stop({ t });
}

/** POST /containers/{id}/start. */
export async function startContainer(id: string): Promise<void> {
  await dockerClient(ACTION_TIMEOUT_MS).getContainer(id).start();
}

/** Subset of GET /containers/{id}/json that we consume (real StartedAt). */
export interface InspectedContainer {
  Id: string;
  State: { Running: boolean; StartedAt: string };
}

/** GET /containers/{id}/json. */
export async function inspectContainer(id: string): Promise<InspectedContainer> {
  return (await dockerClient(ACTION_TIMEOUT_MS).getContainer(id).inspect()) as InspectedContainer;
}

/**
 * GET /containers/{id}/logs — last `lines` lines, stdout+stderr joined.
 *
 * With follow:false dockerode resolves the raw body Buffer. The Docker API
 * multiplexes stdout/stderr into 8-byte-header frames when the endpoint is
 * not a TTY (podman compat API does the same), so demux here and fall back
 * to the raw text if the payload is unframed.
 */
export async function getContainerLogs(id: string, lines: number): Promise<string> {
  const payload = await dockerClient(ACTION_TIMEOUT_MS).getContainer(id).logs({
    stdout: true,
    stderr: true,
    tail: lines,
    follow: false,
  });
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  return demuxDockerStream(buffer);
}

/** Split a docker multiplexed stream buffer into plain text. Pure. */
export function demuxDockerStream(buffer: Buffer): string {
  const parts: string[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    if (streamType !== 1 && streamType !== 2) break; // unframed payload
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) break; // truncated frame — ignore
    parts.push(buffer.subarray(start, start + size).toString('utf8'));
    offset = start + size;
  }
  if (offset === 0 && parts.length === 0) return buffer.toString('utf8');
  return parts.join('');
}
