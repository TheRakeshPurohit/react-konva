import * as React from 'react';
import Konva from 'konva';
import { autorun, observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { expect, it, vi } from 'vitest';
import { Stage, Layer, Rect, Transformer } from '../src/ReactKonva';
import { render } from './helpers/render';

it.each(['drag', 'resize'])(
  'runs a multi-node %s in one MobX action before committing both renderers',
  (operation) => {
    const count = 100;
    const dragging = operation === 'drag';
    const initial = dragging ? 0 : 100;
    const state = observable({ values: Array(count).fill(initial) });
    const refs = Array.from({ length: count }, () =>
      React.createRef<Konva.Rect>(),
    );
    const transformer = React.createRef<Konva.Transformer>();
    const trace: string[] = [];
    const snapshots: number[][] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispose = autorun(() => {
      snapshots.push(state.values.slice());
      trace.push('reaction');
    });
    function Canvas({ values }: { values: number[] }) {
      React.useLayoutEffect(() => {
        trace.push('canvas layout');
      });
      return (
        <Layer>
          {values.map((value, i) => (
            <Rect
              key={i}
              ref={refs[i]}
              x={dragging ? value : 0}
              width={dragging ? 20 : value}
              height={100}
              draggable={dragging}
              onDragMove={(e) => {
                trace.push(`handler ${i}`);
                state.values[i] = e.target.x();
              }}
              onTransform={(e) => {
                trace.push(`handler ${i}`);
                const width = e.target.width() * e.target.scaleX();
                e.target.scaleX(1);
                state.values[i] = width;
              }}
            />
          ))}
          {!dragging && (
            <Transformer
              ref={transformer}
              keepRatio={false}
              rotateEnabled={false}
            />
          )}
        </Layer>
      );
    }
    const App = observer(() => {
      const values = state.values.slice();
      React.useLayoutEffect(() => {
        expect(
          refs.map((ref) =>
            dragging ? ref.current!.x() : ref.current!.width(),
          ),
        ).toEqual(values);
        trace.push('dom layout');
      });
      return (
        <>
          <output>{values.reduce((sum, value) => sum + value, 0)}</output>
          <Stage width={200} height={200} eventBatchFunc={runInAction}>
            <Canvas values={values} />
          </Stage>
        </>
      );
    });
    try {
      const mounted = render(<App />);
      const stage = mounted.stage()!;
      const bounds = stage.content.getBoundingClientRect();
      const at = (dx: number) => ({
        clientX: bounds.left + (dragging ? 5 : 100) + dx,
        clientY: bounds.top + (dragging ? 5 : 100),
        bubbles: true,
      });
      if (dragging) {
        stage.setPointersPositions(at(0));
        refs.forEach((ref) => ref.current!.startDrag({ evt: at(0) }));
      } else {
        transformer.current!.nodes(refs.map((ref) => ref.current!));
        stage.draw();
        stage.content.dispatchEvent(new MouseEvent('mousedown', at(0)));
      }
      snapshots.length = 0;
      trace.length = 0;
      // No act() or test flush: the native listener must finish this work itself.
      window.dispatchEvent(new MouseEvent('mousemove', at(10)));
      expect(snapshots).toHaveLength(1);
      for (const value of snapshots[0]) expect(value).toBeCloseTo(initial + 10);
      expect(trace).toEqual([
        ...Array.from({ length: count }, (_, i) => `handler ${i}`),
        'reaction',
        'canvas layout',
        'dom layout',
      ]);
      expect(
        Number(mounted.container.querySelector('output')!.textContent),
      ).toBeCloseTo(dragging ? 1000 : 11000);
      if (transformer.current) {
        expect(
          transformer.current.findOne('.bottom-right')!.getAbsolutePosition().x,
        ).toBeCloseTo(110);
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      window.dispatchEvent(new MouseEvent('mouseup'));
      dispose();
      warn.mockRestore();
    }
  },
);

it('finishes pending work and recovers when the custom wrapper throws', () => {
  const ref = React.createRef<Konva.Rect>();
  let fail = true;
  const batch = (run: () => void) => {
    run();
    if (fail) throw new Error('batch failed');
  };
  function App() {
    const [width, setWidth] = React.useState(100);
    return (
      <Stage width={200} height={200} eventBatchFunc={batch}>
        <Layer>
          <Rect
            ref={ref}
            width={width}
            height={100}
            fill="red"
            onMouseDown={() => setWidth((value) => value + 1)}
          />
        </Layer>
      </Stage>
    );
  }
  const mounted = render(<App />);
  const stage = mounted.stage()!;
  // Catch the intentional error through the public boundary rather than the
  // browser's uncaught-exception listener, as in the native handler error test.
  expect(() =>
    stage.eventBatchFunc()!(() => ref.current!.fire('mousedown')),
  ).toThrow('batch failed');
  expect(ref.current!.width()).toBe(101);
  fail = false;
  stage.draw();
  const bounds = stage.content.getBoundingClientRect();
  stage.content.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      clientX: bounds.left + 20,
      clientY: bounds.top + 20,
    }),
  );
  expect(ref.current!.width()).toBe(102);
});

