const WIDTH = 64;
const HEIGHT = 64;
const VELOCITY_LIMIT = 5;
const VELOCITY_SIDE = 2 * VELOCITY_LIMIT + 1;
const VELOCITIES = VELOCITY_SIDE ** 2;
const PSF_RADIUS = 3;
const PSF_SIGMA = 1.15;


const PSF_AXIS = Array.from({ length: 2 * PSF_RADIUS + 1 }, (_, index) => {
  const offset = index - PSF_RADIUS;
  return Math.exp(-(offset ** 2) / (2 * PSF_SIGMA ** 2));
});
const PSF_AXIS_ENERGY = PSF_AXIS.reduce((sum, value) => sum + value ** 2, 0);


function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = Math.imul(state ^ (state >>> 15), state | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}


export function makeScene({ seed = 27, strength = 1.4, count = 12 } = {}) {
  if (!Number.isInteger(count) || count < 2 || count > 48) {
    throw new RangeError('Frame count must be an integer between 2 and 48.');
  }
  if (!Number.isFinite(strength) || strength < 0) {
    throw new RangeError('Signal strength must be a finite nonnegative number.');
  }
  const random = randomSource(seed);
  const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));
  // Keep the injected signal comfortably inside the image across every frame.
  const speedLimit = Math.min(VELOCITY_LIMIT, Math.floor(47 / (count - 1)));
  const vx = randomInt(-speedLimit, speedLimit);
  const vy = vx ? randomInt(-speedLimit, speedLimit) : randomInt(0, 1) ? 1 : -1;
  const dx = vx * (count - 1);
  const dy = vy * (count - 1);
  const x = randomInt(8 - Math.min(dx, 0), WIDTH - 9 - Math.max(dx, 0));
  const y = randomInt(8 - Math.min(dy, 0), HEIGHT - 9 - Math.max(dy, 0));
  const area = WIDTH * HEIGHT;
  const frames = new Float32Array(area * count);
  for (let index = 0; index < frames.length; index += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - random()));
    const angle = 2 * Math.PI * random();
    frames[index] = radius * Math.cos(angle);
    frames[index + 1] = radius * Math.sin(angle);
  }
  for (let frame = 0; frame < count; frame += 1) {
    const centerX = x + frame * vx;
    const centerY = y + frame * vy;
    const frameOffset = frame * area;
    for (let offsetY = -PSF_RADIUS; offsetY <= PSF_RADIUS; offsetY += 1) {
      for (let offsetX = -PSF_RADIUS; offsetX <= PSF_RADIUS; offsetX += 1) {
        const index = frameOffset + (centerY + offsetY) * WIDTH + centerX + offsetX;
        frames[index] += strength * PSF_AXIS[offsetX + PSF_RADIUS] * PSF_AXIS[offsetY + PSF_RADIUS];
      }
    }
  }
  return { frames, width: WIDTH, height: HEIGHT, count, truth: { x, y, vx, vy }, seed, strength };
}


const filteredCache = new WeakMap();


function matchedFrames(scene) {
  const cached = filteredCache.get(scene);
  if (cached) return cached;
  const { frames, width, height, count } = scene;
  const area = width * height;
  // A separable Gaussian removes the repeated two-dimensional convolution.
  // Dividing the weights by their L2 norm leaves unit variance for white noise.
  const weights = PSF_AXIS.map(weight => weight / Math.sqrt(PSF_AXIS_ENERGY));
  const horizontal = new Float32Array(area);
  const filtered = new Float32Array(frames.length);
  for (let frame = 0; frame < count; frame += 1) {
    const offset = frame * area;
    for (let y = 0; y < height; y += 1) {
      for (let x = PSF_RADIUS; x < width - PSF_RADIUS; x += 1) {
        const index = y * width + x;
        let value = 0;
        for (let k = 0; k < weights.length; k += 1) {
          value += frames[offset + index + k - PSF_RADIUS] * weights[k];
        }
        horizontal[index] = value;
      }
    }
    for (let y = PSF_RADIUS; y < height - PSF_RADIUS; y += 1) {
      for (let x = PSF_RADIUS; x < width - PSF_RADIUS; x += 1) {
        const index = y * width + x;
        let value = 0;
        for (let k = 0; k < weights.length; k += 1) {
          value += horizontal[index + (k - PSF_RADIUS) * width] * weights[k];
        }
        filtered[offset + index] = value;
      }
    }
  }
  filteredCache.set(scene, filtered);
  return filtered;
}


