import * as React from 'react';
import { it, expect, vi } from 'vitest';
import { render, cleanup } from './helpers/render';

it('cleanup reports unmount errors and still removes the other roots', () => {
  const reported: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    if (event.message.includes('unmount failure')) {
      reported.push(event.error);
      event.preventDefault();
    }
  };
  const BrokenCleanup = () => {
    React.useLayoutEffect(() => () => {
      throw new Error('unmount failure');
    }, []);
    return <div />;
  };
  const healthy = render(<div />);
  const broken = render(<BrokenCleanup />);
  // Production React also reports this intentional error to the console.
  const originalError = console.error;
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (!String(args[0]).includes('unmount failure')) originalError(...args);
  });
  window.addEventListener('error', onError);
  try {
    try {
      cleanup();
    } catch (error) {
      reported.push(error);
    }
    expect(reported).toHaveLength(1);
    expect(String(reported[0])).toContain('unmount failure');
    expect(healthy.container.isConnected).toBe(false);
    expect(broken.container.isConnected).toBe(false);
  } finally {
    errorSpy.mockRestore();
    window.removeEventListener('error', onError);
  }
});
