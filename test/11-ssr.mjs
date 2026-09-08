// Server rendering must work without a DOM or a native canvas backend.
// Run against built files so packaging and both module formats are exercised.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { enableStaticRendering, observer } from 'mobx-react-lite';
import { observable, onBecomeObserved } from 'mobx';

assert.equal(typeof globalThis.window, 'undefined');
assert.equal(typeof globalThis.document, 'undefined');

const require = createRequire(import.meta.url);
const entries = [
  ['CommonJS core', () => require('../lib/ReactKonvaCore.js')],
  ['ES module core', () => import('../es/ReactKonvaCore.js')],
  ['package main', () => require('..')],
  ['ES module full', () => import('../es/ReactKonva.js')],
];

enableStaticRendering(true);
try {
  for (const [name, load] of entries) {
    const { Stage, Layer, Rect, KonvaRenderer } = await load();
    assert.equal(typeof KonvaRenderer, 'object');
    const stageRef = React.createRef();
    const store = observable({ title: 'Server drawing' });
    let subscriptions = 0;
    const dispose = onBecomeObserved(store, 'title', () => subscriptions++);
    const Canvas = observer(() => React.createElement(
      Stage,
      { ref: stageRef, width: 50, height: 50, role: 'img', title: store.title },
      React.createElement(Layer, null, React.createElement(Rect, { fill: 'red' })),
    ));
    assert.equal(
      renderToString(React.createElement(Canvas)),
      '<div role="img" title="Server drawing"></div>',
      `${name}: Stage renders its container without mounting canvas children`,
    );
    assert.equal(stageRef.current, null, `${name}: no Stage is created on the server`);
    assert.equal(subscriptions, 0, `${name}: no MobX subscription`);
    dispose();
    console.log(`${name}: server rendering OK`);
  }
} finally {
  enableStaticRendering(false);
}

// Exercise a missing optional capability using the installed latest Konva.
// A missing hook must not prevent core imports or server rendering.
for (const entry of ['lib/ReactKonvaCore.js', 'es/ReactKonvaCore.js']) {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import React from 'react';
    import { renderToString } from 'react-dom/server';
    import Konva from 'konva/lib/Core.js';
    Konva.Stage.prototype.eventBatchFunc = undefined;
    const { Stage } = await import('./${entry}');
    assert.equal(renderToString(React.createElement(Stage, { title: 'Fallback' })), '<div title="Fallback"></div>');
  `], { cwd: new URL('..', import.meta.url), stdio: 'inherit' });
  console.log(`${entry}: missing native batch hook supported`);
}