function originBounds(scene, vx, vy) {
  const dx = vx * (scene.count - 1);
  const dy = vy * (scene.count - 1);
  return {
    minX: PSF_RADIUS - Math.min(dx, 0),
    maxX: scene.width - PSF_RADIUS - Math.max(dx, 0),
    minY: PSF_RADIUS - Math.min(dy, 0),
    maxY: scene.height - PSF_RADIUS - Math.max(dy, 0),
  };
}


function sumTrack(filtered, index, step, frameCount) {
  let sum = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    sum += filtered[index];
    index += step;
  }
  return sum;
}


/**
 * Return the frame-0 score image at this velocity. Row-major [y * width + x].
 * Pixels without a fully observed track and filter footprint are NaN.
 */
export function scoreStack(scene, vx, vy) {
  const { width, height, count } = scene;
  const area = width * height;
  const filtered = matchedFrames(scene);
  const scores = new Float32Array(area).fill(NaN);
  const { minX, maxX, minY, maxY } = originBounds(scene, vx, vy);
  const step = area + vx + vy * width;
  const scale = 1 / Math.sqrt(count);
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const index = y * width + x;
      scores[index] = sumTrack(filtered, index, step, count) * scale;
    }
  }
  return scores;
}


export function scoreAt(scene, x, y, vx, vy) {
  const { minX, maxX, minY, maxY } = originBounds(scene, vx, vy);
  if (x < minX || x >= maxX || y < minY || y >= maxY) return NaN;
  const { width, height, count } = scene;
  return sumTrack(matchedFrames(scene), y * width + x, width * height + vx + vy * width, count) / Math.sqrt(count);
}


function velocityFor(index) {
  return {
    vx: index % VELOCITY_SIDE - VELOCITY_LIMIT,
    vy: Math.floor(index / VELOCITY_SIDE) - VELOCITY_LIMIT,
  };
}




export function validTrackCount(scene) {
  let tracks = 0;
  for (let index = 0; index < VELOCITIES; index += 1) {
    const { vx, vy } = velocityFor(index);
    const { minX, maxX, minY, maxY } = originBounds(scene, vx, vy);
    tracks += Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  }
  return tracks;
}


export function scanSerial(filtered, width, height, count) {
  const peaks = [];
  const area = width * height;
  const scale = 1 / Math.sqrt(count);
  for (let velocity = 0; velocity < VELOCITIES; velocity += 1) {
    const { vx, vy } = velocityFor(velocity);
    const { minX, maxX, minY, maxY } = originBounds({ width, height, count }, vx, vy);
    const step = area + vx + vy * width;
    let best = -Infinity;
    let address = -1;
    for (let y = minY; y < maxY; y += 1) {
      for (let x = minX; x < maxX; x += 1) {
        const index = y * width + x;
        const value = sumTrack(filtered, index, step, count) * scale;
        if (value > best) {
          best = value;
          address = index;
        }
      }
    }
    peaks.push({ x: address < 0 ? -1 : address % width, y: Math.floor(address / width), vx, vy, score: best });
  }
  return peaks;
}


