const VERT_SRC = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uAccent;
out vec4 outColor;

float hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p.x + p.y) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  float t = uTime * 0.1;
  float field = noise(uv * 4.0 + t) * 0.6 + noise(uv * 12.0 - t) * 0.4;
  vec3 base = mix(vec3(0.05, 0.05, 0.08), vec3(0.01, 0.03, 0.08), uv.y);
  vec3 glow = mix(base, uAccent, field);
  outColor = vec4(glow, 1.0);
}`;

export const shaderGradient = {
  id: 'shader-gradient',
  title: 'Shader Gradient',
  description: 'WebGL2 fragment shader playground with live uniforms.',
  tags: ['webgl2', 'gpu'],
  background: '#02030b',
  context: 'webgl2',
  controls: [
    { key: 'timeScale', label: 'Time Scale', type: 'range', min: 0.1, max: 5, step: 0.1, value: 1 },
    { key: 'accent', label: 'Accent', type: 'color', value: '#ff6d6d' },
  ],
  create(env) {
    const gl = env.gl;
    if (!gl) {
      throw new Error('WebGL2 context unavailable.');
    }

    const program = createProgram(gl, VERT_SRC, FRAG_SRC);
    const attrib = gl.getAttribLocation(program, 'position');
    const resolutionUniform = gl.getUniformLocation(program, 'uResolution');
    const timeUniform = gl.getUniformLocation(program, 'uTime');
    const accentUniform = gl.getUniformLocation(program, 'uAccent');

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1,
      ]),
      gl.STATIC_DRAW
    );

    const state = {
      timeScale: 1,
      accent: hexToVec('#ff6d6d'),
    };

    gl.useProgram(program);
    gl.enableVertexAttribArray(attrib);
    gl.vertexAttribPointer(attrib, 2, gl.FLOAT, false, 0, 0);

    const update = ({ now }) => {
      const { width, height } = env.size();
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      gl.uniform2f(resolutionUniform, width, height);
      gl.uniform1f(timeUniform, now * 0.001 * state.timeScale);
      gl.uniform3fv(accentUniform, state.accent);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    return {
      update,
      onControlChange(key, value) {
        if (key === 'accent') {
          state.accent = hexToVec(value);
        } else if (key === 'timeScale') {
          state.timeScale = value;
        }
      },
      destroy() {
        gl.deleteBuffer(quad);
        gl.deleteProgram(program);
      },
    };
  },
};

function createProgram(gl, vert, frag) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${info}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function hexToVec(hex) {
  const normalized = hex.replace('#', '');
  const bigint = parseInt(normalized.length === 3 ? normalized.repeat(2) : normalized, 16);
  return [((bigint >> 16) & 255) / 255, ((bigint >> 8) & 255) / 255, (bigint & 255) / 255];
}
