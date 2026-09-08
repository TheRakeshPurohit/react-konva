// §7 — mobx-react-lite × secondary-reconciler snapshot race.
//
// Why mobx in a renderer test suite? react-konva itself is state-library
// agnostic — users wire it up with mobx, redux, zustand, plain useState,
// signals, anything. We don't take a position. The mobx case earns a
// dedicated test because the Polotno team hit a real, hard-to-diagnose
// scheduling bug where react-konva's secondary reconciler interleaved with
// mobx-react-lite's deferred snapshot bump, producing stale Konva trees on
// state changes that would have rendered cleanly under react-dom. This
// test is the safeguard: it pins react-konva's commit timing close enough
// to react-dom's that mobx's standard `useSyncExternalStore` integration
// works the same way under both renderers.
//
// Mechanism: the observer's `useSyncExternalStore` snapshot only changes
// when MobX runs its queued invalidation callback, gated by `shouldCompute()`.
// If anything re-renders the observer between
// `onBecomeStale_` and `runReaction_`, the render's `reaction.track()`
// resets deps to UP_TO_DATE_, `shouldCompute` returns false, the handler
// skips, the Symbol stays stale, React's `useSyncExternalStore` bails out,
// and the JSX update is discarded — leaving a stale Konva subtree.
//
// Async `scheduleMicrotask` avoids that interleaving with MobX's default
// reaction scheduling, which this test uses. A custom reactionScheduler that
// defers notifications can still reopen the race: React also flushes sync
// work directly after passive effects, before queued microtasks can run.

import * as React from 'react';
import { it, expect, beforeEach, vi } from 'vitest';
import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Stage, Layer, Rect, Group } from '../src/ReactKonva';
import { render } from './helpers/render';
import { focusRectsOnCanvas } from './helpers/konva-helpers';

const FOCUS_STROKE = '#0d83dd';

interface Store {
  selected: boolean;
  focusedId: string | null;
}

let store: Store;
beforeEach(() => {
  store = observable({
    selected: false,
    focusedId: null,
  });
});

// Regression test for the async `scheduleMicrotask` decision in
// ReactKonvaHostConfig.ts. Reverting to sync makes this test fail with a
// lingering focus rect (the mobx race described in the file header).
it('§7 focus rect disappears when an observable flips off (no stale snapshot)', async () => {
  const FocusBox = observer(() => {
    const isSelected = store.selected;
    const focusedId = store.focusedId;

    // useState held in the same observer that mutates `focusedId` in its
    // useEffect. On deselection, setHover(null) repeats the current value;
    // React can still invoke the observer before bailing out of that render.
    // Tracking during that render can consume a pending MobX invalidation.
    const [, setHover] = React.useState<string | null>('init');

    React.useEffect(() => {
      if (!isSelected) {
        runInAction(() => {
          store.focusedId = null;
        });
        setHover(null);
      }
    }, [isSelected]);

    return (
      <Group>
        <Rect x={0} y={0} width={50} height={50} fill="white" />
        {focusedId && (
          <Rect
            key={`focus-${focusedId}`}
            x={0}
            y={0}
            width={50}
            height={50}
            stroke={FOCUS_STROKE}
            strokeWidth={2}
            listening={false}
          />
        )}
      </Group>
    );
  });

  const App = () => (
    <Stage width={200} height={200}>
      <Layer>
        <FocusBox />
      </Layer>
    </Stage>
  );

  render(<App />);

  runInAction(() => {
    store.selected = true;
    store.focusedId = 'a';
  });
  await vi.waitFor(() =>
    expect(focusRectsOnCanvas(FOCUS_STROKE).length).toBe(1)
  );

  runInAction(() => {
    store.selected = false;
  });
  await vi.waitFor(() => {
    expect(store.focusedId).toBe(null);
    expect(focusRectsOnCanvas(FOCUS_STROKE).length).toBe(0);
  });
});

it('batches observable updates from Konva event handlers', async () => {
  const eventStore = observable({ count: 0 });
  const rectRef = React.createRef<Konva.Rect>();
  let commits = 0;
  const Shape = observer(() => {
    const count = eventStore.count;
    React.useLayoutEffect(() => {
      commits++;
    });
    return (
      <Rect
        ref={rectRef}
        name={`count-${count}`}
        onClick={() => {
          runInAction(() => {
            eventStore.count++;
          });
        }}
      />
    );
  });

  render(
    <Stage width={100} height={100}>
      <Layer>
        <Shape />
      </Layer>
    </Stage>
  );
  commits = 0;

  for (let index = 0; index < 8; index++) {
    rectRef.current!.fire('click');
  }

  expect(commits).toBe(0);
  await vi.waitFor(() => expect(rectRef.current!.name()).toBe('count-8'));
  expect(commits).toBe(1);
});
