import { sceneShaderHeader } from './shared.js';

export const STRATIFIED_SHADER = /* wgsl */ `
${sceneShaderHeader({ includeStrata: true })}

struct VertexInput {
  @location(0) position : vec3f,
  @builtin(vertex_index) vertexIndex : u32,
};

struct VertexOutput {
  @builtin(position) position : vec4f,
  @location(0) shade : f32,
};

fn isoProject(pos : vec3f) -> vec2f {
  let isoX = (pos.x - pos.z) * 0.70710678;
  let isoY = pos.y * -0.9 + (pos.x + pos.z) * 0.35;
  return vec2f(isoX, isoY);
}

@vertex
fn vs_main(input : VertexInput) -> VertexOutput {
  var out : VertexOutput;
  let isoScale = scene.viewB.x;
  let center = scene.viewA.zw;
  let resolution = scene.viewA.xy;
  var iso = isoProject(input.position) * isoScale + center;
  if (scene.viewD.z > 0.5) {
    iso = floor(iso) + vec2f(0.5, 0.5);
  }
  let ndcX = (iso.x / resolution.x) * 2.0 - 1.0;
  let ndcY = 1.0 - (iso.y / resolution.y) * 2.0;
  out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  out.shade = fract(sin(f32(input.vertexIndex) * 12.9898 + frame.time) * 43758.5453);
  return out;
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4f {
  let baseColor = scene.palette2.xyz;
  let highlight = scene.palette0.xyz;
  let accent = scene.palette1.xyz;
  var col = mix(baseColor, highlight, input.shade);
  col = mix(col, accent, 0.35);
  return vec4f(col, 1.0);
}
`;

export const GROUND_SHADER = /* wgsl */ `
${sceneShaderHeader({ includeStrata: true })}

struct GroundVertexInput {
  @location(0) position : vec3f,
};

struct GroundVertexOutput {
  @builtin(position) position : vec4f,
  @location(0) mixVal : f32,
  @location(1) strataUV : vec2f,
};

fn isoProject(pos : vec3f) -> vec2f {
  let isoX = (pos.x - pos.z) * 0.70710678;
  let isoY = pos.y * -0.9 + (pos.x + pos.z) * 0.35;
  return vec2f(isoX, isoY);
}

fn liftGround(pos : vec3f, time : f32, base : f32, amp : f32, freq : f32) -> vec3f {
  var lifted = pos;
  let wave = sin(pos.x * freq + time * 0.2) + cos(pos.z * freq);
  lifted.y = base + amp * 0.5 * wave;
  return lifted;
}

@vertex
fn vs_ground(input : GroundVertexInput) -> GroundVertexOutput {
  var out : GroundVertexOutput;
  let lifted = liftGround(input.position, frame.time, scene.viewB.y, scene.viewB.z, scene.viewB.w);
  let resolution = scene.viewA.xy;
  let center = scene.viewA.zw;
  let isoScale = scene.viewB.x;
  let iso = isoProject(lifted) * isoScale + center;
  let ndcX = (iso.x / resolution.x) * 2.0 - 1.0;
  let ndcY = 1.0 - (iso.y / resolution.y) * 2.0;
  out.position = vec4f(ndcX, ndcY, -0.1, 1.0);
  let amp = max(scene.viewB.z, 0.0001);
  out.mixVal = clamp((lifted.y - scene.viewB.y) / (amp * 2.0) + 0.5, 0.0, 1.0);
  let extent = 0.65 * 2.0;
  let uv = (lifted.xz / vec2f(extent, extent)) + vec2f(0.5, 0.5);
  out.strataUV = clamp(uv, vec2f(0.0, 0.0), vec2f(1.0, 1.0));
  return out;
}

@fragment
fn fs_ground(input : GroundVertexOutput) -> @location(0) vec4f {
  let baseColor = vec3f(scene.viewC.x, scene.viewC.y, scene.viewC.z);
  let warmTint = scene.palette0.xyz;
  let coolTint = scene.palette2.xyz;
  var tintMix = smoothstep(0.0, 1.0, input.mixVal);
  let highlight = mix(coolTint, warmTint, tintMix);
  let sheen = scene.viewC.w;
  let grain = sin(input.mixVal * 12.7 + frame.time * 0.35) * 0.05;
  let pigment = textureSampleLevel(strataTexture, strataSampler, input.strataUV, 0.0);
  let thicknessSample = textureSampleLevel(strataThickness, strataSampler, input.strataUV, 0.0);
  let shearSample = textureSampleLevel(strataShear, strataSampler, input.strataUV, 0.0);
  let thickness = clamp(thicknessSample.r * 4.2, 0.0, 1.0);
  let shearVec = shearSample;
  let shearStrength = clamp(length(shearVec) * 8.0, 0.0, 1.0);
  let shearNormal = normalize(vec2f(abs(shearVec.x) + 1e-5, abs(shearVec.y) + 1e-5));
  let shearTint = mix(vec3f(0.18, 0.28, 0.4), vec3f(0.95, 0.46, 0.22), shearNormal.x) * shearStrength;
  let dustColor = scene.palette3.xyz;
  let dust = dustColor * thickness;
  let strataCol = pigment.rgb * 0.55 + dust + shearTint;
  tintMix = clamp(tintMix + thickness * 0.25, 0.0, 1.0);
  let col = mix(baseColor, highlight, tintMix * sheen + 0.2) + grain + strataCol;
  let alpha = clamp(0.65 + pigment.a * 0.25 + thickness * 0.18 + shearStrength * 0.1, 0.0, 1.0);
  let debugMode = u32(scene.viewD.x + 0.5);
  if (debugMode == 1u) {
    return vec4f(pigment.rgb, 1.0);
  }
  if (debugMode == 2u) {
    return vec4f(vec3f(thickness), 1.0);
  }
  if (debugMode == 3u) {
    let encoded = vec3f(shearVec.x * 0.5 + 0.5, shearVec.y * 0.5 + 0.5, shearStrength);
    return vec4f(encoded, 1.0);
  }
  if (debugMode == 4u) {
    let heightTone = clamp(input.mixVal, 0.0, 1.0);
    return vec4f(vec3f(heightTone), 1.0);
  }
  return vec4f(col, alpha);
}
`;
