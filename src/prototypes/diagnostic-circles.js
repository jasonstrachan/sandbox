const TWO_PI = Math.PI * 2;

export const diagnosticCircles = {
  id: 'diagnostic-circles',
  title: 'Diagnostic Circles',
  description: 'Lightweight canvas sketch to confirm live bundling and prototype switching.',
  tags: ['diagnostic', 'canvas'],
  background: '#05060a',
  controls: [
    { key: 'circleCount', label: 'Circles', type: 'range', min: 4, max: 200, step: 4, value: 24 },
    { key: 'radius', label: 'Radius', type: 'range', min: 6, max: 64, step: 1, value: 20 },
    { key: 'speed', label: 'Angular Speed', type: 'range', min: 0.1, max: 5, step: 0.1, value: 1.5 },
    { key: 'hueOffset', label: 'Hue Offset', type: 'range', min: 0, max: 360, step: 5, value: 200 },
  ],
  create(env) {
    const state = {
      circleCount: 24,
      radius: 20,
      speed: 1.5,
      hueOffset: 200,
      tick: 0,
    };

    const update = ({ ctx, dt }) => {
      if (!ctx) return;
      state.tick += dt * state.speed;
      const { width, height } = env.size();
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      const orbit = Math.min(width, height) * 0.35;
      for (let i = 0; i < state.circleCount; i += 1) {
        const t = i / state.circleCount;
        const angle = state.tick + t * TWO_PI;
        const x = Math.cos(angle) * orbit;
        const y = Math.sin(angle) * orbit;
        const hue = (state.hueOffset + t * 360) % 360;
        ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
        ctx.beginPath();
        ctx.arc(x, y, state.radius, 0, TWO_PI);
        ctx.fill();
      }
      ctx.restore();
    };

    return {
      update,
      onControlChange(key, value) {
        state[key] = value;
      },
    };
  },
};
