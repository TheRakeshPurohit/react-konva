import * as React from 'react';
import Konva from 'konva';
import { expect, it } from 'vitest';
import { Stage, Layer, Rect, Transformer } from '../src/ReactKonva';
import { render } from './helpers/render';

function input(stage: Konva.Stage, type: string) {
  const bounds = stage.content.getBoundingClientRect();
  stage.content.dispatchEvent(
    new MouseEvent(type, {
      clientX: bounds.left + 20,
      clientY: bounds.top + 20,
      bubbles: true,
    }),
  );
}

it.each(['drag', 'drag-with-move-handler', 'resize'])(
  '%s keeps DOM, canvas, and effects ordered across content and window listeners',
  (mode) => {
    const oldHit = Konva.hitOnDragEnabled;
    Konva.hitOnDragEnabled = mode === 'drag-with-move-handler';
    const rect = React.createRef<Konva.Rect>();
    const transformer = React.createRef<Konva.Transformer>();
    const trace: string[] = [];
    const checkCommitted = (value: number) => {
      const container = rect.current!.getStage()!.container().parentElement!;
      expect(rect.current!.name()).toBe(String(value));
      expect(container.querySelector('output')!.textContent).toBe(String(value));
    };
    function Canvas({ value, change }) {
      React.useLayoutEffect(() => {
        checkCommitted(value);
        trace.push(`canvas layout ${value}`);
      });
      React.useEffect(() => {
        trace.push(`canvas effect ${value}`);
      });
      return (
        <Layer>
          <Rect
            ref={rect}
            x={30}
            y={30}
            width={100}
            height={100}
            fill="red"
            name={String(value)}
            draggable={mode !== 'resize'}
            onDragMove={() => change('dragmove')}
            onDragEnd={() => change('dragend')}
            onTransform={() => change('transform')}
            onTransformEnd={() => change('transformend')}
          />
          {mode === 'resize' && (
            <Transformer ref={transformer} keepRatio={false} />
          )}
        </Layer>
      );
    }
    function App() {
      const [value, setValue] = React.useState(0);
      React.useLayoutEffect(() => {
        checkCommitted(value);
        trace.push(`dom layout ${value}`);
        if (value === 0) transformer.current?.nodes([rect.current!]);
      });
      React.useEffect(() => {
        trace.push(`dom effect ${value}`);
      });
      const change = (event: string) => {
        checkCommitted(value);
        trace.push(event);
        setValue((v) => v + 1);
      };
      return (
        <>
          <output>{value}</output>
          <Stage
            width={300}
            height={300}
            onMouseMove={
              mode === 'drag-with-move-handler'
                ? () => change('mousemove')
                : undefined
            }
            onMouseUp={() => change('mouseup')}
          >
            <Canvas value={value} change={change} />
          </Stage>
        </>
      );
    }
    try {
      const mounted = render(<App />);
      const stage = mounted.stage()!;
      stage.draw();
      const bounds = stage.content.getBoundingClientRect();
      const start = transformer.current
        ? transformer.current.findOne('.bottom-right')!.getAbsolutePosition()
        : { x: 50, y: 50 };
      const dispatch = (type: string, dx: number) => {
        stage.content.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            clientX: bounds.left + start.x + dx,
            clientY: bounds.top + start.y,
          }),
        );
      };
      dispatch('mousedown', 0);
      let value = 0;
      for (const [type, dx] of [
        ['mousemove', 10],
        ['mousemove', 20],
        ['mouseup', 20],
      ] as const) {
        trace.length = 0;
        dispatch(type, dx);
        const events = type === 'mouseup'
          ? mode === 'resize' ? ['transformend', 'mouseup'] : ['mouseup', 'dragend']
          : mode === 'resize' ? ['transform']
            : mode === 'drag-with-move-handler' ? ['mousemove', 'dragmove'] : ['dragmove'];
        // Each sibling listener finishes its layout before the next handler.
        expect(trace.filter((entry) => !entry.includes(' effect '))).toEqual(
          events.flatMap((event, i) => [
            event,
            `canvas layout ${value + i + 1}`,
            `dom layout ${value + i + 1}`,
          ]),
        );
        for (let i = 1; i <= events.length; i++) {
          for (const renderer of ['dom', 'canvas']) {
            const effect = `${renderer} effect ${value + i}`;
            expect(trace.filter((entry) => entry === effect)).toHaveLength(1);
            expect(trace.indexOf(effect)).toBeGreaterThan(
              trace.indexOf(`${renderer} layout ${value + i}`),
            );
          }
        }
        value += events.length;
        checkCommitted(value);
        if (transformer.current) {
          const box = rect.current!.getClientRect();
          const right = transformer.current.findOne('.bottom-right')!.getAbsolutePosition();
          expect(right.x).toBeCloseTo(box.x + box.width);
          expect(right.y).toBeCloseTo(box.y + box.height);
        }
      }
      expect(rect.current!.isDragging()).toBe(false);
      expect(transformer.current?.isTransforming() || false).toBe(false);
    } finally {
      transformer.current?.stopTransform();
      rect.current?.stopDrag();
      Konva.hitOnDragEnabled = oldHit;
    }
  },
);

