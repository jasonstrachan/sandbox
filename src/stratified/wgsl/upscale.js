export const UPSCALE_SHADER = /* wgsl */ `
@group(0) @binding(0) var pixelSampler : sampler;
@group(0) @binding(1) var pixelTexture : texture_2d<f32>;

struct UpscaleVertex {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn vs_upscale(@builtin(vertex_index) vertexIndex : u32) -> UpscaleVertex {
  var out : UpscaleVertex;
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  out.position = vec4f(x - 1.0, 1.0 - y, 0.0, 1.0);
  out.uv = vec2f(x * 0.5, y * 0.5);
  return out;
}

@fragment
fn fs_upscale(input : UpscaleVertex) -> @location(0) vec4f {
  let sampleUV = clamp(input.uv, vec2f(0.0), vec2f(1.0));
  return textureSample(pixelTexture, pixelSampler, sampleUV);
}
`;
