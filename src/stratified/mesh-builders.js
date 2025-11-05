import { EDGE_CONSTRAINT_TYPE } from './definitions.js';

export const MeshBuilders = {
  box: buildBoxMesh,
  wrapper: buildWrapperMesh,
  coin: buildCoinMesh,
};

export function buildBoxMesh(params, { material }) {
  const width = params.width ?? 0.12;
  const depth = params.depth ?? 0.08;
  const height = params.height ?? 0.18;

  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;

  const positions = new Float32Array([
    -hx, -hy, -hz,
    hx, -hy, -hz,
    hx, hy, -hz,
    -hx, hy, -hz,
    -hx, -hy, hz,
    hx, -hy, hz,
    hx, hy, hz,
    -hx, hy, hz,
  ]);

  const indices = new Uint32Array([
    4, 5, 6, 4, 6, 7, // front
    1, 0, 3, 1, 3, 2, // back
    0, 4, 7, 0, 7, 3, // left
    5, 1, 2, 5, 2, 6, // right
    3, 7, 6, 3, 6, 2, // top
    0, 1, 5, 0, 5, 4, // bottom
  ]);

  const normals = computeVertexNormals(positions, indices);
  const uvs = new Float32Array(positions.length / 3 * 2);
  for (let i = 0; i < uvs.length; i += 2) {
    const vi = i / 2;
    const x = positions[vi * 3];
    const y = positions[vi * 3 + 1];
    uvs[i] = (x + hx) / width;
    uvs[i + 1] = (y + hy) / height;
  }

  const vertexCount = positions.length / 3;
  const volume = width * height * depth;
  const density = material?.density ?? 1;
  const totalMass = volume * density;
  const masses = new Float32Array(vertexCount).fill(totalMass / vertexCount);

  const baseEdges = [
    0, 1, EDGE_CONSTRAINT_TYPE.STRUCT,
    1, 2, EDGE_CONSTRAINT_TYPE.STRUCT,
    2, 3, EDGE_CONSTRAINT_TYPE.STRUCT,
    3, 0, EDGE_CONSTRAINT_TYPE.STRUCT,
    4, 5, EDGE_CONSTRAINT_TYPE.STRUCT,
    5, 6, EDGE_CONSTRAINT_TYPE.STRUCT,
    6, 7, EDGE_CONSTRAINT_TYPE.STRUCT,
    7, 4, EDGE_CONSTRAINT_TYPE.STRUCT,
    0, 4, EDGE_CONSTRAINT_TYPE.STRUCT,
    1, 5, EDGE_CONSTRAINT_TYPE.STRUCT,
    2, 6, EDGE_CONSTRAINT_TYPE.STRUCT,
    3, 7, EDGE_CONSTRAINT_TYPE.STRUCT,
  ];
  const edges = buildEdgeTriples(baseEdges, material);
  const hinges = computeHinges(positions, indices, material);

  return {
    mesh: {
      vertexCount,
      indexCount: indices.length,
      positions,
      normals,
      uvs,
      masses,
      indices,
    },
    constraints: {
      edges: {
        indices: edges.indices,
        restLengths: computeRestLengths(edges.indices, positions),
        compliance: edges.compliance,
      },
      hinges,
    },
  };
}

