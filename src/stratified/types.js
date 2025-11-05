/**
 * Shared Stratified data shapes to keep the renderer/simulation toolchain type-safe.
 * These are pure typedef exports so bundlers can tree shake them away.
 */

/** @typedef {ReturnType<typeof import('../core/prng.js').createPRNG>} StratifiedPRNG */

/**
 * @typedef {Object} MaterialPreset
 * @property {string} id
 * @property {string} name
 * @property {number} density
 * @property {number} stretch
 * @property {number} bend
 * @property {number} shear
 * @property {number} damping
 * @property {number} friction
 * @property {number} restitution
 * @property {number} plasticity
 * @property {number} smearCoeff
 */

/**
 * @typedef {{ min?: number, max?: number, range?: [number, number], step?: number, type?: 'int', transform?: (value: number, prng: StratifiedPRNG) => number }} NumericParamDef
 */

/**
 * @typedef {Array<number> | NumericParamDef} ParamDefinition
 */

/**
 * @typedef {Object<string, ParamDefinition>} ArtifactParamMap
 */

/**
 * @typedef {Record<string, ParamDefinition>} ArtifactParamDefs
 */

/**
 * @typedef {Record<string, number>} ArtifactParamValues
 */

/**
 * @typedef {Object} ArtifactClass
 * @property {string} id
 * @property {string} title
 * @property {string} builder
 * @property {string} materialId
 * @property {number} weight
 * @property {ArtifactParamDefs} params
 * @property {Record<string, number>} [constraintProfile]
 */

/**
 * @typedef {Object} ArtifactDescriptor
 * @property {string} id
 * @property {string} classId
 * @property {string} builder
 * @property {MaterialPreset} material
 * @property {ArtifactParamValues} params
 * @property {Record<string, number>} [constraintProfile]
 */

/**
 * @typedef {Object} ArtifactSpawnOptions
 * @property {Record<string, number>} [weights]
 * @property {Record<string, number>} [overrides]
 * @property {string} [classId]
 */

/**
 * @typedef {Object} MeshRange
 * @property {number} vertexOffset
 * @property {number} vertexCount
 * @property {number} indexOffset
 * @property {number} indexCount
 */

/**
 * @typedef {{ offset: number, count: number }} ConstraintRangeEntry
 */

/**
 * @typedef {Object} ConstraintRange
 * @property {ConstraintRangeEntry | null | undefined} [edgeRange]
 * @property {ConstraintRangeEntry | null | undefined} [hingeRange]
 */

/**
 * @typedef {Object} MeshPayload
 * @property {Float32Array} [positions]
 * @property {Float32Array} [normals]
 * @property {Float32Array} [uvs]
 * @property {Float32Array} [masses]
 * @property {Uint32Array} [indices]
 * @property {number} [vertexCount]
 * @property {number} [indexCount]
 */

/**
 * @typedef {Object} EdgePayload
 * @property {Uint32Array} [indices]
 * @property {Float32Array} [restLengths]
 * @property {Float32Array} [compliance]
 */

/**
 * @typedef {Object} HingePayload
 * @property {Uint32Array} [indices]
 * @property {Float32Array} [restAngles]
 * @property {Float32Array} [compliance]
 */

/**
 * @typedef {Object} ConstraintPayload
 * @property {EdgePayload} [edges]
 * @property {HingePayload} [hinges]
 */

/**
 * @typedef {Object} ArtifactPayload
 * @property {MeshPayload} mesh
 * @property {ConstraintPayload} [constraints]
 */

/**
 * @typedef {Object} ArtifactRecord
 * @property {ArtifactDescriptor} descriptor
 * @property {{ meshRange: MeshRange, constraintRange: ConstraintRange }} ranges
 * @property {ArtifactPayload} payload
 */

/**
 * @typedef {Object} MeshView
 * @property {Float32Array} [positions]
 * @property {Float32Array} [normals]
 * @property {Float32Array} [uvs]
 * @property {Float32Array} [masses]
 * @property {Uint32Array} [indices]
 */

/**
 * @typedef {Object} ConstraintView
 * @property {Uint32Array} [edges]
 * @property {Float32Array} [edgeRestLengths]
 * @property {Float32Array} [edgeCompliance]
 * @property {Uint32Array} [hinges]
 * @property {Float32Array} [hingeRestAngles]
 * @property {Float32Array} [hingeCompliance]
 */

/**
 * @typedef {Object} SimulationPoolConfig
 * @property {number} maxVertices
 * @property {number} maxIndices
 * @property {number} maxEdges
 * @property {number} maxHinges
 * @property {number} maxArtifacts
 */

/**
 * @typedef {Object} GeometryBuffers
 * @property {GPUBuffer | null} vertex
 * @property {GPUBuffer | null} index
 * @property {number} count
 * @property {number} vertexCount
 */

/**
 * @typedef {Object} BufferStats
 * @property {number} vertices
 * @property {number} indices
 * @property {number} edges
 * @property {number} hinges
 */

/**
 * @typedef {Object} ContactBuffers
 * @property {GPUBuffer} state
 * @property {GPUBuffer} data
 * @property {GPUBuffer} artifacts
 * @property {number} capacity
 * @property {number} stride
 * @property {number} artifactCount
 */

/**
 * @typedef {{ gpu: number, cpu: number }} PassTiming
 */

/**
 * @typedef {Object} SimulationTimings
 * @property {'gpu' | 'cpu'} mode
 * @property {Record<string, PassTiming>} passes
 */

export {};