const GROUP_SIZE = 128;
const gpuCode = `
struct Dimensions { width: u32, height: u32, count: u32, padding: u32 }
struct Peak { score: f32, address: u32 }
@group(0) @binding(0) var<storage, read> pixels: array<f32>;
@group(0) @binding(1) var<storage, read_write> peaks: array<Peak>;
@group(0) @binding(2) var<uniform> size: Dimensions;


var<workgroup> values: array<f32, ${GROUP_SIZE}>;
var<workgroup> addresses: array<u32, ${GROUP_SIZE}>;


@compute @workgroup_size(${GROUP_SIZE})
fn search(
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(local_invocation_id) lane: vec3<u32>,
  @builtin(num_workgroups) grid: vec3<u32>
) {
  let width = i32(size.width);
  let height = i32(size.height);
  let area = size.width * size.height;
  let vx = i32(group.y % ${VELOCITY_SIDE}u) - ${VELOCITY_LIMIT};
  let vy = i32(group.y / ${VELOCITY_SIDE}u) - ${VELOCITY_LIMIT};
  let dx = (i32(size.count) - 1) * vx;
  let dy = (i32(size.count) - 1) * vy;
  let margin = i32(size.padding);
  let validWidth = max(0, width - 2 * margin - abs(dx));
  let validHeight = max(0, height - 2 * margin - abs(dy));
  let tileOffset = group.x * ${GROUP_SIZE}u;
  let validArea = u32(validWidth * validHeight);
  let peakIndex = group.y * grid.x + group.x;
  var value = -3.402823e38;
  if (tileOffset >= validArea) {
    if (lane.x == 0u) {
      peaks[peakIndex] = Peak(value, 0xffffffffu);
    }
    return;
  }


  let trackIndex = i32(tileOffset + lane.x);
  var address = 0xffffffffu;
  if (u32(trackIndex) < validArea) {
    let x = margin - min(dx, 0) + trackIndex % validWidth;
    let y = margin - min(dy, 0) + trackIndex / validWidth;
    address = u32(y * width + x);
    var sum = 0.0;
    for (var frame = 0u; frame < size.count; frame += 1u) {
      let position = (y + i32(frame) * vy) * width + x + i32(frame) * vx;
      sum += pixels[frame * area + u32(position)];
    }
    value = sum * inverseSqrt(f32(size.count));
  }
  values[lane.x] = value;
  addresses[lane.x] = address;
  workgroupBarrier();


  for (var stride = ${GROUP_SIZE / 2}u; stride > 0u; stride /= 2u) {
    if (lane.x < stride) {
      let other = lane.x + stride;
      if (values[other] > values[lane.x]
        || (values[other] == values[lane.x] && addresses[other] < addresses[lane.x])) {
        values[lane.x] = values[other];
        addresses[lane.x] = addresses[other];
      }
    }
    workgroupBarrier();
  }
  if (lane.x == 0u) {
    peaks[peakIndex] = Peak(values[0], addresses[0]);
  }
}
`;


let gpuContext;


async function getGpuContext() {
  if (!globalThis.navigator?.gpu) throw new Error('WebGPU is unavailable in this browser.');
  gpuContext ??= (async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter is available on this device.');
    const device = await adapter.requestDevice();
    device.lost.then(() => { gpuContext = undefined; });
    const module = device.createShaderModule({ code: gpuCode });
    const pipeline = await device.createComputePipelineAsync({
      layout: 'auto', compute: { module, entryPoint: 'search' },
    });
    return { device, pipeline };
  })().catch(error => {
    gpuContext = undefined;
    throw error;
  });
  return gpuContext;
}