export function buildWrapperMesh(params, { material, prng }) {
  const width = params.width ?? 0.18;
  const height = params.height ?? 0.26;
  const segmentsX = Math.max(2, params.segmentsX ?? 14);
  const segmentsY = Math.max(2, params.segmentsY ?? 18);
  const crinkle = params.crinkle ?? 0.3;
  const slack = params.slack ?? 0.06;
  const restWidth = width + slack;
  const restHeight = height + slack;

  const cols = segmentsX + 1;
  const rows = segmentsY + 1;
  const vertexCount = cols * rows;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let y = 0; y < rows; y += 1) {
    const v = y / segmentsY;
    for (let x = 0; x < cols; x += 1) {
      const u = x / segmentsX;
      const idx = y * cols + x;
      const px = (u - 0.5) * width;
      const py = (v - 0.5) * height;
      const noise = (hash2(u, v, prng) - 0.5) * crinkle * 0.04;
      positions[idx * 3] = px;
      positions[idx * 3 + 1] = py;
      positions[idx * 3 + 2] = noise;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  const indices = buildGridIndices(segmentsX, segmentsY);
  const normals = computeVertexNormals(positions, indices);

  const area = width * height;
  const density = material?.density ?? 0.4;
  const sheetThickness = 0.0003;
  const totalMass = area * sheetThickness * density;
  const masses = new Float32Array(vertexCount).fill(totalMass / vertexCount);

  const edgeTriples = [];
  const restLengths = [];
  const edgeCompliance = [];
  const xSpacing = restWidth / segmentsX;
  const ySpacing = restHeight / segmentsY;
  const diag = Math.hypot(xSpacing, ySpacing);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (x < segmentsX) {
        pushEdge(edgeTriples, restLengths, edgeCompliance, idx, idx + 1, EDGE_CONSTRAINT_TYPE.STRUCT, xSpacing, material);
      }
      if (y < segmentsY) {
        pushEdge(edgeTriples, restLengths, edgeCompliance, idx, idx + cols, EDGE_CONSTRAINT_TYPE.STRUCT, ySpacing, material);
      }
      if (x < segmentsX && y < segmentsY) {
        const diagA = idx + cols + 1;
        const diagB = idx + cols;
        pushEdge(edgeTriples, restLengths, edgeCompliance, idx, diagA, EDGE_CONSTRAINT_TYPE.SHEAR, diag, material);
        pushEdge(edgeTriples, restLengths, edgeCompliance, idx + 1, diagB, EDGE_CONSTRAINT_TYPE.SHEAR, diag, material);
      }
      if (x < segmentsX - 1) {
        pushEdge(edgeTriples, restLengths, edgeCompliance, idx, idx + 2, EDGE_CONSTRAINT_TYPE.BEND, xSpacing * 2, material);
      }
      if (y < segmentsY - 1) {
        pushEdge(edgeTriples, restLengths, edgeCompliance, idx, idx + cols * 2, EDGE_CONSTRAINT_TYPE.BEND, ySpacing * 2, material);
      }
    }
  }

  const edges = buildEdgeTriples(edgeTriples, material, edgeCompliance);
  const hinges = computeHinges(positions, indices, material);

  return {
    mesh: {
      vertexCount,
      indexCount: indices.length,
      positions,
      normals,
      uvs,
      masses,
      indices,
    },
    constraints: {
      edges: {
        indices: edges.indices,
        restLengths: Float32Array.from(restLengths),
        compliance: edges.compliance,
      },
      hinges,
    },
  };
}

export function buildCoinMesh(params, { material }) {
  const radius = params.radius ?? 0.028;
  const thickness = params.thickness ?? 0.0025;
  const segments = Math.max(12, params.segments ?? 28);
  const lipHeight = params.lipHeight ?? 0.001;

  const vertexCount = 2 + segments * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let offset = 0;
  // top center
  positions[offset * 3 + 1] = thickness / 2 + lipHeight;
  uvs[offset * 2] = 0.5;
  uvs[offset * 2 + 1] = 0.5;
  offset += 1;
  // bottom center
  positions[offset * 3 + 1] = -thickness / 2 - lipHeight;
  uvs[offset * 2] = 0.5;
  uvs[offset * 2 + 1] = 0.5;
  offset += 1;

  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions[offset * 3] = x;
    positions[offset * 3 + 1] = thickness / 2;
    positions[offset * 3 + 2] = z;
    uvs[offset * 2] = (x / (radius * 2)) + 0.5;
    uvs[offset * 2 + 1] = (z / (radius * 2)) + 0.5;
    offset += 1;
    positions[offset * 3] = x;
    positions[offset * 3 + 1] = -thickness / 2;
    positions[offset * 3 + 2] = z;
    uvs[offset * 2] = (x / (radius * 2)) + 0.5;
    uvs[offset * 2 + 1] = (z / (radius * 2)) + 0.5;
    offset += 1;
  }

  const indices = buildCoinIndices(segments);
  const normals = computeVertexNormals(positions, indices);

  const volume = Math.PI * radius * radius * thickness;
  const density = material?.density ?? 2.2;
  const totalMass = volume * density;
  const masses = new Float32Array(vertexCount).fill(totalMass / vertexCount);

  const rimEdges = [];
  const rest = [];
  const compliance = [];
  for (let i = 0; i < segments; i += 1) {
    const topIdx = 2 + i * 2;
    const nextTop = 2 + ((i + 1) % segments) * 2;
    const bottomIdx = topIdx + 1;
    const nextBottom = nextTop + 1;
    compliance.push(edgeComplianceForType(EDGE_CONSTRAINT_TYPE.STRUCT, material));
    rimEdges.push(topIdx, nextTop, EDGE_CONSTRAINT_TYPE.STRUCT);
    rest.push(2 * radius * Math.sin(Math.PI / segments));
    compliance.push(edgeComplianceForType(EDGE_CONSTRAINT_TYPE.STRUCT, material));
    rimEdges.push(bottomIdx, nextBottom, EDGE_CONSTRAINT_TYPE.STRUCT);
    rest.push(2 * radius * Math.sin(Math.PI / segments));
    compliance.push(edgeComplianceForType(EDGE_CONSTRAINT_TYPE.STRUCT, material));
    rimEdges.push(topIdx, bottomIdx, EDGE_CONSTRAINT_TYPE.STRUCT);
    rest.push(thickness);
  }

  const edges = buildEdgeTriples(rimEdges, material, compliance);
  const hinges = computeHinges(positions, indices, material);

  return {
    mesh: {
      vertexCount,
      indexCount: indices.length,
      positions,
      normals,
      uvs,
      masses,
      indices,
    },
    constraints: {
      edges: {
        indices: edges.indices,
        restLengths: Float32Array.from(rest),
        compliance: Float32Array.from(compliance),
      },
      hinges,
    },
  };
}

