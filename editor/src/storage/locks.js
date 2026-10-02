const chains = new Map();

// Runs fn exclusively per name: navigator.locks when present, else an in-process FIFO chain.
export function withLock(name, fn, { locks = globalThis.navigator?.locks } = {}) {
  if (locks?.request) return locks.request(name, () => fn());
  const previous = chains.get(name) || Promise.resolve();
  const run = previous.then(() => fn());
  const tail = run.then(() => {}, () => {});
  chains.set(name, tail);
  tail.then(() => { if (chains.get(name) === tail) chains.delete(name); });
  return run;
}
