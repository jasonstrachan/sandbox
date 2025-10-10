export function createState() {
  return { pts: [], closed: false };
}

export function setShape(state, points) {
  state.pts = points.map(({ x, y }) => ({ x, y }));
  state.closed = state.pts.length >= 3;
}

export function addPoint(state, point) {
  state.pts.push({ x: point.x, y: point.y });
}

export function updatePoint(state, index, point) {
  if (index < 0 || index >= state.pts.length) return;
  state.pts[index] = { x: point.x, y: point.y };
}

export function undoPoint(state) {
  if (!state.pts.length) return;
  state.pts.pop();
  if (state.pts.length < 3) {
    state.closed = false;
  }
}

export function clearState(state) {
  state.pts = [];
  state.closed = false;
}

export function closePolygon(state) {
  if (state.pts.length >= 3) {
    state.closed = true;
  }
}

export function isClosed(state) {
  return state.closed && state.pts.length >= 3;
}

export function pointCount(state) {
  return state.pts.length;
}
