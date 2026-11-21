const modeViews = {
  intro: { pitch: .50, yaw: .66, spacing: .43, alignment: 0, ghosts: 1, zoom: 1, track: 1, scan: 0, result: 0 },
  frames: { pitch: .54, yaw: .61, spacing: .47, alignment: 0, ghosts: 1, zoom: .95, track: 0, scan: 0, result: 0 },
  align: { pitch: .57, yaw: .66, spacing: .43, alignment: 1, ghosts: 1, zoom: .92, track: 1, scan: 0, result: 0 },
  scan: { pitch: .59, yaw: .67, spacing: .42, alignment: 0, ghosts: .98, zoom: .96, track: 0, scan: 1, result: 0 },
  result: { pitch: .91, yaw: .27, spacing: .11, alignment: 0, ghosts: .16, zoom: 1.07, track: 0, scan: 0, result: 1 },
  outlook: { pitch: .57, yaw: .80, spacing: .40, alignment: 0, ghosts: .89, zoom: .96, track: 1, scan: 0, result: 0 },
};


const half = 1.76;
const planeSize = half * 2;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const mix = (a, b, fraction) => a + (b - a) * fraction;
const floorY = -1.53;
const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
const candidatePaths = [[-4, -3], [-4, 2], [-2, 4], [0, -4], [1, 4], [3, -3], [4, 2]];


function starsForBackdrop() {
  let seed = 83032;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: 170 }, () => ({
    x: random(), y: random(), radius: .3 + random() ** 3 * 1.25,
    alpha: .12 + random() ** 2 * .43,
  }));
}


function makeTexture(values, width, height, isResult = false) {
  const texture = document.createElement('canvas');
  texture.width = width;
  texture.height = height;
  const context = texture.getContext('2d');
  const data = context.createImageData(width, height);
  for (let index = 0; index < width * height; index++) {
    const sample = values[index];
    const offset = index * 4;
    if (!Number.isFinite(sample)) continue;
    const level = clamp((sample + 2.7) / 5.4, 0, 1);
    const warm = isResult ? clamp((sample - 1.9) / 4.8, 0, 1) : 0;
    data.data[offset] = mix(5 + level * 85, 255, warm);
    data.data[offset + 1] = mix(19 + level * 113, 173, warm);
    data.data[offset + 2] = mix(30 + level * 146, 70, warm);
    data.data[offset + 3] = isResult ? mix(75 + level * 147, 255, warm) : 13 + level ** 2 * 170;
  }
  context.putImageData(data, 0, 0);
  return texture;
}


function drawTextureTriangle(context, texture, points, texturePoints) {
  const [origin, right, below] = points;
  const [top, across, down] = texturePoints;
  const u0 = across[0] - top[0], v0 = across[1] - top[1];
  const u1 = down[0] - top[0], v1 = down[1] - top[1];
  const determinant = u0 * v1 - u1 * v0;
  const a = ((right.x - origin.x) * v1 - (below.x - origin.x) * v0) / determinant;
  const b = ((right.y - origin.y) * v1 - (below.y - origin.y) * v0) / determinant;
  const c = ((below.x - origin.x) * u0 - (right.x - origin.x) * u1) / determinant;
  const d = ((below.y - origin.y) * u0 - (right.y - origin.y) * u1) / determinant;
  context.save();
  context.beginPath();
  context.moveTo(origin.x, origin.y);
  context.lineTo(right.x, right.y);
  context.lineTo(below.x, below.y);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, origin.x - a * top[0] - c * top[1], origin.y - b * top[0] - d * top[1]);
  context.drawImage(texture, 0, 0);
  context.restore();
}


function drawPlaneTexture(context, texture, projectPlane, subdivisions) {
  // Small projected quads keep sensor pixels and the 3D overlays registered.
  for (let row = 0; row < subdivisions; row++) {
    for (let column = 0; column < subdivisions; column++) {
      const cell = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dx, dy]) =>
        [(column + dx) / subdivisions, (row + dy) / subdivisions]);
      const points = cell.map(([u, v]) => projectPlane(-half + u * planeSize, -half + v * planeSize));
      const uv = cell.map(([u, v]) => [u * texture.width, v * texture.height]);
      drawTextureTriangle(context, texture, [points[0], points[1], points[3]], [uv[0], uv[1], uv[3]]);
      drawTextureTriangle(context, texture, [points[3], points[1], points[2]], [uv[3], uv[1], uv[2]]);
    }
  }
}


