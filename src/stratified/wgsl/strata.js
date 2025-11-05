export const DECAY_SHADER = /* wgsl */ `
struct StrataParams {
  viewRes : vec4f,
  brush : vec4f,
  contact : vec4f,
};

@group(0) @binding(0) var<uniform> params : StrataParams;
@group(0) @binding(1) var strataSampler : sampler;
@group(0) @binding(2) var strataTexture : texture_2d<f32>;

struct FullscreenVertex {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex : u32) -> FullscreenVertex {
  var out : FullscreenVertex;
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  out.position = vec4f(x - 1.0, 1.0 - y, 0.0, 1.0);
  out.uv = vec2f(x, y);
  return out;
}

@fragment
fn fs_decay(input : FullscreenVertex) -> @location(0) vec4f {
  let decay = params.brush.z;
  let color = textureSampleLevel(strataTexture, strataSampler, input.uv, 0.0);
  return vec4f(color.rgb * decay, color.a * decay);
}
`;

export const STAMP_SHADER = /* wgsl */ `
struct StrataParams {
  viewRes : vec4f,
  brush : vec4f,
  contact : vec4f,
};

struct ContactRecord {
  position : vec4f,
  normalImpulse : vec4f,
  payload : vec4f,
};

@group(0) @binding(0) var<uniform> params : StrataParams;
@group(0) @binding(1) var<storage, read> contactRecords : array<ContactRecord>;

struct StampVertex {
  @builtin(position) position : vec4f,
  @location(0) weight : f32,
  @location(1) falloff : f32,
  @location(2) impulse : f32,
  @location(3) smear : f32,
  @location(4) normalXZ : vec2f,
};

struct StampOutput {
  @location(0) pigment : vec4f,
  @location(1) thickness : f32,
  @location(2) shear : vec2f,
};

fn quadVertex(vertexIndex : u32) -> vec2f {
  let x = select(-1.0, 1.0, (vertexIndex & 1u) == 1u);
  let y = select(-1.0, 1.0, (vertexIndex & 2u) == 2u);
  return vec2f(x, y);
}

@vertex
fn vs_stamp(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32
) -> StampVertex {
  var out : StampVertex;
  var total = bitcast<u32>(params.contact.x);
  let cap = bitcast<u32>(params.contact.y);
  total = min(total, cap);
  if (total == 0u || instanceIndex >= total) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.weight = 0.0;
    return out;
  }
  let record = contactRecords[instanceIndex];
  let resolution = params.viewRes.xy;
  let extent = params.viewRes.zw;
  if (extent.x <= 0.0 || extent.y <= 0.0) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.weight = 0.0;
    return out;
  }
  var uv = (record.position.xz / extent) + vec2f(0.5, 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.weight = 0.0;
    return out;
  }
  let quad = quadVertex(vertexIndex);
  let halfSize = params.brush.x * 0.5;
  var pixel = uv * resolution + quad * halfSize;
  let ndcX = (pixel.x / resolution.x) * 2.0 - 1.0;
  let ndcY = 1.0 - (pixel.y / resolution.y) * 2.0;
  out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  let impulse = max(record.normalImpulse.w, 0.0);
  let noise = fract(sin(record.position.w * 12.9898 + params.brush.w) * 43758.5453);
  let materialId = record.payload.x;
  let materialBias = fract(materialId * 0.137 + 0.1);
  out.weight = clamp((impulse * params.brush.y) + noise * 0.05, 0.0, 1.0);
  out.weight *= 0.75 + materialBias * 0.5;
  out.falloff = exp(-dot(quad, quad) * 0.85);
  out.impulse = impulse;
  out.smear = max(record.payload.z, 0.1);
  out.normalXZ = normalize(record.normalImpulse.xz + vec2f(1e-4));
  return out;
}

@fragment
fn fs_stamp(input : StampVertex) -> StampOutput {
  if (input.weight <= 0.0) {
    discard;
  }
  let falloff = clamp(input.falloff, 0.0, 1.0);
  let impulse = input.impulse;
  let smear = input.smear;
  let base = vec3f(0.85, 0.7, 0.58);
  let accent = vec3f(0.32, 0.4, 0.55);
  let mixVal = clamp(input.weight * 1.2, 0.0, 1.0);
  let color = mix(accent, base, mixVal);
  let pigmentWeight = input.weight * falloff;
  let pigment = vec4f(color * pigmentWeight, pigmentWeight);
  let thickness = impulse * falloff;
  let shearVec = normalize(input.normalXZ.yx * vec2f(1.0, -1.0));
  let shearWeight = impulse * falloff * smear * 0.35;
  let shear = shearVec * shearWeight;
  return StampOutput(pigment, thickness, shear);
}
`;

export const AGE_SHADER = /* wgsl */ `
struct StrataParams {
  viewRes : vec4f,
  brush : vec4f,
  contact : vec4f,
};

@group(0) @binding(0) var<uniform> params : StrataParams;
@group(0) @binding(1) var strataSampler : sampler;
@group(0) @binding(2) var strataTexture : texture_2d<f32>;

struct FullscreenVertex {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex : u32) -> FullscreenVertex {
  var out : FullscreenVertex;
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  out.position = vec4f(x - 1.0, 1.0 - y, 0.0, 1.0);
  out.uv = vec2f(x, y);
  return out;
}

@fragment
fn fs_age_thickness(input : FullscreenVertex) -> @location(0) f32 {
  let current = textureSampleLevel(strataTexture, strataSampler, input.uv, 0.0).r;
  return current * params.brush.z;
}

@fragment
fn fs_age_shear(input : FullscreenVertex) -> @location(0) vec2f {
  let current = textureSampleLevel(strataTexture, strataSampler, input.uv, 0.0).rg;
  return current * params.brush.z * 0.97;
}
`;
