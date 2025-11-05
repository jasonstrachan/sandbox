export const MAX_DITHER_WIDTH = 2048;

export const DITHER_SHADER = /* wgsl */ `
const MAX_PIXEL_WIDTH : u32 = ${2048}u;

struct DitherParams {
  resolution : vec2u,
  quantLevels : f32,
  strength : f32,
  serpentine : u32,
};

@group(0) @binding(0) var pixelSource : texture_2d<f32>;
@group(0) @binding(1) var ditherTarget : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read_write> errorBuffer : array<vec4f>;
@group(0) @binding(3) var<uniform> params : DitherParams;

fn clampColor(value : vec3f) -> vec3f {
  return clamp(value, vec3f(0.0), vec3f(1.0));
}

fn quantize(value : vec3f, levels : f32) -> vec3f {
  let steps = max(levels, 2.0);
  let factor = steps - 1.0;
  return round(value * factor) / factor;
}

fn bufferIndex(row : u32, idx : u32) -> u32 {
  return row * MAX_PIXEL_WIDTH + min(idx, MAX_PIXEL_WIDTH - 1u);
}

@compute @workgroup_size(1)
fn cs_dither(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x > 0u || gid.y > 0u || gid.z > 0u) {
    return;
  }
  let width = min(params.resolution.x, MAX_PIXEL_WIDTH);
  let height = params.resolution.y;
  if (width == 0u || height == 0u) {
    return;
  }
  // zero both error rows (current + next)
  for (var i : u32 = 0u; i < MAX_PIXEL_WIDTH * 2u; i = i + 1u) {
    errorBuffer[i] = vec4f(0.0);
  }

  for (var y : u32 = 0u; y < height; y = y + 1u) {
    let serp = params.serpentine != 0u && (y & 1u) == 1u;
    for (var x : u32 = 0u; x < width; x = x + 1u) {
      let ix = select(x, (width - 1u) - x, serp);
      let coord = vec2i(i32(ix), i32(y));
      let sample = textureLoad(pixelSource, coord, 0);
      let errIdx = bufferIndex(0u, ix);
      let adjusted = clampColor(sample.rgb + errorBuffer[errIdx].xyz);

      let quant = quantize(adjusted, params.quantLevels);
      let strength = clamp(params.strength, 0.0, 1.0);
      let mixed = mix(adjusted, quant, strength);
      textureStore(ditherTarget, coord, vec4f(mixed, sample.a));

      let diff = adjusted - mixed;
      let rightWeight = 0.5;
      let downWeight = 0.25;
      let diagWeight = 0.25;

      if (!serp) {
        if (ix + 1u < width) {
          let rightIdx = bufferIndex(0u, ix + 1u);
          errorBuffer[rightIdx] = vec4f(errorBuffer[rightIdx].xyz + diff * rightWeight, 0.0);
        }
        if (ix > 0u) {
          let downLeftIdx = bufferIndex(1u, ix - 1u);
          errorBuffer[downLeftIdx] = vec4f(errorBuffer[downLeftIdx].xyz + diff * diagWeight, 0.0);
        }
        let downIdx = bufferIndex(1u, ix);
        errorBuffer[downIdx] = vec4f(errorBuffer[downIdx].xyz + diff * downWeight, 0.0);
      } else {
        if (ix > 0u) {
          let leftIdx = bufferIndex(0u, ix - 1u);
          errorBuffer[leftIdx] = vec4f(errorBuffer[leftIdx].xyz + diff * rightWeight, 0.0);
        }
        let downIdx = bufferIndex(1u, ix);
        errorBuffer[downIdx] = vec4f(errorBuffer[downIdx].xyz + diff * downWeight, 0.0);
        if (ix + 1u < width) {
          let downRightIdx = bufferIndex(1u, ix + 1u);
          errorBuffer[downRightIdx] = vec4f(errorBuffer[downRightIdx].xyz + diff * diagWeight, 0.0);
        }
      }
    }

    // advance error rows: move next-row weights into current row and clear next row
    for (var c : u32 = 0u; c < width; c = c + 1u) {
      let nextVal = errorBuffer[bufferIndex(1u, c)];
      errorBuffer[bufferIndex(0u, c)] = vec4f(nextVal.xyz, 0.0);
      errorBuffer[bufferIndex(1u, c)] = vec4f(0.0);
    }
  }
}
`;
