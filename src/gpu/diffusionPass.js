const MAX_SAMPLES = 2048;
const FLOATS_PER_SAMPLE = 8; // x, y, radius, strength, r, g, b, solvent
const DECAY_PER_SECOND = 1.35;

function createProgram(gl, vertexSource, fragmentSource) {
  const vert = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vert, vertexSource);
  gl.compileShader(vert);
  if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(vert) || 'Unknown vertex shader error';
    gl.deleteShader(vert);
    throw new Error(info);
  }
  const frag = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(frag, fragmentSource);
  gl.compileShader(frag);
  if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(frag) || 'Unknown fragment shader error';
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    throw new Error(info);
  }
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    gl.deleteProgram(program);
    throw new Error(info);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

function createTexture(gl, width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA16F,
    width,
    height,
    0,
    gl.RGBA,
    gl.FLOAT,
    null,
  );
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function createFramebuffer(gl, texture) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fbo;
}

function createFullscreenQuad(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const data = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, buffer };
}

class DiffusionPass {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.width = 0;
    this.height = 0;
    this.supported = false;
    this.sampleArray = new Float32Array(MAX_SAMPLES * FLOATS_PER_SAMPLE);
    this.sampleCount = 0;
    this.sampleBuffer = null;
    this.scatterProgram = null;
    this.scatterUniforms = null;
    this.diffuseProgram = null;
    this.diffuseUniforms = null;
    this.fadeProgram = null;
    this.fadeUniforms = null;
    this.quad = null;
    this.fboA = null;
    this.fboB = null;
    this.texA = null;
    this.texB = null;
    this.lastTime = 0;
    this.decay = 1;
    this.queue = [];
    this.hasNewData = false;
  }

  initDiffusion({ width, height }) {
    if (!this.canvas) {
      this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
      if (!this.canvas) {
        this.supported = false;
        return false;
      }
      const gl = this.canvas.getContext('webgl2', {
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        antialias: false,
      });
      if (!gl) {
        this.supported = false;
        return false;
      }
      if (!gl.getExtension('EXT_color_buffer_float')) {
        this.supported = false;
        return false;
      }
      this.gl = gl;
      this.sampleBuffer = gl.createBuffer();
      this.quad = createFullscreenQuad(gl);
      this._createPrograms();
      this.supported = true;
    }
    this.resize(width, height);
    this.lastTime = performance.now ? performance.now() : Date.now();
    return this.supported;
  }

  resize(width, height) {
    if (!this.supported || !this.gl) return;
    if (width === this.width && height === this.height) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    const { gl } = this;
    const oldA = this.texA;
    const oldB = this.texB;
    try {
      this.texA = createTexture(gl, this.width, this.height);
      this.texB = createTexture(gl, this.width, this.height);
      if (this.fboA) gl.deleteFramebuffer(this.fboA);
      if (this.fboB) gl.deleteFramebuffer(this.fboB);
      this.fboA = createFramebuffer(gl, this.texA);
      this.fboB = createFramebuffer(gl, this.texB);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(this.scatterProgram.vao);
      gl.useProgram(this.scatterProgram);
      gl.uniform2f(this.scatterUniforms.uResolution, this.width, this.height);
      gl.bindVertexArray(null);
      gl.useProgram(null);
    } finally {
      if (oldA) gl.deleteTexture(oldA);
      if (oldB) gl.deleteTexture(oldB);
    }
  }

  queueSample({ x, y, radius, strength, color, solvent }) {
    if (!this.supported) return;
    if (this.sampleCount >= MAX_SAMPLES) return;
    const base = this.sampleCount * FLOATS_PER_SAMPLE;
    this.sampleArray[base + 0] = x;
    this.sampleArray[base + 1] = y;
    this.sampleArray[base + 2] = radius;
    this.sampleArray[base + 3] = strength;
    this.sampleArray[base + 4] = color[0];
    this.sampleArray[base + 5] = color[1];
    this.sampleArray[base + 6] = color[2];
    this.sampleArray[base + 7] = solvent;
    this.sampleCount += 1;
    this.hasNewData = true;
  }

  stepParticles(dt) {
    if (!this.supported || !this.gl) return;
    const { gl } = this;
    const width = this.width;
    const height = this.height;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    // Fade previous frame into texA
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.fadeProgram);
    gl.bindVertexArray(this.quad.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    const decay = Math.exp(-dt * DECAY_PER_SECOND);
    gl.uniform1f(this.fadeUniforms.uDecay, decay);
    gl.uniform1i(this.fadeUniforms.uTexture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (this.sampleCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
      gl.useProgram(this.scatterProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sampleBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.sampleArray.subarray(0, this.sampleCount * FLOATS_PER_SAMPLE), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(this.scatterProgram.vao);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 0);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 2 * 4);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 3 * 4);
      gl.vertexAttribPointer(3, 3, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 4 * 4);
      gl.vertexAttribPointer(4, 1, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 7 * 4);
      gl.drawArrays(gl.POINTS, 0, this.sampleCount);
      gl.disable(gl.BLEND);
      this.sampleCount = 0;
    }

    // Horizontal blur (texA -> texB)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.useProgram(this.diffuseProgram);
    gl.bindVertexArray(this.quad.vao);
    gl.uniform2f(this.diffuseUniforms.uDirection, 1, 0);
    gl.uniform2f(this.diffuseUniforms.uResolution, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texA);
    gl.uniform1i(this.diffuseUniforms.uTexture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Vertical blur (texB -> texA)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.uniform2f(this.diffuseUniforms.uDirection, 0, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.useProgram(null);
    gl.flush();

    // Swap so texB holds current for next fade
    const tmp = this.texA;
    this.texA = this.texB;
    this.texB = tmp;
    const tmpFbo = this.fboA;
    this.fboA = this.fboB;
    this.fboB = tmpFbo;
    this.hasNewData = false;
  }

  resolveSmear(targetCtx, opacity = 0.85) {
    if (!this.supported || !this.canvas || !targetCtx) return false;
    targetCtx.save();
    targetCtx.globalAlpha = opacity;
    targetCtx.globalCompositeOperation = 'lighter';
    targetCtx.drawImage(this.canvas, 0, 0, this.width, this.height);
    targetCtx.restore();
    return true;
  }

  clearField() {
    if (!this.supported || !this.gl) return;
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  queueStylus(samples) {
    if (!this.supported) return;
    for (const sample of samples) {
      this.queue.push(sample);
    }
  }

  flushQueued() {
    if (!this.supported) return;
    if (!this.queue.length) return;
    for (const sample of this.queue) {
      this.queueSample(sample);
    }
    this.queue.length = 0;
    this.hasNewData = true;
  }

  _createPrograms() {
    const { gl } = this;
    const scatterVS = `#version 300 es\nprecision highp float;\nlayout(location=0) in vec2 aPosition;\nlayout(location=1) in float aRadius;\nlayout(location=2) in float aStrength;\nlayout(location=3) in vec3 aColor;\nlayout(location=4) in float aSolvent;\nout float vStrength;\nout vec3 vColor;\nout float vSolvent;\nuniform vec2 uResolution;\nvoid main() {\n  vec2 xy = aPosition / uResolution;\n  vec2 clip = xy * 2.0 - 1.0;\n  gl_Position = vec4(clip, 0.0, 1.0);\n  gl_PointSize = max(aRadius, 1.0);\n  vStrength = aStrength;\n  vColor = aColor;\n  vSolvent = aSolvent;\n}`;
    const scatterFS = `#version 300 es\nprecision highp float;\nin float vStrength;\nin vec3 vColor;\nin float vSolvent;\nout vec4 fragColor;\nvoid main() {\n  vec2 d = gl_PointCoord * 2.0 - 1.0;\n  float falloff = exp(-dot(d, d) * 2.5);\n  float alpha = clamp(vStrength * falloff, 0.0, 1.5);\n  fragColor = vec4(vColor * alpha, alpha * mix(0.55, 1.0, vSolvent));\n}`;
    this.scatterProgram = createProgram(gl, scatterVS, scatterFS);
    this.scatterProgram.vao = gl.createVertexArray();
    gl.bindVertexArray(this.scatterProgram.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sampleBuffer);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.enableVertexAttribArray(3);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 0);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 2 * 4);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 3 * 4);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 4 * 4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, FLOATS_PER_SAMPLE * 4, 7 * 4);
    gl.bindVertexArray(null);
    this.scatterUniforms = {
      uResolution: gl.getUniformLocation(this.scatterProgram, 'uResolution'),
    };

    const diffuseVS = `#version 300 es\nprecision highp float;\nlayout(location=0) in vec2 aPosition;\nout vec2 vUv;\nvoid main() {\n  vUv = aPosition * 0.5 + 0.5;\n  gl_Position = vec4(aPosition, 0.0, 1.0);\n}`;
    const diffuseFS = `#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nuniform sampler2D uTexture;\nuniform vec2 uDirection;\nuniform vec2 uResolution;\nvoid main() {\n  vec2 texel = uDirection / max(uResolution, vec2(1.0));\n  vec4 sum = texture(uTexture, vUv) * 0.36;\n  sum += texture(uTexture, vUv + texel * 1.25) * 0.22;\n  sum += texture(uTexture, vUv - texel * 1.25) * 0.22;\n  sum += texture(uTexture, vUv + texel * 2.5) * 0.12;\n  sum += texture(uTexture, vUv - texel * 2.5) * 0.08;\n  float vis = clamp(sum.a, 0.0, 1.2);\n  fragColor = vec4(sum.rgb, vis);
}`;
    this.diffuseProgram = createProgram(gl, diffuseVS, diffuseFS);
    this.diffuseUniforms = {
      uTexture: gl.getUniformLocation(this.diffuseProgram, 'uTexture'),
      uDirection: gl.getUniformLocation(this.diffuseProgram, 'uDirection'),
      uResolution: gl.getUniformLocation(this.diffuseProgram, 'uResolution'),
    };

    const fadeVS = diffuseVS;
    const fadeFS = `#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 fragColor;\nuniform sampler2D uTexture;\nuniform float uDecay;\nvoid main() {\n  fragColor = texture(uTexture, vUv) * uDecay;\n}`;
    this.fadeProgram = createProgram(gl, fadeVS, fadeFS);
    this.fadeUniforms = {
      uTexture: gl.getUniformLocation(this.fadeProgram, 'uTexture'),
      uDecay: gl.getUniformLocation(this.fadeProgram, 'uDecay'),
    };

    gl.bindVertexArray(this.scatterProgram.vao);
    gl.useProgram(this.scatterProgram);
    gl.uniform2f(this.scatterUniforms.uResolution, this.width || 1, this.height || 1);
    gl.bindVertexArray(null);
  }
}

let sharedDiffusion = null;

export function getGpuDiffusionPass() {
  if (!sharedDiffusion) {
    sharedDiffusion = new DiffusionPass();
  }
  return sharedDiffusion;
}
