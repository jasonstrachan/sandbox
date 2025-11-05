const EBML_IDS = {
  EBML: [0x1a, 0x45, 0xdf, 0xa3],
  EBMLVersion: [0x42, 0x86],
  EBMLReadVersion: [0x42, 0xf7],
  EBMLMaxIDLength: [0x42, 0xf2],
  EBMLMaxSizeLength: [0x42, 0xf3],
  DocType: [0x42, 0x82],
  DocTypeVersion: [0x42, 0x87],
  DocTypeReadVersion: [0x42, 0x85],
  Segment: [0x18, 0x53, 0x80, 0x67],
  Info: [0x15, 0x49, 0xa9, 0x66],
  TimecodeScale: [0x2a, 0xd7, 0xb1],
  MuxingApp: [0x4d, 0x80],
  WritingApp: [0x57, 0x41],
  Tracks: [0x16, 0x54, 0xae, 0x6b],
  TrackEntry: [0xae],
  TrackNumber: [0xd7],
  TrackUID: [0x73, 0xc5],
  TrackType: [0x83],
  FlagDefault: [0x88],
  FlagLacing: [0x9c],
  CodecID: [0x86],
  Video: [0xe0],
  PixelWidth: [0xb0],
  PixelHeight: [0xba],
  DefaultDuration: [0x23, 0xe3, 0x83],
  Cluster: [0x1f, 0x43, 0xb6, 0x75],
  Timecode: [0xe7],
  SimpleBlock: [0xa3],
};

/** @typedef {{ timestampUs: number, data: Uint8Array, keyframe: boolean, timecode: number }} SimpleBlockRecord */
/** @typedef {{ baseTimestampUs: number, blocks: SimpleBlockRecord[] }} Cluster */

const TEXT_ENCODER = new TextEncoder();
const TIME_SCALE_NS = 1_000_000; // 1 ms units
const MAX_BLOCK_TIMECODE = 0x7fff;

/**
 * @param {{ width?: number, height?: number, fps?: number }} [options]
 */
export function createWebMEncoder({ width, height, fps = 30 } = {}) {
  if (!width || !height) {
    throw new Error('WebM encoder requires non-zero width/height');
  }
  return new SimpleWebMEncoder({ width, height, fps });
}

class SimpleWebMEncoder {
  constructor({ width, height, fps }) {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.trackNumber = 1;
    this.trackUID = Math.floor(Math.random() * 1e9);
    /** @type {Cluster[]} */
    this.clusters = [];
    /** @type {Cluster | null} */
    this.currentCluster = null;
    this.clusterWindowUs = 30_000_000; // 30 seconds
  }

  /**
   * @param {{ data: Uint8Array, timestamp: number, keyframe?: boolean }} chunk
   */
  addChunk({ data, timestamp, keyframe = true }) {
    if (!data || !data.length) return;
    const ts = Math.max(0, Math.floor(timestamp ?? 0));
    if (!this.currentCluster || ts - this.currentCluster.baseTimestampUs > this.clusterWindowUs) {
      this.currentCluster = {
        baseTimestampUs: ts,
        blocks: [],
      };
      this.clusters.push(this.currentCluster);
    }
    const blockTimecode = this.#computeBlockTimecode(this.currentCluster, ts);
    if (blockTimecode > MAX_BLOCK_TIMECODE) {
      this.currentCluster = {
        baseTimestampUs: ts,
        blocks: [],
      };
      this.clusters.push(this.currentCluster);
    }
    /** @type {SimpleBlockRecord} */
    const block = {
      timestampUs: ts,
      data,
      keyframe,
      timecode: this.#computeBlockTimecode(this.currentCluster, ts),
    };
    this.currentCluster.blocks.push(block);
  }

