/**
 * Background progress persistence for a run. At most one write is in flight;
 * changes that arrive meanwhile merge into the next write (latest wins), so a
 * fast agent never waits for IndexedDB/folder writes before its next request.
 * write(batch) persists one merged batch; merge(previous, next) combines them.
 * close() stops background writes, waits for the one in flight and returns the
 * unwritten batch: the caller applies it inside its final (awaited) write.
 */
export function createCheckpointWriter(write, { merge = (previous, next) => ({ ...previous, ...next }), onError } = {}) {
  let pending, inflight = null, closed = false, failed = false;
  function pump() {
    if (inflight || pending === undefined || closed || failed) return;
    const batch = pending; pending = undefined;
    inflight = Promise.resolve().then(() => write(batch))
      .catch(error => { failed = true; onError?.(error); })
      .finally(() => { inflight = null; pump(); });
  }
  return {
    push(change) {
      if (closed || failed) return;
      pending = pending === undefined ? change : merge(pending, change);
      pump();
    },
    /** Resolves when nothing is pending or in flight (tests, diagnostics). */
    async idle() { while (inflight || (pending !== undefined && !closed && !failed)) { pump(); await inflight; } },
    async close() {
      closed = true;
      while (inflight) await inflight;
      const rest = pending; pending = undefined;
      return rest;
    },
  };
}