it('preserves mouseup/click order and cancellation while committing once', () => {
  const ref = React.createRef<Konva.Rect>();
  const calls: string[] = [];
  let commits = 0;
  function App() {
    const [value, setValue] = React.useState(100);
    React.useLayoutEffect(() => {
      commits++;
    });
    return (
      <>
        <output>{value}</output>
        <Stage width={200} height={200}>
          <Layer
            onMouseUp={() => calls.push('layer up')}
            onClick={() => calls.push('layer click')}
          >
            <Rect
              ref={ref}
              width={value}
              height={100}
              fill="red"
              onMouseUp={(event) => {
                calls.push('shape up');
                event.cancelBubble = true;
                setValue((v) => v + 1);
              }}
              onClick={() => {
                calls.push('shape click');
                setValue((v) => v + 1);
              }}
            />
          </Layer>
        </Stage>
      </>
    );
  }
  const { stage, container } = render(<App />);
  stage()!.draw();
  input(stage()!, 'mousedown');
  commits = 0;
  input(stage()!, 'mouseup');
  expect(calls).toEqual(['shape up', 'shape click', 'layer click']);
  expect(commits).toBe(1);
  expect(container.querySelector('output')!.textContent).toBe('102');
  expect(ref.current!.width()).toBe(102);
});

it('nested native dispatch commits at the end of the outer listener', () => {
  const ref = React.createRef<Konva.Rect>();
  let committed = 100;
  let commits = 0;
  function App() {
    const [value, setValue] = React.useState(100);
    React.useLayoutEffect(() => {
      committed = value;
      commits++;
    });
    return (
      <Stage width={200} height={200}>
        <Layer>
          <Rect
            ref={ref}
            width={value}
            height={100}
            fill="red"
            onMouseDown={() => {
              setValue((v) => v + 1);
              input(ref.current!.getStage()!, 'mousemove');
              expect(committed).toBe(100);
            }}
            onMouseMove={() => setValue((v) => v + 1)}
          />
        </Layer>
      </Stage>
    );
  }
  const { stage } = render(<App />);
  stage()!.draw();
  commits = 0;
  input(stage()!, 'mousedown');
  expect(committed).toBe(102);
  expect(ref.current!.width()).toBe(102);
  expect(commits).toBe(1);
});

