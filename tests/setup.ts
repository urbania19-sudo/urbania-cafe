import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = () => 'blob:mock-url';
  }
  if (!window.URL.revokeObjectURL) {
    window.URL.revokeObjectURL = () => {};
  }

  if (typeof HTMLCanvasElement !== 'undefined') {
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function () {
      return {
        scale: () => {},
        measureText: () => ({ width: 50 }),
        fillRect: () => {},
        fillText: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        setLineDash: () => {},
        save: () => {},
        restore: () => {},
      };
    };
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(new Blob(['mock-png'], { type: 'image/png' }));
    };
    HTMLCanvasElement.prototype.toDataURL = function () {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    };
  }

  // Anchor click mocking
  HTMLAnchorElement.prototype.click = function () {};
}