function computeVertexNormals(positions, indices) {
  const vertexCount = positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  const p0 = [0, 0, 0];
  const p1 = [0, 0, 0];
  const p2 = [0, 0, 0];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    readVec(positions, a, p0);
    readVec(positions, b, p1);
    readVec(positions, c, p2);
    const n = faceNormal(p0, p1, p2);
    addVec(normals, a, n);
    addVec(normals, b, n);
    addVec(normals, c, n);
  }
  normalizeArray(normals);
  return normals;
}

function computeHinges(positions, indices, material) {
  const edgeMap = new Map();
  const hingeIdx = [];
  const restAngles = [];
  const compliance = [];
  const hingeValue = hingeComplianceFromMaterial(material);
  for (let tri = 0; tri < indices.length; tri += 3) {
    const triIndices = [indices[tri], indices[tri + 1], indices[tri + 2]];
    for (let i = 0; i < 3; i += 1) {
      const a = triIndices[i];
      const b = triIndices[(i + 1) % 3];
      const opposite = triIndices[(i + 2) % 3];
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { i: a, j: b, opposite });
      } else {
        const prev = edgeMap.get(key);
        const angle = dihedralAngle(prev.i, prev.j, prev.opposite, opposite, positions);
        hingeIdx.push(prev.i, prev.j, prev.opposite, opposite);
        restAngles.push(angle);
        compliance.push(hingeValue);
        edgeMap.delete(key);
      }
    }
  }
  return {
    indices: Uint32Array.from(hingeIdx),
    restAngles: Float32Array.from(restAngles),
    compliance: Float32Array.from(compliance),
  };
}

function buildEdgeTriples(list, material, customCompliance) {
  const count = Math.floor(list.length / 3);
  const data = new Uint32Array(count * 3);
  const compliance = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const a = list[i * 3];
    const b = list[i * 3 + 1];
    const type = list[i * 3 + 2] ?? EDGE_CONSTRAINT_TYPE.STRUCT;
    data[i * 3] = a;
    data[i * 3 + 1] = b;
    data[i * 3 + 2] = type;
    compliance[i] = customCompliance ? customCompliance[i] ?? edgeComplianceForType(type, material) : edgeComplianceForType(type, material);
  }
  return { indices: data, compliance };
}

function computeRestLengths(edgeData, positions) {
  const count = edgeData.length / 3;
  const rest = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const a = edgeData[i * 3];
    const b = edgeData[i * 3 + 1];
    rest[i] = distanceBetween(positions, a, b);
  }
  return rest;
}