it('native input can unmount its Stage after all handlers finish', () => {
  const calls: string[] = [];
  function App() {
    const [visible, setVisible] = React.useState(true);
    return visible ? (
      <Stage width={200} height={200}>
        <Layer onMouseDown={() => calls.push('layer')}>
          <Rect
            width={100}
            height={100}
            fill="red"
            onMouseDown={() => {
              calls.push('shape');
              setVisible(false);
            }}
          />
        </Layer>
      </Stage>
    ) : (
      <output>closed</output>
    );
  }
  const { stage, container } = render(<App />);
  stage()!.draw();
  input(stage()!, 'mousedown');
  expect(calls).toEqual(['shape', 'layer']);
  expect(Konva.stages).toHaveLength(0);
  expect(container.querySelector('output')!.textContent).toBe('closed');
});

it('shares a drag batch across React Stages without changing vanilla handler order', () => {
  const refs = [React.createRef<Konva.Rect>(), React.createRef<Konva.Rect>()];
  const calls: number[] = [];
  let commits = 0;
  let committed = [0, 0];
  function App() {
    const [positions, setPositions] = React.useState([0, 0]);
    React.useLayoutEffect(() => {
      committed = positions;
      commits++;
    });
    return positions.map((x, index) => (
      <Stage key={index} width={200} height={200}>
        <Layer>
          <Rect
            ref={refs[index]}
            x={x}
            width={100}
            height={100}
            draggable
            onDragMove={(event) => {
              expect(refs.map((ref) => ref.current!.x())).toEqual([10, 10]);
              calls.push(index);
              const next = event.target.x();
              setPositions((old) =>
                old.map((value, i) => (i === index ? next : value)),
              );
            }}
          />
        </Layer>
      </Stage>
    ));
  }
  render(<App />);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const vanillaStage = new Konva.Stage({ container, width: 200, height: 200 });
  const vanilla = new Konva.Rect({ width: 100, height: 100, draggable: true });
  vanillaStage.add(new Konva.Layer().add(vanilla));
  vanilla.on('dragmove', () => calls.push(2));
  const nodes = [...refs.map((ref) => ref.current!), vanilla];
  try {
    nodes.forEach((node) => {
      const stage = node.getStage()!;
      const bounds = stage.content.getBoundingClientRect();
      const evt = { clientX: bounds.left + 5, clientY: bounds.top + 5 };
      stage.setPointersPositions(evt);
      node.startDrag({ evt });
    });
    commits = 0;
    const bounds = nodes[0].getStage()!.content.getBoundingClientRect();
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: bounds.left + 15,
        clientY: bounds.top + 5,
      }),
    );
    expect(calls).toEqual([0, 1, 2]);
    expect(committed).toEqual([10, 10]);
    expect(commits).toBe(1);
    expect(vanilla.x()).toBe(10);
  } finally {
    window.dispatchEvent(new MouseEvent('mouseup'));
    vanillaStage.destroy();
    container.remove();
  }
});

it('composes the Stage event wrapper with React synchronization', () => {
  const ref = React.createRef<Konva.Rect>();
  let batches = 0;
  function App() {
    const [width, setWidth] = React.useState(100);
    return (
      <Stage
        width={200}
        height={200}
        eventBatchFunc={(run) => { batches++; run(); }}
      >
        <Layer>
          <Rect
            ref={ref}
            width={width}
            height={100}
            fill="red"
            onMouseDown={() => setWidth(120)}
          />
        </Layer>
      </Stage>
    );
  }
  const { stage } = render(<App />);
  stage()!.draw();
  input(stage()!, 'mousedown');
  expect(ref.current!.width()).toBe(120);
  expect(batches).toBe(1);
});

it('recovers the event boundary after an application handler throws', () => {
  const ref = React.createRef<Konva.Rect>();
  let shouldThrow = true;
  function App() {
    const [width, setWidth] = React.useState(100);
    return (
      <Stage width={200} height={200}>
        <Layer>
          <Rect
            ref={ref}
            width={width}
            height={100}
            fill="red"
            onMouseDown={() => {
              setWidth((value) => value + 1);
              if (shouldThrow) throw new Error('handler failed');
            }}
          />
        </Layer>
      </Stage>
    );
  }
  const { stage } = render(<App />);
  stage()!.draw();
  // Invoke the registered public boundary directly so the expected exception
  // reaches this assertion instead of the browser's uncaught-error listener.
  expect(() =>
    stage()!.eventBatchFunc()!(() => ref.current!.fire('mousedown')),
  ).toThrow('handler failed');
  expect(ref.current!.width()).toBe(101);
  shouldThrow = false;
  input(stage()!, 'mousedown');
  expect(ref.current!.width()).toBe(102);
});

