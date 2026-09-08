import * as React from 'react';
import Konva from 'konva';
import { expect, it, vi } from 'vitest';
import { Stage, Layer, Rect } from '../src/ReactKonva';
import { render } from './helpers/render';

it.each([false, true])(
  'batches React updates asynchronously without the Konva hook (custom wrapper: %s)',
  async (custom) => {
    // All tests use latest Konva. Disable only its public integration capability;
    // this checks our fallback, not every behavior of historical Konva releases.
    const descriptor = Object.getOwnPropertyDescriptor(
      Konva.Stage.prototype,
      'eventBatchFunc',
    )!;
    Object.defineProperty(Konva.Stage.prototype, 'eventBatchFunc', {
      ...descriptor,
      value: undefined,
    });
    const ref = React.createRef<Konva.Rect>();
    const layoutReads: number[] = [];
    let canvasCommits = 0;
    const batch = vi.fn((run: () => void) => run());
    function Canvas({ value }: { value: number }) {
      React.useLayoutEffect(() => {
        canvasCommits++;
      });
      return <Rect ref={ref} width={value} height={100} />;
    }
    function App() {
      const [value, setValue] = React.useState(100);
      React.useLayoutEffect(() => {
        layoutReads.push(ref.current!.width());
        // Events fired during a DOM commit must not attempt a nested flushSync.
        if (value === 102) ref.current!.fire('click', {}, true);
      }, [value]);
      return (
        <>
          <output>{value}</output>
          <Stage
            width={200}
            height={200}
            eventBatchFunc={custom ? batch : undefined}
          >
            <Layer onClick={() => setValue((v) => v + 1)}>
              <Canvas value={value} />
            </Layer>
          </Stage>
        </>
      );
    }
    try {
      const mounted = render(<App />);
      canvasCommits = 0;
      layoutReads.length = 0;
      // Direct fire() exercises the fallback without invoking the latest Konva's
      // native dispatch, which itself requires its own eventBatchFunc getter.
      ref.current!.fire('click', {}, true);
      ref.current!.fire('click', {}, true);
      expect(ref.current!.width()).toBe(100);
      expect(canvasCommits).toBe(0);
      await vi.waitFor(() => {
        expect(mounted.container.querySelector('output')!.textContent).toBe(
          '103',
        );
        expect(ref.current!.width()).toBe(103);
      });
      expect(layoutReads).toEqual([102, 103]);
      expect(canvasCommits).toBe(2);
      expect(batch).not.toHaveBeenCalled();
      mounted.unmount();
    } finally {
      Object.defineProperty(
        Konva.Stage.prototype,
        'eventBatchFunc',
        descriptor,
      );
    }
  },
);
