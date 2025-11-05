/**
 * WebGPU shaders for Stratified Time
 */

export const PHYSICS_COMPUTE_SHADER = `
struct Uniforms {
  deltaTime: f32,
  gravity: f32,
  groundLevel: f32,
  damping: f32,
  time: f32,
  frame: u32,
}

struct Particle {
  position: vec3<f32>,
  velocity: vec3<f32>,
  mass: f32,
  settled: f32, // 0 = active, 1 = settled
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let index = globalId.x;
  if (index >= arrayLength(&particles)) {
    return;
  }

  var particle = particles[index];

  // Skip if already settled
  if (particle.settled > 0.5) {
    return;
  }

  let dt = uniforms.deltaTime;

  // Apply gravity
  particle.velocity.y -= uniforms.gravity * dt;

  // Apply damping
  particle.velocity *= uniforms.damping;

  // Integrate position
  particle.position += particle.velocity * dt;

  // Ground collision
  if (particle.position.y <= uniforms.groundLevel) {
    particle.position.y = uniforms.groundLevel;
    particle.velocity.y *= -0.3; // Bounce with loss

    // Settle if slow enough
    let speed = length(particle.velocity);
    if (speed < 0.5) {
      particle.velocity = vec3<f32>(0.0);
      particle.settled = 1.0;
    }
  }

  particles[index] = particle;
}
`;

export const OBJECT_VERTEX_SHADER = `
struct Uniforms {
  viewProjection: mat4x4<f32>,
  time: f32,
}

struct ObjectData {
  position: vec3<f32>,
  rotation: f32,
  scale: vec3<f32>,
  color: vec3<f32>,
}

struct VertexInput {
  @location(0) position: vec3<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<uniform> objectData: ObjectData;

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;

  // Apply rotation around Y axis
  let c = cos(objectData.rotation);
  let s = sin(objectData.rotation);
  let rotMatrix = mat3x3<f32>(
    vec3<f32>(c, 0.0, s),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(-s, 0.0, c)
  );

  // Transform vertex
  var worldPos = rotMatrix * (input.position * objectData.scale);
  worldPos += objectData.position;

  output.position = uniforms.viewProjection * vec4<f32>(worldPos, 1.0);
  output.color = objectData.color;
  output.worldPos = worldPos;

  return output;
}
`;

export const OBJECT_FRAGMENT_SHADER = `
struct FragmentInput {
  @location(0) color: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  // Simple shading with height-based darkening
  let heightFactor = clamp(input.worldPos.y / 50.0, 0.0, 1.0);
  let shadedColor = input.color * (0.4 + 0.6 * heightFactor);

  // Add subtle noise texture
  let noise = fract(sin(dot(input.worldPos.xz, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let finalColor = shadedColor * (0.9 + 0.1 * noise);

  return vec4<f32>(finalColor, 1.0);
}
`;

export const STRATA_VERTEX_SHADER = `
struct Uniforms {
  viewProjection: mat4x4<f32>,
}

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) uv: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) worldY: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.viewProjection * vec4<f32>(input.position, 1.0);
  output.uv = input.uv;
  output.worldY = input.position.y;
  return output;
}
`;

export const STRATA_FRAGMENT_SHADER = `
struct FragmentInput {
  @location(0) uv: vec2<f32>,
  @location(1) worldY: f32,
}

@group(0) @binding(1) var strataSampler: sampler;
@group(0) @binding(2) var strataTexture: texture_2d<f32>;

// Hash function for noise
fn hash(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  let p3_dot = dot(p3, vec3<f32>(p3.yzx) + 33.33);
  return fract((p3.x + p3.y) * p3_dot);
}

fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);

  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));

  let u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

@fragment
fn main(input: FragmentInput) -> @location(0) vec4<f32> {
  // Sample accumulated strata texture
  let strataColor = textureSample(strataTexture, strataSampler, input.uv);

  // Add layered sediment texture
  let n1 = noise(input.uv * 200.0);
  let n2 = noise(input.uv * 100.0 + vec2<f32>(3.7, 1.2));
  let sediment = n1 * 0.3 + n2 * 0.2;

  // Darken based on depth (lower = older = darker)
  let depthFactor = clamp(input.worldY / 20.0, 0.0, 1.0);
  let agingFactor = 0.3 + 0.7 * depthFactor;

  // Desaturate deeper layers
  let gray = dot(strataColor.rgb, vec3<f32>(0.299, 0.587, 0.114));
  let desaturated = mix(vec3<f32>(gray), strataColor.rgb, depthFactor);

  var finalColor = desaturated * agingFactor;
  finalColor += vec3<f32>(sediment * 0.1);

  return vec4<f32>(finalColor, strataColor.a);
}
`;

export const FULLSCREEN_VERTEX_SHADER = `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Generate fullscreen triangle
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);

  output.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  output.uv = vec2<f32>(x, y);

  return output;
}
`;