  #computeBlockTimecode(cluster, timestampUs) {
    const clusterTimecode = Math.floor(cluster.baseTimestampUs / 1000); // ms units
    const frameTimecode = Math.floor(timestampUs / 1000);
    return frameTimecode - clusterTimecode;
  }

  finalize() {
    if (!this.clusters.length) {
      throw new Error('No frames recorded');
    }
    const header = makeElement(EBML_IDS.EBML, concatBuffers([
      makeElement(EBML_IDS.EBMLVersion, encodeUint(1, 1)),
      makeElement(EBML_IDS.EBMLReadVersion, encodeUint(1, 1)),
      makeElement(EBML_IDS.EBMLMaxIDLength, encodeUint(4, 1)),
      makeElement(EBML_IDS.EBMLMaxSizeLength, encodeUint(8, 1)),
      makeElement(EBML_IDS.DocType, encodeString('webm')),
      makeElement(EBML_IDS.DocTypeVersion, encodeUint(4, 1)),
      makeElement(EBML_IDS.DocTypeReadVersion, encodeUint(2, 1)),
    ]));

    const info = makeElement(
      EBML_IDS.Info,
      concatBuffers([
        makeElement(EBML_IDS.TimecodeScale, encodeUint(TIME_SCALE_NS, 4)),
        makeElement(EBML_IDS.MuxingApp, encodeString('sandbox-stratified')),
        makeElement(EBML_IDS.WritingApp, encodeString('sandbox-stratified')),
      ])
    );

    const video = makeElement(
      EBML_IDS.Video,
      concatBuffers([
        makeElement(EBML_IDS.PixelWidth, encodeUint(this.width, 2)),
        makeElement(EBML_IDS.PixelHeight, encodeUint(this.height, 2)),
        makeElement(EBML_IDS.DefaultDuration, encodeUint(Math.round(1_000_000_000 / this.fps), 4)),
      ])
    );

    const trackEntry = makeElement(
      EBML_IDS.TrackEntry,
      concatBuffers([
        makeElement(EBML_IDS.TrackNumber, encodeUint(this.trackNumber, 1)),
        makeElement(EBML_IDS.TrackUID, encodeUint(this.trackUID, 4)),
        makeElement(EBML_IDS.TrackType, encodeUint(1, 1)),
        makeElement(EBML_IDS.FlagDefault, encodeUint(1, 1)),
        makeElement(EBML_IDS.FlagLacing, encodeUint(0, 1)),
        makeElement(EBML_IDS.CodecID, encodeString('V_VP9')),
        video,
      ])
    );

    const tracks = makeElement(EBML_IDS.Tracks, trackEntry);
    const segmentHeader = concatUint8Arrays([new Uint8Array(EBML_IDS.Segment), new Uint8Array(8).fill(0xff)]);
    const clusterPayloads = this.clusters.map((cluster) => this.#encodeCluster(cluster));
    const body = concatBuffers([info, tracks, ...clusterPayloads]);
    return new Blob([header, segmentHeader, body], { type: 'video/webm' });
  }

  #encodeCluster(cluster) {
    const timecode = Math.floor(cluster.baseTimestampUs / 1000); // ms units
    const timecodeElement = makeElement(EBML_IDS.Timecode, encodeUint(timecode, 2));
    const blocks = cluster.blocks.map((block) => encodeSimpleBlock({
      trackNumber: this.trackNumber,
      timecode: block.timecode,
      keyframe: block.keyframe,
      data: block.data,
    }));
    return makeElement(EBML_IDS.Cluster, concatBuffers([timecodeElement, ...blocks]));
  }
}

function encodeSimpleBlock({ trackNumber, timecode, keyframe, data }) {
  const payload = new Uint8Array(4 + data.length);
  payload[0] = 0x80 | (trackNumber & 0x7f);
  const clampedTimecode = Math.max(-0x8000, Math.min(0x7fff, timecode));
  payload[1] = (clampedTimecode >> 8) & 0xff;
  payload[2] = clampedTimecode & 0xff;
  payload[3] = keyframe ? 0x80 : 0x00;
  payload.set(data, 4);
  return makeElement(EBML_IDS.SimpleBlock, payload);
}

function encodeUint(value, size) {
  const buffer = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i -= 1) {
    buffer[i] = value & 0xff;
    value >>>= 8;
  }
  return buffer;
}

function encodeString(value) {
  return TEXT_ENCODER.encode(value);
}

function makeElement(id, payload) {
  const idBytes = new Uint8Array(id);
  const sizeBytes = encodeVint(payload.length);
  return concatUint8Arrays([idBytes, sizeBytes, payload]);
}

function encodeVint(value) {
  let length = 1;
  while (value >= (1 << (7 * length)) && length < 8) {
    length += 1;
  }
  const maxValue = (1 << (7 * length)) - 1;
  if (value > maxValue) {
    throw new Error('Value too large for EBML vint');
  }
  const buffer = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    buffer[i] = value & 0xff;
    value >>>= 8;
  }
  buffer[0] |= 1 << (8 - length);
  return buffer;
}

function concatBuffers(buffers) {
  const filtered = buffers.filter(Boolean);
  const total = filtered.reduce((sum, buf) => sum + buf.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  filtered.forEach((buf) => {
    result.set(buf, offset);
    offset += buf.length;
  });
  return result;
}

function concatUint8Arrays(arrays) {
  return concatBuffers(arrays);
}