it('can dispatch nested native input from an effect triggered by the current batch', () => {
  const ref = React.createRef<Konva.Rect>();
  function App() {
    const [width, setWidth] = React.useState(100);
    React.useLayoutEffect(() => {
      if (width === 101) input(ref.current!.getStage()!, 'mousemove');
    }, [width]);
    return (
      <Stage width={200} height={200}>
        <Layer>
          <Rect
            ref={ref}
            width={width}
            height={100}
            fill="red"
            onMouseDown={() => setWidth(101)}
            onMouseMove={() => setWidth(102)}
          />
        </Layer>
      </Stage>
    );
  }
  const { stage } = render(<App />);
  stage()!.draw();
  input(stage()!, 'mousedown');
  expect(ref.current!.width()).toBe(102);
});

it('finishes updates crossing canvas and DOM effects before returning', () => {
  const ref = React.createRef<Konva.Rect>();
  let resizeHeight!: (height: number) => void;
  function CanvasChild({ onSize }: { onSize: (width: number) => void }) {
    const [width, setWidth] = React.useState(100);
    const [height, setHeight] = React.useState(100);
    resizeHeight = setHeight;
    React.useLayoutEffect(() => {
      onSize(width);
    }, [width, onSize]);
    return (
      <Rect
        ref={ref}
        width={width}
        height={height}
        fill="red"
        onMouseDown={() => setWidth(120)}
      />
    );
  }
  function App() {
    const [width, setWidth] = React.useState(100);
    React.useLayoutEffect(() => {
      if (width === 120) resizeHeight(140);
    }, [width]);
    return (
      <>
        <output>{width}</output>
        <Stage width={200} height={200}>
          <Layer>
            <CanvasChild onSize={setWidth} />
          </Layer>
        </Stage>
      </>
    );
  }
  const { stage, container } = render(<App />);
  stage()!.draw();
  input(stage()!, 'mousedown');
  expect(ref.current!.width()).toBe(120);
  expect(container.querySelector('output')!.textContent).toBe('120');
  expect(ref.current!.height()).toBe(140);
});