function buildGridIndices(segX, segY) {
  const cols = segX + 1;
  const tris = segX * segY * 2;
  const indices = new Uint32Array(tris * 3);
  let offset = 0;
  for (let y = 0; y < segY; y += 1) {
    for (let x = 0; x < segX; x += 1) {
      const i0 = y * cols + x;
      const i1 = i0 + 1;
      const i2 = i0 + cols;
      const i3 = i2 + 1;
      indices[offset++] = i0;
      indices[offset++] = i2;
      indices[offset++] = i3;
      indices[offset++] = i0;
      indices[offset++] = i3;
      indices[offset++] = i1;
    }
  }
  return indices;
}

function buildCoinIndices(segments) {
  const topCenter = 0;
  const bottomCenter = 1;
  const indices = [];
  for (let i = 0; i < segments; i += 1) {
    const top = 2 + i * 2;
    const nextTop = 2 + ((i + 1) % segments) * 2;
    const bottom = top + 1;
    const nextBottom = nextTop + 1;
    indices.push(topCenter, nextTop, top);
    indices.push(bottomCenter, bottom, nextBottom);
    indices.push(top, nextTop, nextBottom);
    indices.push(top, nextBottom, bottom);
  }
  return Uint32Array.from(indices);
}

function pushEdge(container, rest, compliance, a, b, type, length, material) {
  container.push(a, b, type);
  rest.push(length);
  compliance.push(edgeComplianceForType(type, material));
}

function hash2(u, v, prng) {
  const str = `${u.toFixed(3)}:${v.toFixed(3)}:${prng?.seed ?? 'seed'}`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function distanceBetween(positions, a, b) {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const bx = positions[b * 3];
  const by = positions[b * 3 + 1];
  const bz = positions[b * 3 + 2];
  return Math.hypot(ax - bx, ay - by, az - bz);
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function dihedralAngle(i, j, k, l, positions) {
  const vi = readPosition(positions, i);
  const vj = readPosition(positions, j);
  const vk = readPosition(positions, k);
  const vl = readPosition(positions, l);
  const n1 = normalize(cross(subtract(vk, vi), subtract(vk, vj)));
  const n2 = normalize(cross(subtract(vl, vj), subtract(vl, vi)));
  const dotNL = clamp(dot(n1, n2), -1, 1);
  return Math.acos(dotNL);
}

function readPosition(buffer, idx) {
  return [buffer[idx * 3], buffer[idx * 3 + 1], buffer[idx * 3 + 2]];
}

function readVec(buffer, idx, out) {
  out[0] = buffer[idx * 3];
  out[1] = buffer[idx * 3 + 1];
  out[2] = buffer[idx * 3 + 2];
  return out;
}

function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

function addVec(buffer, idx, vec) {
  buffer[idx * 3] += vec[0];
  buffer[idx * 3 + 1] += vec[1];
  buffer[idx * 3 + 2] += vec[2];
}

function normalizeArray(buffer) {
  for (let i = 0; i < buffer.length; i += 3) {
    const len = Math.hypot(buffer[i], buffer[i + 1], buffer[i + 2]) || 1;
    buffer[i] /= len;
    buffer[i + 1] /= len;
    buffer[i + 2] /= len;
  }
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function edgeComplianceForType(type, material) {
  const stretch = material?.stretch ?? 0.6;
  const bend = material?.bend ?? 0.4;
  const shear = material?.shear ?? 0.5;
  switch (type) {
    case EDGE_CONSTRAINT_TYPE.STRUCT:
      return complianceFromStiffness(stretch, 0.4);
    case EDGE_CONSTRAINT_TYPE.SHEAR:
      return complianceFromStiffness(shear, 0.6);
    case EDGE_CONSTRAINT_TYPE.BEND:
      return complianceFromStiffness(bend, 0.8);
    case EDGE_CONSTRAINT_TYPE.CREASE:
      return complianceFromStiffness(bend * 1.2, 0.3);
    default:
      return 0.1;
  }
}

function hingeComplianceFromMaterial(material) {
  const bend = material?.bend ?? 0.4;
  return complianceFromStiffness(bend, 0.5);
}

function complianceFromStiffness(stiffness = 0.5, scale = 1) {
  const s = clamp(stiffness, 0.01, 1);
  const compliance = (1 - s) * scale;
  return Math.max(0.0001, compliance);
}
