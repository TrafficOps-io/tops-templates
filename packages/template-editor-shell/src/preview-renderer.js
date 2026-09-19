// Coalesce source deltas without restarting the delay on every token. A slow host
// gets at most one render at a time and always receives the newest queued draft.
export function createPreviewRenderer({ render, onSuccess, onError, delay = 400 }) {
  let pending = null, timer = null, active = null, disposed = false;
  function schedule() {
    if (disposed || timer || active || !pending) return;
    timer = setTimeout(flush, delay);
  }
  async function flush() {
    timer = null;
    if (disposed || !pending) return;
    const request = pending;
    pending = null;
    const controller = new AbortController();
    active = controller;
    try {
      const result = await render(request, controller.signal);
      if (!disposed && !controller.signal.aborted) onSuccess(result, request);
    } catch (error) {
      // Streaming input may temporarily contain incomplete TPL. Preserve the last
      // successful preview until a completed draft can be rendered or diagnosed.
      if (!disposed && !controller.signal.aborted && !pending && !request.partial) onError(error, request);
    } finally {
      if (active === controller) active = null;
      schedule();
    }
  }
  return {
    enqueue(request) { if (!disposed) { pending = request; schedule(); } },
    dispose() { disposed = true; pending = null; clearTimeout(timer); active?.abort(); },
  };
}
