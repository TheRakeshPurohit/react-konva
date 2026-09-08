import * as React from 'react';
import Konva from 'konva';
import { runInAction } from 'mobx';
import { Stage, Layer, Group, Rect, Transformer, useContextBridge } from '../..';

const stageRef = React.createRef<Konva.Stage>();
const rectRef = React.createRef<Konva.Rect>();
const transformerRef = React.createRef<Konva.Transformer>();

const canvas = (
  <Stage ref={stageRef} width={100} height={100} role="img" title="Drawing">
    <Layer>
      <Rect
        ref={rectRef}
        fill="red"
        onClick={(event) => {
          const mouse: MouseEvent = event.evt;
          mouse.preventDefault();
        }}
      />
      <Group clipWidth={100} clipHeight={100}>
        <Transformer ref={transformerRef} />
      </Group>
    </Layer>
  </Stage>
);

const withCleanup = <Stage ref={(stage) => {
  stage?.width(100);
  return () => {};
}} />;
function BridgedCanvas() {
  const Bridge = useContextBridge();
  return <Bridge>{canvas}</Bridge>;
}

// Exported components are JSX elements, not objects exposing node methods.
// @ts-expect-error Use a ref to get the Konva node.
Rect.getNativeNode();
// @ts-expect-error Use a ref to get the Konva node.
Stage.getPublicInstance();

// @ts-expect-error Rect refs must receive a Konva.Rect, not a DOM element.
const wrongRef = <Rect ref={React.createRef<HTMLDivElement>()} />;
// @ts-expect-error Mouse events are not touch events.
const wrongEvent = <Rect onClick={(event: Konva.KonvaEventObject<TouchEvent>) => {}} />;

void [canvas, withCleanup, BridgedCanvas, wrongRef, wrongEvent];

const customBatch = <Stage eventBatchFunc={(run) => run()} />;
const mobxBatch = <Stage eventBatchFunc={runInAction} />;
// @ts-expect-error A batch wrapper receives a callback, not an event or number.
const wrongBatch = <Stage eventBatchFunc={(value: number) => {}} />;
void [customBatch, mobxBatch, wrongBatch];
