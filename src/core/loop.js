export function createRenderLoop(callback) {
  let rafId = 0;
  let running = false;
  let last = performance.now();

  const tick = (now) => {
    if (!running) return;
    const dt = (now - last) / 1000;
    last = now;
    callback({ now, dt });
    rafId = requestAnimationFrame(tick);
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}