async function scanGpu(filtered, width, height, count) {
  const { device, pipeline } = await getGpuContext();
  const start = performance.now();
  const groups = Math.ceil((width - 2 * PSF_RADIUS) * (height - 2 * PSF_RADIUS) / GROUP_SIZE);
  const outputBytes = groups * VELOCITIES * 8;
  const buffers = [];
  function buffer(size, usage) {
    const allocation = device.createBuffer({ size, usage });
    buffers.push(allocation);
    return allocation;
  }
  try {
    const input = buffer(filtered.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const output = buffer(outputBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const readback = buffer(outputBytes, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const dimensions = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(input, 0, filtered);
    device.queue.writeBuffer(dimensions, 0, new Uint32Array([width, height, count, PSF_RADIUS]));
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: input } },
        { binding: 1, resource: { buffer: output } },
        { binding: 2, resource: { buffer: dimensions } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(groups, VELOCITIES);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, outputBytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const mapped = readback.getMappedRange();
    const values = new Float32Array(mapped);
    const addresses = new Uint32Array(mapped);
    const peaks = [];
    for (let velocity = 0; velocity < VELOCITIES; velocity += 1) {
      let best = -Infinity;
      let address = 0xffffffff;
      for (let group = 0; group < groups; group += 1) {
        const index = 2 * (velocity * groups + group);
        const value = values[index];
        const position = addresses[index + 1];
        if (position === 0xffffffff) continue;
        if (value > best || (value === best && position < address)) {
          best = value;
          address = position;
        }
      }
      peaks.push({
        x: address === 0xffffffff ? -1 : address % width,
        y: address === 0xffffffff ? -1 : Math.floor(address / width),
        ...velocityFor(velocity),
        score: best,
      });
    }
    readback.unmap();
    if (!peaks.some(peak => Number.isFinite(peak.score))) {
      throw new Error('WebGPU did not return a valid trajectory.');
    }
    return { peaks, ms: performance.now() - start };
  } finally {
    for (const allocation of buffers) allocation.destroy();
  }
}


let cpuContext;


function getCpuContext() {
  if (cpuContext) return cpuContext;
  const worker = new Worker(new URL('./search-worker.mjs', import.meta.url), { type: 'module' });
  const pending = new Map();
  let nextJob = 0;
  const context = new Promise((resolve, reject) => {
    const fail = error => {
      worker.terminate();
      if (cpuContext === context) cpuContext = undefined;
      reject(error);
      for (const job of pending.values()) job.reject(error);
      pending.clear();
    };
    worker.onerror = event => fail(new Error(event.message || 'The CPU search worker could not run.'));
    worker.onmessageerror = () => fail(new Error('The CPU search worker returned unreadable data.'));
    worker.onmessage = ({ data }) => {
      if (data.ready) {
        resolve(request => new Promise((resolveJob, rejectJob) => {
          const id = nextJob++;
          pending.set(id, { resolve: resolveJob, reject: rejectJob, start: performance.now() });
          try {
            worker.postMessage({ id, ...request });
          } catch (error) {
            pending.delete(id);
            rejectJob(error);
          }
        }));
        return;
      }
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      job.resolve({ peaks: data.peaks, ms: performance.now() - job.start });
    };
  });
  cpuContext = context;
  return context;
}


async function scanCpu(filtered, width, height, count) {
  if (typeof Worker === 'undefined') {
    const start = performance.now();
    const peaks = scanSerial(filtered, width, height, count);
    return { peaks, ms: performance.now() - start };
  }
  const runSearch = await getCpuContext();
  return runSearch({ filtered, width, height, count });
}


export async function findCandidates(scene, { backend = 'auto' } = {}) {
  if (!['auto', 'cpu', 'gpu'].includes(backend)) throw new Error(`Unknown backend: ${backend}`);
  const { width, height, count } = scene;
  const filtered = matchedFrames(scene);
  let result;
  let engine = 'cpu';
  if (backend !== 'cpu') {
    try {
      result = await scanGpu(filtered, width, height, count);
      engine = 'gpu';
    } catch (error) {
      if (backend === 'gpu') throw error;
    }
  }
  result ??= await scanCpu(filtered, width, height, count);
  const peaks = result.peaks.sort((a, b) => (b.score - a.score) || (a.vy - b.vy) || (a.vx - b.vx));
  return { best: peaks[0], peaks, backend: engine, ms: result.ms, tested: VELOCITIES };
}
