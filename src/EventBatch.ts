import { flushSync } from 'react-dom';

const pending = new Set<() => void>();
const enqueue =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (callback: () => void) => Promise.resolve().then(callback);
let depth = 0;

type EventBatchFunc = (callback: () => void) => void;
const batches = new WeakMap<EventBatchFunc, EventBatchFunc>();

export function getEventBatch(batch?: EventBatchFunc): EventBatchFunc {
  if (!batch) return batchEvents;
  let wrapped = batches.get(batch);
  if (!wrapped) {
    // Konva deduplicates shared callbacks when several Stages drag together.
    wrapped = (run) => batchEvents(() => batch(run));
    batches.set(batch, wrapped);
  }
  return wrapped;
}

// React's host scheduler stays asynchronous while a handler or subscription is
// running. A completed native input batch can finish those same scheduled jobs.
export function scheduleMicrotask(callback: () => void) {
  const run = () => {
    if (pending.delete(run)) callback();
  };
  pending.add(run);
  enqueue(run);
}

export function batchEvents(callback: () => void) {
  if (depth) return callback();
  depth++;
  try {
    // DOM-owned state must be scheduled inside this scope. Flush it before
    // finishing canvas work, so Stage can transfer the final DOM-owned props.
    flushSync(callback);
  } finally {
    try {
      // Canvas effects can schedule DOM state, and DOM effects can schedule
      // more canvas work. Finish that work in a DOM scope too. Empty input
      // does not add a second flush, and queued microtasks become no-ops.
      while (pending.size) {
        flushSync(() => {
          for (const run of pending) run();
        });
      }
    } finally {
      depth--;
    }
  }
}
