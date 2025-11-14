export function createCanvasFrame(canvas) {
  if (!canvas) throw new Error('canvas is required for frame helpers');

  const getLogicalSize = () => ({ width: canvas.width, height: canvas.height });
  const frame = {
    origin: () => ({ x: 0, y: 0 }),
    axes: {
      right: { x: 1, y: 0 },
      down: { x: 0, y: 1 },
    },
    dpi: () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
    logicalSize: getLogicalSize,
    worldToCanvas(point) {
      return { x: point.x, y: point.y };
    },
    canvasToWorld(point) {
      return { x: point.x, y: point.y };
    },
    describe() {
      const size = getLogicalSize();
      return {
        origin: frame.origin(),
        axes: frame.axes,
        dpi: frame.dpi(),
        width: size.width,
        height: size.height,
      };
    },
  };

  return frame;
}