function path(context, points, close = false) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  if (close) context.closePath();
}


function line(context, from, to, color, width = 1) {
  context.strokeStyle = color;
  context.lineWidth = width;
  path(context, [from, to]);
  context.stroke();
}


function dot(context, point, radius, color) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
}


function luminousDot(context, point, radius, opacity, warm = true) {
  const rgb = warm ? '255,160,66' : '94,225,255';
  const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 13 * radius);
  glow.addColorStop(0, `rgba(${rgb}, ${opacity * .55})`);
  glow.addColorStop(.28, `rgba(${rgb}, ${opacity * .15})`);
  glow.addColorStop(1, `rgba(${rgb}, 0)`);
  dot(context, point, 13 * radius, glow);
  dot(context, point, 2.1 * radius, `rgba(${rgb}, ${opacity})`);
  dot(context, point, .9 * radius, `rgba(255, 246, 225, ${opacity})`);
}


export function createStage(canvas) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const backStars = starsForBackdrop();
  const view = { ...modeViews.intro };
  const alignedVelocity = { vx: 0, vy: 0 };
  let mode = 'intro';
  let scene;
  let textures = [];
  let previewTexture;
  let candidate;
  let request = 0;
  let previousTime;
  let transitionUntil = 0;
  let mobile = false;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let offsetYaw = 0;
  let offsetPitch = 0;
  let drag = null;
  let disposed = false;
  canvas.classList.add('can-orbit');


  function projector(spread) {
    const yaw = view.yaw + offsetYaw;
    const pitch = clamp(view.pitch + offsetPitch, .25, 1.24);
    const cosineYaw = Math.cos(yaw), sineYaw = Math.sin(yaw);
    const cosinePitch = Math.cos(pitch), sinePitch = Math.sin(pitch);
    const verticalSpace = mobile ? 5.65 : 5.48;
    const scale = Math.min(width / 5.65, height / verticalSpace) * view.zoom / (1 + spread * .24);
    const centerX = width * .50;
    const centerY = height * .48;
    return (x, y, z) => {
      const horizontal = cosineYaw * x - sineYaw * z;
      const depth = sineYaw * x + cosineYaw * z;
      const vertical = cosinePitch * y - sinePitch * depth;
      const toCamera = sinePitch * y + cosinePitch * depth;
      const perspective = 13 / (13 - toCamera);
      return { x: centerX + horizontal * scale * perspective, y: centerY - vertical * scale * perspective, depth: toCamera };
    };
  }


  function renderBackdrop(project) {
    const sky = context.createRadialGradient(width * .49, height * .47, 1, width * .49, height * .47, width * .64);
    sky.addColorStop(0, '#111d2a');
    sky.addColorStop(.57, '#0b141e');
    sky.addColorStop(1, '#070d14');
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    for (const star of backStars) {
      const point = { x: star.x * width, y: star.y * height };
      dot(context, point, star.radius, `rgba(132,191,224,${star.alpha})`);
    }


    const floor = project(0, floorY, 0);
    const floorGlow = context.createRadialGradient(floor.x, floor.y, 0, floor.x, floor.y, width * .36);
    floorGlow.addColorStop(0, 'rgba(16, 109, 141, .11)');
    floorGlow.addColorStop(1, 'rgba(16, 109, 141, 0)');
    dot(context, floor, width * .36, floorGlow);
    const gridSize = 2.38;
    for (let column = -6; column <= 6; column++) {
      const position = column * gridSize / 6;
      const alpha = column === 0 ? .19 : .09;
      const gridColor = `rgba(100,192,225,${alpha})`;
      line(context, project(position, floorY, -gridSize), project(position, floorY, gridSize), gridColor);
      line(context, project(-gridSize, floorY, position), project(gridSize, floorY, position), gridColor);
    }
    for (const [x, z] of [[-gridSize, gridSize], [gridSize, -gridSize], [gridSize, gridSize], [-gridSize, -gridSize]]) {
      const marker = project(x, floorY, z);
      dot(context, marker, 1.75, 'rgba(133,202,231,.46)');
    }
  }


  function renderPlane(project, layer, opacity) {
    const { frame, y, dx, dz, texture, main } = layer;
    if (opacity <= .01) return;
    const at = (x, z, thickness = 0) => project(x + dx, y - thickness, z + dz);
    const points = corners.map(([x, z]) => at(x, z));
    const lower = corners.map(([x, z]) => at(x, z, .046));
    const gradient = context.createLinearGradient(points[0].x, points[0].y, points[2].x, points[2].y);
    gradient.addColorStop(0, 'rgba(17,33,46,.64)');
    gradient.addColorStop(.65, 'rgba(17,43,60,.51)');
    gradient.addColorStop(1, 'rgba(30,61,79,.78)');


    context.save();
    context.globalAlpha = opacity;
    for (const side of [1, 2]) {
      const next = (side + 1) % 4;
      path(context, [points[side], points[next], lower[next], lower[side]], true);
      context.fillStyle = 'rgba(19,57,76,.79)';
      context.fill();
      context.strokeStyle = 'rgba(61,154,192,.26)';
      context.lineWidth = .65;
      context.stroke();
    }
    path(context, points, true);
    context.fillStyle = gradient;
    context.fill();
    if (texture) {
      context.imageSmoothingEnabled = main;
      drawPlaneTexture(context, texture, at, 2);
    }
    for (let index = 1; index < 8; index++) {
      const step = -half + index * planeSize / 8;
      const gridColor = index === 4 ? 'rgba(161,218,238,.25)' : 'rgba(149,206,231,.11)';
      line(context, at(step, -half), at(step, half), gridColor, .66);
      line(context, at(-half, step), at(half, step), gridColor, .66);
    }
    path(context, points, true);
    context.lineWidth = main ? 1.18 : .85;
    context.strokeStyle = main ? 'rgba(143,214,238,.73)' : 'rgba(107,188,215,.48)';
    context.stroke();
    for (const [index, [x, z]] of corners.entries()) {
      const edge = .19;
      const tint = main ? 'rgba(188,234,246,.92)' : 'rgba(127,210,240,.54)';
      line(context, points[index], at(x - Math.sign(x) * edge, z), tint, 1.35);
      line(context, points[index], at(x, z - Math.sign(z) * edge), tint, 1.35);
    }
    if (mode === 'frames' && main && !mobile) {
      context.font = '10px ui-monospace, monospace';
      context.fillStyle = '#a7c2d0';
      context.fillText(`T+${String(frame).padStart(2, '0')}`, points[1].x + 9, points[1].y + 3);
    }
    context.restore();
  }


  function plotDataPoint(project, layer, x, y) {
    return project(
      -half + ((x + .5) / scene.width) * planeSize + layer.dx,
      layer.y + .014,
      -half + ((y + .5) / scene.height) * planeSize + layer.dz,
    );
  }


  function trackPoints(project, layers, detector) {
    return layers.map(layer => plotDataPoint(project, layer, detector.x + detector.vx * layer.frame, detector.y + detector.vy * layer.frame));
  }


  function renderTracks(project, layers, phase) {
    if (!scene) return;
    if (mode === 'scan' && candidate) {
      const points = trackPoints(project, layers, candidate);
      context.save();
      context.strokeStyle = 'rgba(110,233,250,.79)';
      context.lineWidth = 1.65;
      path(context, points);
      context.stroke();
      for (const point of points) luminousDot(context, point, .81, .89, false);
      context.restore();
    } else if (view.scan > .01) {
      context.save();
      context.globalAlpha = view.scan;
      for (const [index, [vx, vy]] of candidatePaths.entries()) {
        const detector = {
          x: scene.width * .5 - vx * (scene.count - 1) * .44 + (index % 3 - 1) * 7,
          y: scene.height * .48 - vy * (scene.count - 1) * .47 + (index % 2 - .5) * 13,
          vx,
          vy,
        };
        const points = trackPoints(project, layers, detector);
        const intensity = .24 + .24 * (Math.sin(phase * 4.2 - index * .9) + 1) * .5;
        context.strokeStyle = `rgba(111,220,242,${intensity})`;
        context.lineWidth = 1.1;
        path(context, points);
        context.stroke();
        for (const point of points) dot(context, point, 1.65, `rgba(129,224,237,${intensity})`);
      }
      context.restore();
    }


    if (view.track > .01 && scene.strength > 0) {
      const points = trackPoints(project, layers, scene.truth);
      context.save();
      context.globalAlpha = view.track;
      const amber = context.createLinearGradient(points[0].x, points[0].y, points.at(-1).x, points.at(-1).y);
      amber.addColorStop(0, 'rgba(250,121,44,.11)');
      amber.addColorStop(.42, 'rgba(255,148,58,.64)');
      amber.addColorStop(1, 'rgba(255,205,125,.98)');
      context.strokeStyle = 'rgba(246,127,59,.17)';
      context.lineWidth = 5;
      path(context, points);
      context.stroke();
      context.strokeStyle = amber;
      context.lineWidth = 2;
      context.shadowColor = 'rgba(255,140,60,.68)';
      context.shadowBlur = 13;
      path(context, points);
      context.stroke();
      context.shadowBlur = 0;
      for (const [index, point] of points.entries()) luminousDot(context, point, .8 + index * .075, .56 + index * .07);
      const end = points.at(-1);
      dot(context, end, 7.5, 'rgba(249,156,82,.12)');
      context.beginPath();
      context.arc(end.x, end.y, 5.8, 0, 2 * Math.PI);
      context.lineWidth = .9;
      context.strokeStyle = 'rgba(255,197,121,.62)';
      context.stroke();
      context.restore();
    }
  }


  function renderReticle(point, opacity) {
    context.save();
    context.globalAlpha = opacity;
    luminousDot(context, point, 1.32, 1);
    const color = 'rgba(255,199,125,.86)';
    context.strokeStyle = color;
    context.lineWidth = 1;
    for (let index = 0; index < 4; index++) {
      const angle = index * Math.PI / 2;
      context.beginPath();
      context.arc(point.x, point.y, 16, angle + .18, angle + Math.PI / 2 - .18);
      context.stroke();
      line(context, { x: point.x + Math.cos(angle) * 19, y: point.y + Math.sin(angle) * 19 },
        { x: point.x + Math.cos(angle) * 26, y: point.y + Math.sin(angle) * 26 }, color);
    }
    context.restore();
  }


  function render(time) {
    request = 0;
    if (disposed) return;
    const target = modeViews[mode];
    const dt = previousTime == null ? 0 : Math.min(time - previousTime, 100);
    previousTime = time;
    const blend = reduceMotion.matches ? 1 : 1 - Math.exp(-dt / 133);
    let animating = false;
    for (const property of Object.keys(view)) {
      view[property] = mix(view[property], target[property], blend);
      if (Math.abs(view[property] - target[property]) > .001) animating = true;
      else view[property] = target[property];
    }


    const count = Math.min(7, scene?.count ?? 7);
    const velocity = candidate ?? scene?.truth ?? alignedVelocity;
    for (const axis of ['vx', 'vy']) {
      alignedVelocity[axis] = view.alignment < .01 ? velocity[axis] : mix(alignedVelocity[axis], velocity[axis], blend);
      if (Math.abs(alignedVelocity[axis] - velocity[axis]) > .01) animating = true;
      else alignedVelocity[axis] = velocity[axis];
    }
    const lastFrame = (scene?.count ?? count) - 1;
    const spread = lastFrame * Math.hypot(alignedVelocity.vx, alignedVelocity.vy) * view.alignment / (scene?.width ?? 64);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const project = projector(spread);
    renderBackdrop(project);


    const layers = Array.from({ length: count }, (_, index) => {
      const frame = Math.round(index * lastFrame / Math.max(1, count - 1));
      const relativeTime = frame - lastFrame / 2;
      return {
        frame,
        y: (index - (count - 1) / 2) * view.spacing,
        dx: -alignedVelocity.vx * relativeTime / (scene?.width ?? 64) * planeSize * view.alignment,
        dz: -alignedVelocity.vy * relativeTime / (scene?.height ?? 64) * planeSize * view.alignment,
        texture: textures[frame],
        main: index === count - 1,
      };
    });
    // The projected depth changes as the planes slide along x and z.
    const sorted = [...layers].sort((a, b) => project(a.dx, a.y, a.dz).depth - project(b.dx, b.y, b.dz).depth);
    for (const [index, layer] of sorted.entries()) {
      renderPlane(project, layer, mix(.58, 1, index / Math.max(1, count - 1)) * view.ghosts * (layer.main ? 1 - view.result : 1));
    }
    renderTracks(project, layers, time / 1000);


    if (view.result > .01) {
      const output = { y: .49, dx: 0, dz: 0, texture: previewTexture ?? textures[0], main: true };
      renderPlane(project, output, view.result);
      if (scene && candidate && previewTexture) renderReticle(plotDataPoint(project, output, candidate.x, candidate.y), view.result);
    }


    if (animating || (mode === 'scan' && !candidate && time < transitionUntil)) invalidate();
  }


  function invalidate() {
    if (!request && !disposed) request = requestAnimationFrame(render);
  }


  function resize() {
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    if (box.width === width && box.height === height && nextDpr === dpr) return;
    width = box.width;
    height = box.height;
    mobile = width < 500;
    dpr = nextDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    invalidate();
  }


  function resetView() {
    offsetYaw = offsetPitch = 0;
    invalidate();
  }

  function orbit(yawDelta, pitchDelta) {
    offsetYaw = clamp(offsetYaw + yawDelta, -2.15, 2.15);
    offsetPitch = clamp(offsetPitch + pitchDelta, -.62, .64);
    invalidate();
  }

  function onKeyDown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const offsets = {
      ArrowLeft: [-.12, 0],
      ArrowRight: [.12, 0],
      ArrowUp: [0, .08],
      ArrowDown: [0, -.08],
    };
    if (event.key === 'Home') resetView();
    else if (Object.hasOwn(offsets, event.key)) orbit(...offsets[event.key]);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }


  function onPointerDown(event) {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('is-orbiting');
  }


  function onPointerMove(event) {
    if (drag?.id !== event.pointerId) return;
    orbit((event.clientX - drag.x) * .009, (drag.y - event.clientY) * .006);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }


  function onPointerEnd(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    canvas.classList.remove('is-orbiting');
  }


  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const events = [
    ['pointerdown', onPointerDown], ['pointermove', onPointerMove], ['pointerup', onPointerEnd],
    ['pointercancel', onPointerEnd], ['lostpointercapture', onPointerEnd], ['dblclick', resetView],
    ['keydown', onKeyDown],
  ];
  for (const [event, handler] of events) canvas.addEventListener(event, handler);
  resize();
  invalidate();


  return {
    setScene(nextScene) {
      scene = nextScene;
      candidate = null;
      previewTexture = null;
      const size = scene.width * scene.height;
      textures = Array.from({ length: scene.count }, (_, frame) =>
        makeTexture(scene.frames.subarray(frame * size, (frame + 1) * size), scene.width, scene.height));
      invalidate();
    },
    setMode(nextMode) {
      if (!Object.hasOwn(modeViews, nextMode)) return;
      mode = nextMode;
      previousTime = performance.now();
      transitionUntil = previousTime + (reduceMotion.matches ? 0 : 2600);
      invalidate();
    },
    setCandidate(nextCandidate) {
      candidate = nextCandidate;
      previewTexture = candidate?.pixels && scene ? makeTexture(candidate.pixels, scene.width, scene.height, true) : null;
      previousTime = performance.now();
      invalidate();
    },
    resetView,
    destroy() {
      disposed = true;
      cancelAnimationFrame(request);
      observer.disconnect();
      for (const [event, handler] of events) canvas.removeEventListener(event, handler);
      canvas.classList.remove('can-orbit', 'is-orbiting');
    },
  };
}
