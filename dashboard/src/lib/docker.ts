/**
 * Minimal Docker API client (task 3 scope: list containers only — actions and
 * logs land in task 5).
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

let client: Docker | null = null;

function dockerClient(): Docker {
  if (!client) {
    const { socketPath, host, port } = parseDockerHost(process.env.DOCKER_HOST);
    // Short timeout so a dead socket degrades fast instead of hanging requests.
    client = new Docker({ ...(socketPath ? { socketPath } : { host, port }), timeout: 3000 });
  }
  return client;
}

/** GET /containers/json?all=1 (running + stopped). Throws on connection errors. */
export async function listContainers(): Promise<RawContainer[]> {
  const containers = await dockerClient().listContainers({ all: true });
  // dockerode can resolve `undefined` for an empty 200 body — normalize.
  return containers ?? [];
}