it('updates and removes the wrapper without replacing the Stage or losing React synchronization', () => {
  const calls: string[] = [];
  const first = (run: () => void) => {
    calls.push('first');
    run();
  };
  const second = (run: () => void) => {
    calls.push('second');
    run();
  };
  const ref = React.createRef<Konva.Rect>();
  function App({ batch }: { batch?: (run: () => void) => void }) {
    const [width, setWidth] = React.useState(100);
    return (
      <Stage width={200} height={200} eventBatchFunc={batch}>
        <Layer>
          <Rect
            ref={ref}
            width={width}
            height={100}
            fill="red"
            onMouseDown={() => setWidth((value) => value + 1)}
          />
        </Layer>
      </Stage>
    );
  }
  const mounted = render(<App batch={first} />);
  const stage = mounted.stage()!;
  stage.draw();
  const bounds = stage.content.getBoundingClientRect();
  const press = () =>
    stage.content.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        clientX: bounds.left + 20,
        clientY: bounds.top + 20,
      }),
    );
  press();
  expect(calls).toEqual(['first']);
  expect(ref.current!.width()).toBe(101);
  mounted.rerender(<App batch={second} />);
  press();
  expect(calls).toEqual(['first', 'second']);
  expect(ref.current!.width()).toBe(102);
  mounted.rerender(<App />);
  press();
  expect(calls).toEqual(['first', 'second']);
  expect(ref.current!.width()).toBe(103);
  expect(mounted.stage()).toBe(stage);
});

it('shares the same wrapper across Stages participating in one drag listener', () => {
  const refs = [React.createRef<Konva.Rect>(), React.createRef<Konva.Rect>()];
  const state = observable({ positions: [0, 0] });
  const batch = vi.fn((run: () => void) => runInAction(run));
  let commits = 0;
  const App = observer(() => {
    React.useLayoutEffect(() => {
      commits++;
    });
    return state.positions.map((x, i) => (
      <Stage key={i} width={200} height={200} eventBatchFunc={batch}>
        <Layer>
          <Rect
            ref={refs[i]}
            x={x}
            width={20}
            height={20}
            draggable
            onDragMove={(e) => {
              state.positions[i] = e.target.x();
            }}
          />
        </Layer>
      </Stage>
    ));
  });
  render(<App />);
  try {
    refs.forEach((ref) => {
      const stage = ref.current!.getStage()!;
      const bounds = stage.content.getBoundingClientRect();
      const evt = { clientX: bounds.left + 5, clientY: bounds.top + 5 };
      stage.setPointersPositions(evt);
      ref.current!.startDrag({ evt });
    });
    commits = 0;
    batch.mockClear();
    const bounds = refs[0].current!.getStage()!.content.getBoundingClientRect();
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: bounds.left + 15,
        clientY: bounds.top + 5,
      }),
    );
    expect(batch).toHaveBeenCalledTimes(1);
    expect(commits).toBe(1);
    expect(state.positions.slice()).toEqual([10, 10]);
    expect(refs.map((ref) => ref.current!.x())).toEqual([10, 10]);
  } finally {
    window.dispatchEvent(new MouseEvent('mouseup'));
  }
});

