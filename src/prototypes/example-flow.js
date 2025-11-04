const TWO_PI = Math.PI * 2;

export const flowField = {
  id: 'flow-field',
  title: 'Flow Field Sketch',
  description:
    'CPU-based flow field driven by a simple curl noise. Demonstrates the base loop, controls, and pointer interaction hooks.',
  tags: ['canvas', '2d', 'noise'],
  background: '#05060a',
  controls: [
    { key: 'particleCount', label: 'Particles', type: 'range', min: 64, max: 2048, step: 32, value: 640 },
    { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 4, step: 0.1, value: 1.2 },
    { key: 'persistence', label: 'Persistence', type: 'range', min: 0.85, max: 0.999, step: 0.001, value: 0.94 },
    { key: 'stroke', label: 'Stroke', type: 'color', value: '#8be9fd' },
  ],
  create(env) {
    const state = {
      particles: [],
      particleCount: 640,
      speed: 1.2,
      persistence: 0.94,
      stroke: '#8be9fd',
      lastPointer: null,
    };

    const resetParticles = () => {
      state.particles = Array.from({ length: state.particleCount }, () => spawnParticle(env.size()));
    };

    resetParticles();

    const update = ({ ctx, dt }) => {
      if (!ctx) return;
      const { width, height } = env.size();
      ctx.fillStyle = `rgba(5, 6, 10, ${1 - state.persistence})`;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = state.stroke;

      state.particles.forEach((particle) => {
        const force = sampleField(particle.x, particle.y, performance.now() * 0.00005);
        particle.vx += Math.cos(force) * state.speed * dt * 60;
        particle.vy += Math.sin(force) * state.speed * dt * 60;

        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.95;
        particle.vy *= 0.95;

        if (state.lastPointer) {
          const dx = state.lastPointer.x - particle.x;
          const dy = state.lastPointer.y - particle.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          particle.vx -= (dx / dist) * 0.01;
          particle.vy -= (dy / dist) * 0.01;
        }

        if (particle.x < 0 || particle.y < 0 || particle.x > width || particle.y > height) {
          Object.assign(particle, spawnParticle({ width, height }));
        }

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 0.6, 0, TWO_PI);
        ctx.fill();
      });
    };

    return {
      update,
      onPointer(event) {
        if (event.type === 'pointerup') {
          state.lastPointer = null;
          return;
        }
        state.lastPointer = { x: event.x, y: event.y };
      },
      onControlChange(key, value) {
        state[key] = value;
        if (key === 'particleCount') resetParticles();
      },
      destroy() {
        state.particles = [];
      },
    };
  },
};

function spawnParticle({ width, height }) {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0,
    vy: 0,
  };
}

function sampleField(x, y, t) {
  const scale = 0.0008;
  const noise = pseudoNoise(x * scale, y * scale, t);
  return noise * TWO_PI;
}

function pseudoNoise(x, y, t) {
  return fract(Math.sin(dot([x, y, t], [12.9898, 78.233, 37.719])) * 43758.5453);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function fract(value) {
  return value - Math.floor(value);
}
