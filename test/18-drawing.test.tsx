import * as React from 'react';
import { it, expect } from 'vitest';
import Konva from 'konva';
import { Stage, Layer, Rect } from '../src/ReactKonva';
import { render } from './helpers/render';

// Read actual pixels after Konva's scheduled drawing, without forcing a draw.
const nextFrame = () => new Promise(requestAnimationFrame);
const pixel = (layer: Konva.Layer) =>
  Array.from(layer.getContext().getImageData(5, 5, 1, 1).data);

it('revealing Activity repaints its existing nodes when autoDraw is disabled', async () => {
  const previous = Konva.autoDrawEnabled;
  Konva.autoDrawEnabled = false;
  try {
    const rectRef = React.createRef<Konva.Rect>();
    const App = ({ mode }: { mode: 'visible' | 'hidden' }) => (
      <Stage width={50} height={50}>
        <Layer>
          <React.Activity mode={mode}>
            <Rect ref={rectRef} width={20} height={20} fill="red" />
            <Rect width={20} height={20} fill="blue" visible={false} />
          </React.Activity>
        </Layer>
      </Stage>
    );
    const view = render(<App mode="visible" />);
    const layer = view.stage()!.getLayers()[0];
    const rect = rectRef.current;
    await nextFrame();
    expect(pixel(layer)).toEqual([255, 0, 0, 255]);
    view.rerender(<App mode="hidden" />);
    await nextFrame();
    expect(pixel(layer)).toEqual([0, 0, 0, 0]);
    view.rerender(<App mode="visible" />);
    await nextFrame();
    expect(rectRef.current).toBe(rect);
    expect(pixel(layer)).toEqual([255, 0, 0, 255]);
  } finally {
    Konva.autoDrawEnabled = previous;
  }
});

it('removing fill repaints existing pixels when autoDraw is disabled', async () => {
  const previous = Konva.autoDrawEnabled;
  Konva.autoDrawEnabled = false;
  try {
    const App = ({ filled }: { filled: boolean }) => (
      <Stage width={50} height={50}>
        <Layer>
          <Rect width={20} height={20} {...(filled ? { fill: 'red' } : {})} />
        </Layer>
      </Stage>
    );
    const view = render(<App filled />);
    const layer = view.stage()!.getLayers()[0];
    await nextFrame();
    expect(pixel(layer)).toEqual([255, 0, 0, 255]);
    view.rerender(<App filled={false} />);
    await nextFrame();
    expect(pixel(layer)).toEqual([0, 0, 0, 0]);
  } finally {
    Konva.autoDrawEnabled = previous;
  }
});
