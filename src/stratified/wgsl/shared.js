export const FRAME_UNIFORMS = /* wgsl */ `
struct FrameUniforms {
  time : f32,
  deltaTime : f32,
  frameIndex : u32,
  pad0 : u32,
  gravity : vec3f,
  pad1 : f32,
};
`;

export const SCENE_UNIFORMS = /* wgsl */ `
struct SceneUniforms {
  viewA : vec4f,
  viewB : vec4f,
  viewC : vec4f,
  viewD : vec4f,
  palette0 : vec4f,
  palette1 : vec4f,
  palette2 : vec4f,
  palette3 : vec4f,
};
`;

export const SCENE_BINDINGS = /* wgsl */ `
@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> scene : SceneUniforms;
`;

export const STRATA_SAMPLER_BINDINGS = /* wgsl */ `
@group(0) @binding(2) var strataSampler : sampler;
@group(0) @binding(3) var strataTexture : texture_2d<f32>;
@group(0) @binding(4) var strataThickness : texture_2d<f32>;
@group(0) @binding(5) var strataShear : texture_2d<f32>;
`;

export function sceneShaderHeader({ includeStrata = false } = {}) {
  return `${FRAME_UNIFORMS}\n${SCENE_UNIFORMS}\n${SCENE_BINDINGS}${includeStrata ? STRATA_SAMPLER_BINDINGS : ''}`;
}

export function rendererBindGroupEntries(stage = GPUShaderStage) {
  return [
    { binding: 0, visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 2, visibility: stage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 3, visibility: stage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 4, visibility: stage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 5, visibility: stage.FRAGMENT, texture: { sampleType: 'float' } },
  ];
}