it.each([
  ['drag', 'touchend'],
  ['transform', 'touchend'],
  ['drag', 'touchcancel'],
  ['transform', 'touchcancel'],
] as const)(
  'commits native touch %s state and %s before returning',
  (operation, endEvent) => {
    const rect = React.createRef<Konva.Rect>();
    const transformer = React.createRef<Konva.Transformer>();
    function App() {
      const [ended, setEnded] = React.useState(false);
      const [value, setValue] = React.useState(operation === 'drag' ? 0 : 100);
      React.useLayoutEffect(() => {
        transformer.current?.nodes([rect.current!]);
      }, []);
      return (
        <>
          <output>{ended ? 'ended' : value}</output>
          <Stage width={300} height={200}>
            <Layer>
              <Rect
                ref={rect}
                x={operation === 'drag' ? value : 0}
                width={operation === 'drag' ? 100 : value}
                height={100}
                fill="red"
                draggable={operation === 'drag'}
                onDragEnd={() => setEnded(true)}
                onTransformEnd={() => setEnded(true)}
                onDragMove={(e) => setValue(e.target.x())}
                onTransform={(e) => {
                  const width = e.target.width() * e.target.scaleX();
                  e.target.scaleX(1);
                  setValue(width);
                }}
              />
              {operation === 'transform' && (
                <Transformer
                  ref={transformer}
                  keepRatio={false}
                  rotateEnabled={false}
                />
              )}
            </Layer>
          </Stage>
        </>
      );
    }
    const { stage, container } = render(<App />);
    stage()!.draw();
    const bounds = stage()!.content.getBoundingClientRect();
    const origin =
      operation === 'drag'
        ? { x: 20, y: 20 }
        : transformer.current!.findOne('.bottom-right')!.getAbsolutePosition();
    const touch = (target: EventTarget, type: string, dx: number) => {
      const point = {
        identifier: 1,
        target: stage()!.content,
        clientX: bounds.left + origin.x + dx,
        clientY: bounds.top + origin.y,
      };
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, {
        touches: type === 'touchstart' || type === 'touchmove' ? [point] : [],
        changedTouches: [point],
      });
      target.dispatchEvent(event);
    };
    try {
      touch(stage()!.content, 'touchstart', 0);
      touch(window, 'touchmove', 20);
      const expected = operation === 'drag' ? 20 : 120;
      expect(
        Number(container.querySelector('output')!.textContent),
      ).toBeCloseTo(expected);
      expect(
        operation === 'drag' ? rect.current!.x() : rect.current!.width(),
      ).toBeCloseTo(expected);
    } finally {
      touch(window, endEvent, 20);
    }
    expect(container.querySelector('output')!.textContent).toBe('ended');
    expect(rect.current!.isDragging()).toBe(false);
    expect(transformer.current?.isTransforming() || false).toBe(false);
  },
);

it('commits drag state in another owner window and dragend after release outside it', () => {
  const rect = React.createRef<Konva.Rect>();
  function App() {
    const [x, setX] = React.useState(0);
    const [ended, setEnded] = React.useState(false);
    return (
      <>
        <output>{ended ? 'ended' : x}</output>
        <Stage width={200} height={200}>
          <Layer>
            <Rect
              ref={rect}
              x={x}
              width={100}
              height={100}
              fill="red"
              draggable
              onDragMove={(e) => setX(e.target.x())}
              onDragEnd={() => setEnded(true)}
            />
          </Layer>
        </Stage>
      </>
    );
  }
  const mounted = render(<App />);
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  try {
    const stage = mounted.stage()!;
    stage.container(iframe.contentDocument!.createElement('div'));
    iframe.contentDocument!.body.appendChild(stage.container());
    stage.draw();
    const bounds = stage.content.getBoundingClientRect();
    const at = (x: number) => ({
      clientX: bounds.left + x,
      clientY: bounds.top + 20,
      bubbles: true,
    });
    const win = iframe.contentWindow!;
    stage.content.dispatchEvent(
      new (win as any).MouseEvent('mousedown', at(20)),
    );
    win.dispatchEvent(new (win as any).MouseEvent('mousemove', at(40)));
    expect(rect.current!.x()).toBe(20);
    expect(mounted.container.querySelector('output')!.textContent).toBe('20');
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(rect.current!.isDragging()).toBe(false);
    expect(mounted.container.querySelector('output')!.textContent).toBe(
      'ended',
    );
  } finally {
    mounted.unmount();
    iframe.remove();
  }
});

it('commits pointer cancellation state and preserves the legacy pointerup notification', () => {
  const calls: string[] = [];
  function App() {
    const [cancelled, setCancelled] = React.useState(false);
    return (
      <>
        <output>{String(cancelled)}</output>
        <Stage width={200} height={200}>
          <Layer>
            <Rect
              width={100}
              height={100}
              fill="red"
              onPointerCancel={() => {
                calls.push('cancel');
                setCancelled(true);
              }}
              onPointerUp={() => calls.push('up')}
            />
          </Layer>
        </Stage>
      </>
    );
  }
  const { stage, container } = render(<App />);
  stage()!.draw();
  const bounds = stage()!.content.getBoundingClientRect();
  stage()!.content.dispatchEvent(
    new PointerEvent('pointercancel', {
      pointerId: 1,
      clientX: bounds.left + 20,
      clientY: bounds.top + 20,
      bubbles: true,
    }),
  );
  expect(calls).toEqual(['cancel', 'up']);
  expect(container.querySelector('output')!.textContent).toBe('true');
});

