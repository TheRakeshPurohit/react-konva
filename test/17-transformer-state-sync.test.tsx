// §17 — Konva read-after-fire contract: state set inside a Konva event handler
// must be committed before Konva's own synchronous post-event reads.
//
// The concrete bug (reported with Transformer + the standard scale-reset
// pattern): Konva's Transformer fires "transform", the user handler resets
// scale to 1 and moves the size into React state, and Transformer.update()
// IMMEDIATELY (synchronously) repositions its outline/anchors from the node.
// With a purely async (microtask) commit the node still has the OLD
// state-driven size at that moment, so the transformer chrome is measured one
// event behind on every mousemove — and, because Transformer skips update()
// while `_transforming`, the late commit never repositions it. The outline
// visibly separates from the shape during a fast resize and stays wrong after
// mouseup.
//
// Note the shape itself does NOT lag: the microtask commit always lands before
// the frame's rAF draw. Only synchronous read-after-fire consumers (Transformer
// chrome) see stale state — which is why react-konva flushes pending reconciler
// work right after each Konva event handler returns (wrapEventHandler in
// makeUpdates.ts).
//
// Real-app conditions: IS_REACT_ACT_ENVIRONMENT=false, real window mousemove
// events through Konva's own Transformer listeners — no act(), no microtask
// drain that would mask the timing.

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Konva from 'konva';
import { Stage, Layer, Rect, Transformer } from '../src/ReactKonva';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;

const roots: { root: Root; container: HTMLElement }[] = [];
function mount(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(ui));
  roots.push({ root, container });
}
afterEach(() => {
  while (roots.length) {
    const { root, container } = roots.pop()!;
    flushSync(() => root.unmount());
    container.remove();
  }
  Konva.stages.forEach((s) => s.destroy());
  Konva.stages.length = 0;
});

const raf = () => new Promise((r) => requestAnimationFrame(r));

// Transformer outline width as drawn: distance between corner anchors.
function outlineWidth(tr: Konva.Transformer) {
  const tl = tr.findOne('.top-left')!.getAbsolutePosition();
  const br = tr.findOne('.bottom-right')!.getAbsolutePosition();
  return br.x - tl.x;
}

function setupTransformBox() {
  let rectNode!: Konva.Rect;
  let trNode!: Konva.Transformer;
  const Box = () => {
    const [box, setBox] = React.useState({ x: 80, y: 80, width: 160, height: 160 });
    const rectRef = React.useRef<Konva.Rect>(null);
    const trRef = React.useRef<Konva.Transformer>(null);
    React.useLayoutEffect(() => {
      rectNode = rectRef.current!;
      trNode = trRef.current!;
      trRef.current!.nodes([rectRef.current!]);
    }, []);
    return (
      <>
        <Rect
          ref={rectRef}
          {...box}
          fill="tomato"
          onTransform={(e: any) => {
            // The standard react-konva transform pattern: bake scale into
            // state-driven width/height, reset scale on the node.
            const node = e.target;
            const sx = node.scaleX();
            const sy = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            setBox({
              x: node.x(),
              y: node.y(),
              width: Math.max(5, node.width() * sx),
              height: Math.max(5, node.height() * sy),
            });
          }}
        />
        <Transformer ref={trRef} keepRatio={false} rotateEnabled={false} />
      </>
    );
  };
  mount(
    <Stage width={600} height={600}>
      <Layer>
        <Box />
      </Layer>
    </Stage>
  );
  const stage = Konva.stages[Konva.stages.length - 1];

  // Start a real transform on the bottom-right anchor (Konva's own path:
  // anchor mousedown installs window mousemove/mouseup listeners).
  const anchor = trNode.findOne('.bottom-right')!;
  const crect = stage.content.getBoundingClientRect();
  const ap = anchor.getAbsolutePosition(); // (240, 240)
  const at = (dx: number) => ({
    clientX: ap.x + dx + crect.left,
    clientY: ap.y + crect.top,
  });
  stage.setPointersPositions(at(0) as any);
  anchor.fire('mousedown', { evt: at(0) } as any);
  const move = (dx: number) =>
    window.dispatchEvent(new MouseEvent('mousemove', at(dx)));
  const up = (dx: number) =>
    window.dispatchEvent(new MouseEvent('mouseup', at(dx)));

  return { rect: () => rectNode, tr: () => trNode, move, up };
}

describe('§17 transformer + state-driven size stays in sync', () => {
  it('§17.1 transformer outline matches the shape on every frame of a resize', async () => {
    const { rect, tr, move, up } = setupTransformBox();

    // Frame 1: drag bottom-right +40px.
    move(40);
    await raf(); // frame paints here
    expect(rect().width()).toBe(200);
    expect(outlineWidth(tr())).toBe(200); // chrome must hug the shape

    // Frame 2: +40 more. (Stale-read bug: outline lags one event behind.)
    move(80);
    await raf();
    expect(rect().width()).toBe(240);
    expect(outlineWidth(tr())).toBe(240);

    // End the transform: outline must match the final shape, not the
    // second-to-last one.
    up(80);
    await raf();
    expect(rect().width()).toBe(240);
    expect(outlineWidth(tr())).toBe(240);
  });

  it('§17.2 setState inside a Konva handler is visible to synchronous post-event reads', () => {
    // Konva's contract for its own internals (Transformer.update, drag logic):
    // after an event handler returns, the node reflects the handler's changes.
    // react-konva keeps that contract for state-driven props by flushing
    // pending reconciler work right after the handler.
    const { rect, move, up } = setupTransformBox();
    move(40);
    // Synchronously after the event — before any microtask — the committed,
    // state-driven width must be on the node (this is what Transformer reads).
    expect(rect().width()).toBe(200);
    expect(rect().scaleX()).toBe(1);
    up(40);
  });
});
