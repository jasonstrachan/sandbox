const EDGE_STRIDE = 3; // i, j, type
const HINGE_STRIDE = 4; // i, j, k, l

export function createArtifactStagingBuffers({
  maxVertices = 200_000,
  maxIndices = 400_000,
  maxEdges = 400_000,
  maxHinges = 200_000,
} = {}) {
  const mesh = createMeshPool(maxVertices, maxIndices);
  const constraints = createConstraintPool(maxEdges, maxHinges);

  return {
    mesh,
    constraints,
    writeArtifact(artifact) {
      const meshRange = mesh.writeMesh(artifact.mesh);
      const constraintRange = constraints.writeConstraints(artifact.constraints || {});
      return {
        meshRange,
        constraintRange,
        artifact,
      };
    },
    reset() {
      mesh.reset();
      constraints.reset();
    },
    stats() {
      return {
        vertices: mesh.state.vertexCount,
        indices: mesh.state.indexCount,
        edges: constraints.state.edgeCount,
        hinges: constraints.state.hingeCount,
      };
    },
  };
}

function createMeshPool(maxVertices, maxIndices) {
  const positions = new Float32Array(maxVertices * 3);
  const normals = new Float32Array(maxVertices * 3);
  const uvs = new Float32Array(maxVertices * 2);
  const masses = new Float32Array(maxVertices);
  const indices = new Uint32Array(maxIndices);

  const state = {
    vertexCount: 0,
    indexCount: 0,
  };

  return {
    state,
    writeMesh(mesh) {
      if (!mesh) throw new Error('Mesh payload required');
      const { vertexCount = 0, indexCount = 0 } = mesh;
      const vertexOffset = state.vertexCount;
      const indexOffset = state.indexCount;
      ensureCapacity(vertexOffset + vertexCount <= maxVertices, 'vertices');
      ensureCapacity(indexOffset + indexCount <= maxIndices, 'indices');

      if (mesh.positions) positions.set(mesh.positions, vertexOffset * 3);
      if (mesh.normals) normals.set(mesh.normals, vertexOffset * 3);
      if (mesh.uvs) uvs.set(mesh.uvs, vertexOffset * 2);
      if (mesh.masses) masses.set(mesh.masses, vertexOffset);
      if (mesh.indices) {
        indices.set(mesh.indices, indexOffset);
      }

      state.vertexCount += vertexCount;
      state.indexCount += indexCount;
      return { vertexOffset, indexOffset, vertexCount, indexCount };
    },
    reset() {
      state.vertexCount = 0;
      state.indexCount = 0;
    },
    getViews() {
      return {
        positions: positions.subarray(0, state.vertexCount * 3),
        normals: normals.subarray(0, state.vertexCount * 3),
        uvs: uvs.subarray(0, state.vertexCount * 2),
        masses: masses.subarray(0, state.vertexCount),
        indices: indices.subarray(0, state.indexCount),
      };
    },
  };

  function ensureCapacity(condition, label) {
    if (!condition) {
      throw new Error(`Mesh pool exhausted for ${label}`);
    }
  }
}

function createConstraintPool(maxEdges, maxHinges) {
  const edgeTriples = new Uint32Array(maxEdges * EDGE_STRIDE);
  const edgeRestLengths = new Float32Array(maxEdges);
  const edgeCompliance = new Float32Array(maxEdges);
  const hingeQuads = new Uint32Array(maxHinges * HINGE_STRIDE);
  const hingeRestAngles = new Float32Array(maxHinges);
  const hingeCompliance = new Float32Array(maxHinges);

  const state = {
    edgeCount: 0,
    hingeCount: 0,
  };

  return {
    state,
    writeConstraints({ edges, hinges }) {
      let edgeRange = null;
      let hingeRange = null;

      if (edges?.indices && edges?.restLengths) {
        const count = Math.floor(edges.indices.length / EDGE_STRIDE);
        const offset = state.edgeCount;
        ensureCapacity(offset + count <= maxEdges, 'edges');
        edgeTriples.set(edges.indices, offset * EDGE_STRIDE);
        edgeRestLengths.set(edges.restLengths, offset);
        if (edges?.compliance) {
          edgeCompliance.set(edges.compliance, offset);
        } else {
          fillCompliance(edgeCompliance, offset, count, 0.1);
        }
        state.edgeCount += count;
        edgeRange = { offset, count };
      }

      if (hinges?.indices && hinges?.restAngles) {
        const count = Math.floor(hinges.indices.length / HINGE_STRIDE);
        const offset = state.hingeCount;
        ensureCapacity(offset + count <= maxHinges, 'hinges');
        hingeQuads.set(hinges.indices, offset * HINGE_STRIDE);
        hingeRestAngles.set(hinges.restAngles, offset);
        if (hinges?.compliance) {
          hingeCompliance.set(hinges.compliance, offset);
        } else {
          fillCompliance(hingeCompliance, offset, count, 0.05);
        }
        state.hingeCount += count;
        hingeRange = { offset, count };
      }

      return { edgeRange, hingeRange };
    },
    reset() {
      state.edgeCount = 0;
      state.hingeCount = 0;
    },
    getViews() {
      return {
        edges: edgeTriples.subarray(0, state.edgeCount * EDGE_STRIDE),
        edgeRestLengths: edgeRestLengths.subarray(0, state.edgeCount),
        edgeCompliance: edgeCompliance.subarray(0, state.edgeCount),
        hinges: hingeQuads.subarray(0, state.hingeCount * HINGE_STRIDE),
        hingeRestAngles: hingeRestAngles.subarray(0, state.hingeCount),
        hingeCompliance: hingeCompliance.subarray(0, state.hingeCount),
      };
    },
  };

  function ensureCapacity(condition, label) {
    if (!condition) {
      throw new Error(`Constraint pool exhausted for ${label}`);
    }
  }

  function fillCompliance(target, offset, count, value) {
    for (let i = 0; i < count; i += 1) {
      target[offset + i] = value;
    }
  }
}

export { EDGE_STRIDE, HINGE_STRIDE };
