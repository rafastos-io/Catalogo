export type JobName = 'sync' | 'capas' | 'feed' | 'pipeline';

export type JobSnapshot = {
  name: JobName;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  detail: string;
};

const empty = (name: JobName): JobSnapshot => ({
  name,
  startedAt: null,
  finishedAt: null,
  ok: null,
  detail: 'ainda não rodou',
});

const snapshots: Record<JobName, JobSnapshot> = {
  sync: empty('sync'),
  capas: empty('capas'),
  feed: empty('feed'),
  pipeline: empty('pipeline'),
};

let pipelineRunning = false;
let cancelRequested = false;

export function isPipelineRunning(): boolean {
  return pipelineRunning;
}

export function setPipelineRunning(v: boolean): void {
  pipelineRunning = v;
}

export function requestCancel(reason = 'cancelamento manual'): void {
  cancelRequested = true;
  if (pipelineRunning) {
    setJobDetail('pipeline', `cancelando: ${reason}`);
  }
}

export function clearCancel(): void {
  cancelRequested = false;
}

export function isCancelRequested(): boolean {
  return cancelRequested;
}

export function markStart(name: JobName): void {
  snapshots[name] = {
    name,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: null,
    detail: 'em andamento',
  };
}

export function markEnd(name: JobName, ok: boolean, detail: string): void {
  const prev = snapshots[name];
  snapshots[name] = {
    ...prev,
    finishedAt: new Date().toISOString(),
    ok,
    detail,
  };
}

/** Atualiza só o detail enquanto o job roda (progresso no /health). */
export function setJobDetail(name: JobName, detail: string): void {
  snapshots[name] = { ...snapshots[name], detail };
}

export function getStatus() {
  return {
    running: pipelineRunning,
    cancelRequested,
    jobs: snapshots,
  };
}