it('commits both dragend updates when a touch cancels a multi-node drag', () => {
  const refs = [React.createRef<Konva.Rect>(), React.createRef<Konva.Rect>()];
  function App() {
    const [ended, setEnded] = React.useState(0);
    return (
      <>
        <output>{ended}</output>
        <Stage width={200} height={200}>
          <Layer>
            {refs.map((ref, i) => (
              <Rect
                key={i}
                ref={ref}
                x={i * 50}
                width={30}
                height={30}
                draggable
                onDragMove={() => {}}
                onDragEnd={() => setEnded((n) => n + 1)}
              />
            ))}
          </Layer>
        </Stage>
      </>
    );
  }
  const { stage, container } = render(<App />);
  const bounds = stage()!.content.getBoundingClientRect();
  const event = (type: string, dx: number) => {
    const point = {
      identifier: 1,
      target: stage()!.content,
      clientX: bounds.left + 5 + dx,
      clientY: bounds.top + 5,
    };
    return Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      touches: type === 'touchcancel' ? [] : [point],
      changedTouches: [point],
    });
  };
  const start = event('touchstart', 0);
  stage()!.setPointersPositions(start);
  refs.forEach((ref) => ref.current!.startDrag({ evt: start }));
  window.dispatchEvent(event('touchmove', 10));
  expect(refs.map((ref) => ref.current!.x())).toEqual([10, 60]);
  window.dispatchEvent(event('touchcancel', 10));
  expect(refs.every((ref) => !ref.current!.isDragging())).toBe(true);
  expect(container.querySelector('output')!.textContent).toBe('2');
});

it.each([false, true])(
  'cancels only changed touches in one commit with capture=%s',
  (capture) => {
    const refs = Array.from({ length: 3 }, () => React.createRef<Konva.Rect>());
    const calls: string[] = [];
    let commits = 0;
    function App() {
      const [cancelled, setCancelled] = React.useState(0);
      React.useLayoutEffect(() => {
        commits++;
      });
      return (
        <>
          <output>{cancelled}</output>
          <Stage width={200} height={200}>
            <Layer>
              {refs.map((ref, i) => (
                <Rect
                  key={i}
                  ref={ref}
                  x={i * 60}
                  width={40}
                  height={40}
                  fill="red"
                  onTouchCancel={(event) => {
                    calls.push(`${i}:${event.pointerId}`);
                    setCancelled((n) => n + 1);
                  }}
                />
              ))}
            </Layer>
          </Stage>
        </>
      );
    }
    const { stage, container } = render(<App />);
    stage()!.draw();
    if (capture) refs.forEach((ref, i) => ref.current!.setPointerCapture(i + 1));
    const bounds = stage()!.content.getBoundingClientRect();
    const points = refs.map((_, i) => ({
      identifier: i + 1,
      clientX: bounds.left + i * 60 + 20,
      clientY: bounds.top + 20,
    }));
    const changed = [points[0], points[2]].map((point) => ({
      ...point,
      clientY: point.clientY + (capture ? 100 : 0),
    }));
    commits = 0;
    stage()!.content.dispatchEvent(
      Object.assign(new Event('touchcancel', { bubbles: true }), {
        touches: [points[1]],
        changedTouches: changed,
      }),
    );
    expect(calls).toEqual(['0:1', '2:3']);
    expect(container.querySelector('output')!.textContent).toBe('2');
    expect(commits).toBe(1);
    expect(refs.map((ref, i) => ref.current!.hasPointerCapture(i + 1))).toEqual([
      false,
      capture,
      false,
    ]);
  },
);
