// §9 — Event handling.
// Konva handlers follow React's normal scheduling and batching.

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import Konva from 'konva';
import { Stage, Layer, Rect, Group } from '../src/ReactKonva';
import { render, act } from './helpers/render';

describe('§9 event handling', () => {
  it.each(['mousemove', 'dragmove', 'transform'])('%s preserves batching for DOM-owned state', async (event) => {
    const ref = React.createRef<Konva.Rect>();
    let commits = 0;
    const App = () => {
      const [count, setCount] = React.useState(0);
      React.useLayoutEffect(() => { commits++; });
      const update = () => setCount((n) => n + 1);
      return <>
        <output>{count}</output>
        <Stage width={100} height={100}>
          <Layer>
            <Rect
              ref={ref}
              onMouseMove={update}
              onDragMove={update}
              onTransform={update}
            />
          </Layer>
        </Stage>
      </>;
    };
    const view = render(<App />);
    commits = 0;
    // No act or flushSync: those would change the batching under test.
    for (let i = 0; i < 8; i++) ref.current!.fire(event);
    expect(commits).toBe(0);
    await vi.waitFor(() => expect(view.container.querySelector('output')!.textContent).toBe('8'));
    expect(commits).toBe(1);
  });

  it.each(['mousemove', 'dragmove', 'transform'])('%s preserves batching for state inside Stage', async (event) => {
    const ref = React.createRef<Konva.Rect>();
    let commits = 0;
    const Shape = () => {
      const [count, setCount] = React.useState(0);
      React.useLayoutEffect(() => { commits++; });
      const update = () => setCount((n) => n + 1);
      return (
        <Rect
          ref={ref}
          name={`count-${count}`}
          onMouseMove={update}
          onDragMove={update}
          onTransform={update}
        />
      );
    };
    render(
      <Stage width={100} height={100}>
        <Layer><Shape /></Layer>
      </Stage>
    );
    commits = 0;
    for (let i = 0; i < 8; i++) ref.current!.fire(event);
    expect(commits).toBe(0);
    await vi.waitFor(() => expect(ref.current!.name()).toBe('count-8'));
    expect(commits).toBe(1);
  });

  it.each([['dragstart', 'layout'], ['transform', 'layout'], ['dragstart', 'passive'], ['transform', 'passive']])('%s in a DOM %s effect eventually updates Konva-owned state', async (event, effect) => {
    const ref = React.createRef<Konva.Rect>();
    const Shape = () => {
      const [width, setWidth] = React.useState(20);
      const update = () => setWidth(40);
      return <Rect ref={ref} width={width} draggable onDragStart={update} onTransform={update} />;
    };
    const App = () => {
      const useEffect = effect === 'layout' ? React.useLayoutEffect : React.useEffect;
      useEffect(() => {
        if (event === 'dragstart') ref.current!.startDrag();
        else ref.current!.fire('transform');
      }, []);
      return <Stage width={100} height={100}><Layer><Shape /></Layer></Stage>;
    };
    render(<App />);
    await vi.waitFor(() => expect(ref.current!.width()).toBe(40));
  });

  it.each([['dragstart', 'layout'], ['transform', 'layout'], ['dragstart', 'passive'], ['transform', 'passive']])('%s from a DOM %s effect can update DOM state', async (event, effect) => {
    const App = () => {
      const rectRef = React.useRef<Konva.Rect>(null);
      const [started, setStarted] = React.useState(false);
      const useEffect = effect === 'layout' ? React.useLayoutEffect : React.useEffect;
      useEffect(() => {
        if (event === 'dragstart') rectRef.current!.startDrag();
        else rectRef.current!.fire('transform');
      }, []);
      return (
        <>
          <output>{started ? 'started' : 'waiting'}</output>
          <Stage width={100} height={100}>
            <Layer>
              <Rect ref={rectRef} draggable onDragStart={() => setStarted(true)} onTransform={() => setStarted(true)} />
            </Layer>
          </Stage>
        </>
      );
    };
    const view = render(<App />);
    await vi.waitFor(() => expect(view.container.querySelector('output')!.textContent).toBe('started'));
  });

  it.each(['Rect', 'Stage'] as const)('unmounting an actively dragged %s lets onDragEnd update the surviving DOM tree', (type) => {
    let hide!: () => void;
    const rectRef = React.createRef<Konva.Rect>();
    const App = () => {
      const [visible, setVisible] = React.useState(true);
      const [ended, setEnded] = React.useState(false);
      hide = () => setVisible(false);
      return (
        <>
          <output>{ended ? 'ended' : 'dragging'}</output>
          {visible && (
            <Stage
              width={100}
              height={100}
              draggable={type === 'Stage'}
              onDragEnd={type === 'Stage' ? () => setEnded(true) : undefined}
            >
              <Layer>
                <Rect
                  ref={rectRef}
                  width={50}
                  height={50}
                  draggable={type === 'Rect'}
                  onDragEnd={type === 'Rect' ? () => setEnded(true) : undefined}
                />
              </Layer>
            </Stage>
          )}
        </>
      );
    };
    const view = render(<App />);
    const node = type === 'Rect' ? rectRef.current! : view.stage()!;
    act(() => {
      view.stage()!.simulateMouseDown({ x: 10, y: 10 });
      node.startDrag();
    });
    expect(node.isDragging()).toBe(true);
    act(hide);
    expect(node.isDragging()).toBe(false);
    expect(view.container.querySelector('output')!.textContent).toBe('ended');
    expect(Konva.stages).toHaveLength(0);
  });

  it('disabling an active drag during a commit lets onDragEnd update DOM state', () => {
    let disable!: () => void;
    const rectRef = React.createRef<Konva.Rect>();
    const App = () => {
      const [draggable, setDraggable] = React.useState(true);
      const [ended, setEnded] = React.useState(false);
      const onDragEnd = React.useCallback(() => setEnded(true), []);
      disable = () => setDraggable(false);
      return (
        <>
          <output>{ended ? 'ended' : 'dragging'}</output>
          <Stage width={100} height={100}>
            <Layer>
              <Rect
                ref={rectRef}
                width={50}
                height={50}
                draggable={draggable}
                onDragEnd={onDragEnd}
              />
            </Layer>
          </Stage>
        </>
      );
    };
    const view = render(<App />);
    act(() => {
      view.stage()!.simulateMouseDown({ x: 10, y: 10 });
      rectRef.current!.startDrag();
    });
    expect(rectRef.current!.isDragging()).toBe(true);
    act(disable);
    expect(rectRef.current!.isDragging()).toBe(false);
    expect(view.container.querySelector('output')!.textContent).toBe('ended');
  });

  it('unmount releases React handlers on Stage and every descendant', async () => {
    const handler = vi.fn();
    const rectRef = React.createRef<Konva.Rect>();
    const groupRef = React.createRef<Konva.Group>();
    const view = render(
      <Stage width={50} height={50} onClick={handler}>
        <Layer>
          <Group ref={groupRef} onClick={handler}>
            <Rect ref={rectRef} onClick={handler} />
          </Group>
        </Layer>
      </Stage>
    );
    const nodes = [view.stage()!, groupRef.current!, rectRef.current!];
    nodes.forEach((node) => node.fire('click'));
    expect(handler).toHaveBeenCalledTimes(3);
    handler.mockClear();
    view.unmount();
    await vi.waitFor(() => expect(Konva.stages.length).toBe(0));
    nodes.forEach((node) => node.fire('click'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('§9.2 high-frequency drag — many state updates per second, no dropped commits', () => {
    let stageRef!: Konva.Stage;
    const App = () => {
      const [x, setX] = React.useState(0);
      const ref = React.useRef<Konva.Stage>(null);
      React.useLayoutEffect(() => {
        if (ref.current) stageRef = ref.current;
      });
      return (
        <Stage
          ref={ref}
          width={500}
          height={100}
          onMouseMove={(e) => setX(e.evt.clientX)}
        >
          <Layer>
            <Rect width={20} height={20} x={x} />
          </Layer>
        </Stage>
      );
    };
    render(<App />);
    act(() => {
      stageRef!.simulateMouseDown({ x: 0, y: 0 });
      for (let i = 1; i <= 30; i++) {
        stageRef!.simulateMouseMove({ x: i * 5, y: 0 });
      }
      stageRef!.simulateMouseUp({ x: 150, y: 0 });
    });
    // Final x should match the last mouseMove, not be stuck at an earlier value.
    expect((stageRef!.findOne('Rect') as Konva.Rect).x()).toBe(150);
  });

  it('§9.3 onClick + onMouseUp ordering — both fire and both commits land', () => {
    let stageRef!: Konva.Stage;
    const log: string[] = [];
    const App = () => {
      const [n, setN] = React.useState(0);
      const ref = React.useRef<Konva.Stage>(null);
      React.useLayoutEffect(() => {
        if (ref.current) stageRef = ref.current;
      });
      return (
        <Stage ref={ref} width={50} height={50}>
          <Layer>
            <Rect
              width={50}
              height={50}
              onMouseDown={() => {
                log.push('down');
                setN((v) => v + 1);
              }}
              onMouseUp={() => {
                log.push('up');
                setN((v) => v + 10);
              }}
              onClick={() => {
                log.push('click');
                setN((v) => v + 100);
              }}
              name={`n-${n}`}
            />
          </Layer>
        </Stage>
      );
    };
    render(<App />);
    act(() => {
      stageRef!.simulateMouseDown({ x: 10, y: 10 });
      stageRef!.simulateMouseUp({ x: 10, y: 10 });
    });
    expect(log[0]).toBe('down');
    expect(log).toContain('up');
    expect(log).toContain('click');
    // Final n reflects all three handlers' state updates.
    expect(stageRef!.findOne(`.n-111`)).toBeInstanceOf(Konva.Rect);
  });

  it('§9.4 unmount clears react-konva event listeners — handler does not fire post-unmount', async () => {
    // Concrete contract: after react-konva unmounts, the user's handler
    // installed via JSX (e.g. onMouseDown) must not fire if the underlying
    // Konva node is later poked. react-konva removes its own event listeners
    // when React deletes the node; Konva.destroy() does not remove them.
    const layerRef = React.createRef<Konva.Layer>();
    const handler = vi.fn();
    const App = () => (
      <Stage width={50} height={50}>
        <Layer ref={layerRef} onMouseDown={handler} />
      </Stage>
    );
    const result = render(<App />);
    const layer = layerRef.current!;
    expect(layer).toBeInstanceOf(Konva.Layer);

    // Sanity: a direct .fire('mousedown') on the layer DOES invoke the
    // handler while mounted — proving react-konva installed the listener.
    layer.fire('mousedown', { evt: {} as any } as any);
    expect(handler).toHaveBeenCalledTimes(1);
    handler.mockClear();

    result.unmount();
    await vi.waitFor(() => expect(Konva.stages.length).toBe(0));

    // After unmount, the Konva node is destroyed. Firing post-destroy must
    // NOT invoke the React-side handler — react-konva's listener is gone.
    layer.fire('mousedown', { evt: {} as any } as any);
    expect(handler).not.toHaveBeenCalled();
  });

  it('§9.5 changing key order during a drag does not stop the drag', () => {
    // Drag state is on the Konva node; changing React key order must not
    // remount the dragged node and thereby cancel the drag.
    let stageRef!: Konva.Stage;
    const App = ({ kids }: { kids: React.ReactElement[] }) => (
      <Stage
        ref={(s) => {
          if (s) stageRef = s;
        }}
        width={300}
        height={300}
      >
        <Layer>{kids}</Layer>
      </Stage>
    );
    const initialKids = [
      <Rect key="1" name="rect1" />,
      <Rect key="2" name="rect2" />,
      <Rect key="3" name="rect3" />,
    ];
    const { rerender } = render(<App kids={initialKids} />);
    const rect1 = stageRef!.findOne('.rect1') as Konva.Rect;

    act(() => stageRef!.simulateMouseDown({ x: 5, y: 5 }));
    act(() => rect1.startDrag());
    act(() => stageRef!.simulateMouseMove({ x: 10, y: 10 }));
    expect(rect1.isDragging()).toBe(true);

    // Reorder keys mid-drag.
    const reorderedKids = [
      <Rect key="3" name="rect3" />,
      <Rect key="1" name="rect1" />,
      <Rect key="2" name="rect2" />,
    ];
    rerender(<App kids={reorderedKids} />);
    expect(rect1.isDragging()).toBe(true);
    rect1.stopDrag();
  });
});
