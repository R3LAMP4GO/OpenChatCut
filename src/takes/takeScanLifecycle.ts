export interface TakeScanCallbacks<Result> {
  reset: () => void;
  run: (signal: AbortSignal) => Promise<Result>;
  apply: (result: Result) => void;
  reject: (error: unknown) => void;
}

export interface TakeScanRequest { id: number; signal: AbortSignal; }

/** Coordinates take scans outside React so obsolete completions cannot update the review UI. */
export function createTakeScanLifecycle<Result>() {
  let nextId = 0;
  let current: { request: TakeScanRequest; controller: AbortController } | undefined;

  const isCurrent = (request: TakeScanRequest) => current?.request.id === request.id && current.request.signal === request.signal && !request.signal.aborted;

  return {
    start(callbacks: TakeScanCallbacks<Result>): TakeScanRequest {
      current?.controller.abort();
      const controller = new AbortController();
      const request = { id: ++nextId, signal: controller.signal };
      current = { request, controller };
      callbacks.reset();
      void callbacks.run(request.signal).then(
        (result) => { if (isCurrent(request)) callbacks.apply(result); },
        (error) => { if (isCurrent(request)) callbacks.reject(error); },
      );
      return request;
    },
    cancel(): void {
      current?.controller.abort();
      current = undefined;
    },
  };
}
