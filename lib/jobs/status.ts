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

export function isPipelineRunning(): boolean {
  return pipelineRunning;
}

export function setPipelineRunning(v: boolean): void {
  pipelineRunning = v;
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

export function getStatus() {
  return {
    running: pipelineRunning,
    jobs: snapshots,
  };
}