it.each(['drag', 'transform'])(
  'covers native %s start, move, end, and imperative/bubbling handlers',
  (operation) => {
    const state = observable({ phase: 'idle', calls: 0 });
    const rect = React.createRef<Konva.Rect>();
    const transformer = React.createRef<Konva.Transformer>();
    const snapshots: string[] = [];
    const dispose = autorun(() =>
      snapshots.push(`${state.phase}:${state.calls}`),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const started = () => {
      state.phase = 'started';
    };
    const moved = () => {
      state.phase = 'moved';
      state.calls++;
    };
    const ended = () => {
      state.phase = 'ended';
    };
    const Shape = observer(
      ({ report }: { report: (value: string) => void }) => {
        const value = `${state.phase}:${state.calls}`;
        // Canvas-owned observable state must be able to update DOM state in an effect.
        React.useLayoutEffect(() => report(value), [value, report]);
        return (
          <Rect
            ref={rect}
            x={30}
            y={30}
            width={100}
            height={100}
            fill="red"
            name={value}
            draggable={operation === 'drag'}
            onDragStart={started}
            onDragMove={moved}
            onDragEnd={ended}
            onTransformStart={started}
            onTransform={moved}
            onTransformEnd={ended}
          />
        );
      },
    );
    function App() {
      const [value, setValue] = React.useState('idle:0');
      return (
        <>
          <output>{value}</output>
          <Stage width={300} height={300} eventBatchFunc={runInAction}>
            <Layer
              onDragMove={() => state.calls++}
              onTransform={() => state.calls++}
            >
              <Shape report={setValue} />
              {operation === 'transform' && (
                <Transformer ref={transformer} keepRatio={false} />
              )}
            </Layer>
          </Stage>
        </>
      );
    }
    try {
      const mounted = render(<App />);
      const stage = mounted.stage()!;
      transformer.current?.nodes([rect.current!]);
      rect.current!.on(
        `${operation === 'drag' ? 'dragmove' : 'transform'}.test`,
        () => state.calls++,
      );
      stage.draw();
      const bounds = stage.content.getBoundingClientRect();
      const start = transformer.current
        ? transformer.current.findOne('.bottom-right')!.getAbsolutePosition()
        : { x: 50, y: 50 };
      const input = (type: string, dx: number) =>
        stage.content.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            clientX: bounds.left + start.x + dx,
            clientY: bounds.top + start.y,
          }),
        );
      input('mousedown', 0);
      if (operation === 'transform') expect(state.phase).toBe('started');
      snapshots.length = 0;
      input('mousemove', 10);
      // Konva transform events do not bubble; dragmove also reaches the Layer.
      const calls = operation === 'drag' ? 3 : 2;
      expect(snapshots).toEqual([`moved:${calls}`]);
      expect(rect.current!.name()).toBe(`moved:${calls}`);
      expect(mounted.container.querySelector('output')!.textContent).toBe(
        `moved:${calls}`,
      );
      input('mouseup', 10);
      expect(snapshots).toEqual([`moved:${calls}`, `ended:${calls}`]);
      expect(rect.current!.name()).toBe(`ended:${calls}`);
      expect(mounted.container.querySelector('output')!.textContent).toBe(
        `ended:${calls}`,
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      rect.current?.off('.test');
      runInAction(() => {
        transformer.current?.stopTransform();
        rect.current?.stopDrag();
      });
      dispose();
      warn.mockRestore();
    }
  },
);
