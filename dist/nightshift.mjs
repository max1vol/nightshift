import { makeScene, scoreAt, scoreStack, findCandidates, validTrackCount } from './compute.mjs';
import { createStage } from './stage.mjs';


const $ = (selector, scope = document) => scope.querySelector(selector);
const formatNumber = new Intl.NumberFormat('en');
const sigma = (value) => Number.isFinite(value) ? `${value.toFixed(2)}σ` : 'Outside frame';
const signed = (value) => value > 0 ? `+${value}` : String(value).replace('-', '−');
const velocity = ({ vx, vy }) => `(${signed(vx)}, ${signed(vy)})`;
const elapsed = (ms) => `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
const checkbox = (checked) => checked ? ' checked' : '';
const notes = [
  ['0:00–0:25', 'ESA’s case report puts discovery of the small asteroid 2026 RW1 about six and a half hours before atmospheric entry on 6 September 2026. Earlier detection starts with seeing fainter objects. Here is a runnable experiment in how we could do that.'],
  ['0:25–0:45', 'These are synthetic telescope difference images. The source is deliberately dim in each raw exposure. With the default settings it moves one pixel left and four pixels up every exposure, but keep that motion a secret until the next slide.'],
  ['0:45–1:10', 'Start with zero shift. Click “Use injected motion” and let the stack settle. A telescope sees the target in different pixels on each exposure. Shift the frames along its path and the signal adds where the noise mostly cancels. Here we know the answer so we can see the mechanism.'],
  ['1:10–1:45', 'Now hide the answer and run the blind search. The GPU evaluates every starting pixel and velocity independently, then reduces those scores to one peak per velocity. Run the benchmark if time permits. Compare the measured times on the machine in front of you.'],
  ['1:45–2:10', 'The winning path is checked against the hidden injection. Compare the aligned and unshifted scores at the same position. For a second pass, load the empty sky and search again. A noise-only search still has a maximum, which is why a candidate needs calibration and follow-up.'],
  ['2:10–2:30', 'A telescope pipeline would need real difference images, a measured false-alarm rate, and independent follow-up. Synthetic tracking already has real precedent. This prototype puts the data, parallel computation, and check into one reproducible demo.'],
];
const sourceLinks = {
  rw1: 'https://neo.ssa.esa.int/past-impactors/2026rw1',
  hera: 'https://www.esa.int/articles/about-us/directorates/operations/space-safety/hera/sir-brian-may-adds-new-dimension-to-hera-asteroid',
  nasa: 'https://www.nasa.gov/solar-system/near-earth-object-observations-program/',
  wise: 'https://doi.org/10.3847/PSJ/ae6fa1',
  gpu: 'https://doi.org/10.1051/0004-6361/202553973',
  tracking: 'https://arxiv.org/abs/1403.4353',
  event: 'https://luma.com/scientific-parallelism',
};
const source = (id, label) => `<a href="${sourceLinks[id]}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const action = (id, label, className = 'primary') => `<button type="button" class="${className}" id="${id}">${label}</button>`;
const stat = (value, label) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
const legend = (text, type = '') => `<span class="legend-item"><i class="legend-line ${type}"></i>${text}</span>`;
const slide = $('#slide');
const stageElement = $('#stage');
const sky = $('#sky');
const stage = createStage(sky);
const stageHint = $('#stage-hint');
const stageContent = $('#stage-content');
const dialog = $('#dialog');


const state = {
  index: -1, seed: 27, strength: 1.4, injectedStrength: 1.4, frames: 12, baseScene: null, scene: null,
  vx: 0, vy: 0, result: null, backend: 'auto', operation: null, benchmark: null,
  status: '', error: false,
};


const slides = [
  {
    key: 'mission', name: 'Mission', mode: 'intro', stageTitle: 'Exposure volume',
    tag: 'SYNTHETIC SKY', legend: () => legend('Illustrated motion'),
    content: () => `
      <p class="kicker">Planetary defense</p>
      <h1 id="slide-title" tabindex="-1">Find the<br><em>faint ones.</em></h1>
      <p class="lede">A moving asteroid can disappear into telescope noise. Search many possible paths in parallel and see a faint signal come into focus.</p>
      <div class="actions">${action('start', 'Start the demo')}${action('skip', 'Jump to live search', 'secondary')}</div>
      <div class="hero-fact"><strong>≈6.5 hours</strong><p>From discovery of asteroid 2026 RW1 to atmospheric entry on 6 September, according to the ${source('rw1', 'ESA case report')}.</p></div>`,
    bind() { $('#start').onclick = () => go(1); $('#skip').onclick = () => go(3); },
  },
  {
    key: 'frames', name: 'Exposures', shortName: 'Sky', mode: 'frames', stageTitle: 'Difference images',
    tag: 'SYNTHETIC SKY', legend: () => legend(`Showing ${Math.min(7, state.frames)} of ${state.frames} exposures`, 'blue'),
    content: () => `
      <p class="kicker">The signal</p>
      <h1 id="slide-title" tabindex="-1">One frame.<br><em>All noise.</em></h1>
      <p class="lede">${state.strength > 0 ? 'A faint source moves a few pixels per exposure. In a single image, a bright pixel could be the asteroid or a fluctuation in the background.' : 'This blank-sky control uses the same noise sequence with the moving source turned off.'}</p>
      <div class="stat-strip">${stat('64 × 64', 'Pixels per frame')}${stat(`<output id="frame-stat">${state.frames}</output>`, 'Exposures')}${stat(`${state.strength.toFixed(1)}σ`, 'Injected peak per pixel')}</div>
      <div class="controls">
        <div class="control-head"><label for="frames">Exposures in the search</label><output id="frames-output" for="frames">${state.frames}</output></div>
        <input type="range" id="frames" min="4" max="12" value="${state.frames}" step="4">
        <button class="text-btn" type="button" id="experiment">Change experiment</button>
      </div>
      <div class="actions">${action('align-next', 'Align the exposures')}</div>`,
    bind() {
      $('#frames').oninput = (event) => {
        state.frames = Number(event.target.value);
        updateScene();
        $('#frames-output').value = state.frames;
        $('#frame-stat').textContent = state.frames;
        $('#stage-legend').innerHTML = slides[1].legend();
      };
      $('#experiment').onclick = openExperiment;
      $('#align-next').onclick = () => go(2);
    },
  },
  {
    key: 'align', name: 'Alignment', shortName: 'Align', mode: 'align', stageTitle: 'Shift and stack',
    tag: 'MANUAL ALIGNMENT', legend: () => legend('Trial motion'),
    content: () => `
      <p class="kicker">The method</p>
      <h1 id="slide-title" tabindex="-1">Move with<br><em>the asteroid.</em></h1>
      <p class="lede">${state.strength > 0 ? 'Shift each exposure by its predicted motion. At the right velocity, the same point adds up across the stack.' : 'This blank-sky control contains only noise. Try shifting and stacking it, then use the live search to find the strongest noise peak.'}</p>
      <div class="controls">
        <div class="control-head"><label for="vx">Horizontal shift</label><output id="vx-out" for="vx">${signed(state.vx)} px / frame</output></div>
        <input type="range" id="vx" min="-5" max="5" value="${state.vx}">
        <div class="control-head"><label for="vy">Vertical shift</label><output id="vy-out" for="vy">${signed(state.vy)} px / frame</output></div>
        <input type="range" id="vy" min="-5" max="5" value="${state.vy}">
      </div>
      <div class="stat-strip twocol">
        ${stat('<output id="manual-score">—</output>', state.strength > 0 ? 'Score at injected origin' : 'Score at reference pixel')}
        ${stat(`${state.frames}`, 'Stacked exposures')}
      </div>
      <div class="actions">${state.strength > 0 ? action('snap', 'Use injected motion', 'secondary') : ''}${action('go-scan', 'Search without the answer')}</div>`,
    bind() {
      const apply = () => {
        state.vx = Number($('#vx').value);
        state.vy = Number($('#vy').value);
        $('#vx-out').value = `${signed(state.vx)} px / frame`;
        $('#vy-out').value = `${signed(state.vy)} px / frame`;
        refreshAlignment();
      };
      $('#vx').oninput = apply;
      $('#vy').oninput = apply;
      $('#snap')?.addEventListener('click', () => {
        $('#vx').value = state.scene.truth.vx;
        $('#vy').value = state.scene.truth.vy;
        apply();
      });
      $('#go-scan').onclick = () => go(3);
      refreshAlignment();
    },
  },
  {
    key: 'search', name: 'Live search', shortName: 'Search', mode: 'scan', stageTitle: 'Velocity search',
    tag: 'LIVE COMPUTE', legend: () => legend(state.result ? 'Selected trajectory' : 'Example trajectories', 'blue'),
    content: () => `
      <p class="kicker">The parallel search</p>
      <h1 id="slide-title" tabindex="-1">Test every<br><em>possible path.</em></h1>
      <p class="lede">Try every valid combination of starting pixel and velocity. The search keeps the strongest candidate for each velocity and can evaluate paths in parallel with WebGPU.</p>
      <div class="stat-strip">
        ${stat('121', 'Velocities')}
        ${stat(formatNumber.format(validTrackCount(state.scene)), 'Valid trajectories')}
        ${stat(state.frames, 'Exposures per path')}
      </div>
      <div class="controls">
        <fieldset><legend>Search engine</legend><div class="engine-options">
          ${[['auto','Auto'],['gpu','WebGPU'],['cpu','Serial CPU']].map(([value, label]) => `<label><input type="radio" name="engine" value="${value}"${checkbox(state.backend === value)}> ${label}</label>`).join('')}
        </div></fieldset>
        <div class="actions">
          ${action('run', 'Run live search')}
          ${action('benchmark', 'CPU vs GPU', 'secondary')}
          ${action('inspect', 'Inspect result', 'secondary')}
        </div>
        <div class="run-status" id="run-status" role="status"></div>
        <div class="benchmark" id="benchmark-data" hidden></div>
      </div>`,
    bind() {
      for (const input of slide.querySelectorAll('[name=engine]')) {
        input.onchange = () => { state.backend = input.value; };
      }
      $('#run').onclick = () => run(false);
      $('#benchmark').onclick = () => run(true);
      $('#inspect').onclick = () => go(4);
      renderSearch();
    },
  },
  {
    key: 'verify', name: 'Verification', shortName: 'Check', mode: 'result', stageTitle: 'Motion-aligned stack',
    tag: 'RECOVERY CHECK', legend: () => legend('Peak in the aligned stack'),
    content: () => `
      <p class="kicker">The result</p>
      <h1 id="slide-title" tabindex="-1">Check the<br><em>winning track.</em></h1>
      ${verificationBody()}
      <div class="actions">
        ${action('verify-search', state.result ? (state.strength === 0 ? 'Restore injected target' : 'Run a blank control') : 'Go to live search')}
        ${action('verify-edit', 'Change experiment', 'secondary')}
      </div>`,
    bind() {
      $('#verify-search').onclick = () => {
        if (state.result) {
          state.strength = state.strength === 0 ? state.injectedStrength : 0;
          updateScene(true);
          go(3);
          run(false);
        } else go(3);
      };
      $('#verify-edit').onclick = openExperiment;
    },
  },
  {
    key: 'impact', name: 'Impact', mode: 'outlook', stageTitle: 'Planetary defense',
    tag: 'MISSION CONTEXT', legend: () => legend('Detection, follow-up, orbit'),
    content: () => `
      <p class="kicker">Why it matters</p>
      <h1 id="slide-title" tabindex="-1">Find it<br><em>sooner.</em></h1>
      <p class="lede">Earlier detection gives observers more time to confirm an orbit and assess risk.</p>
      <ul class="impact-list">
        <li><strong>Fewer than half</strong> of the estimated 25,000 near-Earth objects at least 140 m wide have been found. ${source('nasa', 'NASA survey program')}</li>
        <li><strong>8,157 unidentified main-belt candidates</strong> from a 2026 synthetic-tracking search of 1.5 million archival images. ${source('wise', 'Published study')}</li>
        <li><strong>19 November 2026.</strong> ESA released new stereo views of the Didymos asteroid system from Hera. ${source('hera', 'ESA mission update')}</li>
      </ul>
      <div class="actions">${action('rerun', 'Run another search')}${action('methods', 'See methods', 'secondary')}</div>`,
    bind() { $('#rerun').onclick = () => go(3); $('#methods').onclick = openSources; },
  },
];


function updateScene(regenerate = false) {
  if (regenerate || !state.baseScene) {
    state.baseScene = makeScene({ seed: state.seed, strength: state.strength });
  }
  const base = state.baseScene;
  state.scene = {
    ...base, count: state.frames,
    frames: base.frames.subarray(0, state.frames * base.width * base.height),
  };
  state.result = null;
  state.benchmark = null;
  state.operation = null;
  state.status = '';
  state.error = false;
  stage.setScene(state.scene);
}


function refreshAlignment() {
  const { vx, vy, scene } = state;
  const { x, y } = scene.truth;
  const value = scoreAt(scene, x, y, vx, vy);
  $('#manual-score').textContent = sigma(value);
  stage.setCandidate({ x, y, vx, vy, score: value, pixels: scoreStack(scene, vx, vy) });
}


function verificationBody() {
  if (state.operation) {
    return '<p class="lede" role="status">Search in progress. The result will appear here when it’s ready.</p>';
  }
  if (!state.result) {
    return '<p class="lede">Run a blind search to see the inferred motion, compare it with the injected target, and measure what alignment adds.</p>';
  }
  const best = state.result.best;
  const baseline = scoreAt(state.scene, best.x, best.y, 0, 0);
  const truth = state.scene.truth;
  const recovered = best.x === truth.x && best.y === truth.y && best.vx === truth.vx && best.vy === truth.vy;
  let detail = `Peak at pixel (${best.x}, ${best.y}). Search velocity ${velocity(best)} px/frame. `;
  if (state.strength === 0) {
    detail += 'This stack contains only noise. A blind search still returns its brightest peak.';
  } else if (recovered) {
    detail += 'Position and velocity exactly match the injected target.';
  } else {
    detail += `The injected target was at (${truth.x}, ${truth.y}) with velocity ${velocity(truth)} px/frame.`;
  }
  return `
    <p class="lede">${state.strength === 0 ? 'The same search on a sky with no injected asteroid.' : 'Compare the same pixel with and without motion alignment.'}</p>
    <div class="stat-strip twocol">${stat(sigma(baseline), 'Unshifted score')}${stat(sigma(best.score), state.strength === 0 ? 'Blank-sky peak' : 'Winning score')}</div>
    <p class="callout">${detail}</p>
    <p class="detail">Scores are in units of synthetic noise. A survey would need to measure the false-alarm rate across the full search grid.</p>`;
}


function renderSlide() {
  const selected = slides[state.index];
  slide.dataset.index = state.index;
  stageElement.dataset.mode = selected.mode;
  stageElement.dataset.running = 'false';
  slide.innerHTML = `<div>${selected.content()}</div>`;
  $('#stage-title').textContent = selected.stageTitle;
  $('#stage-tag').textContent = selected.tag;
  $('#stage-legend').innerHTML = selected.legend();
  sky.setAttribute('aria-label', selected.mode === 'result' ? 'Motion-aligned synthetic exposure stack and peak location' : 'Three-dimensional view of time-separated synthetic telescope exposures');
  sky.hidden = selected.mode === 'outlook';
  stageHint.textContent = 'Drag to orbit';
  $('.stage-actions').hidden = sky.hidden;
  stageContent.innerHTML = '';
  stage.setMode(selected.mode);
  if (selected.mode === 'result' && state.result) {
    showCandidate(state.result.best);
    const best = state.result.best;
    stageContent.innerHTML = `<div class="result-cards">${[
      ['Unshifted', sigma(scoreAt(state.scene, best.x, best.y, 0, 0))],
      ['Aligned', sigma(best.score)],
    ].map(([label, value]) => `<div class="${label === 'Aligned' ? 'winner' : ''}"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
  } else {
    stage.setCandidate(null);
  }
  if (selected.mode === 'outlook') {
    const photo = new Image();
    photo.className = 'impact-photo';
    photo.alt = 'Illustration of a rocky asteroid above the curved limb of Earth';
    photo.onload = () => {
      if (state.index !== 5 || state.impactPhoto !== photo) return;
      stageElement.prepend(photo);
      stageContent.innerHTML = '<p class="impact-caption">Artist’s illustration</p>';
    };
    state.impactPhoto = photo;
    photo.src = './impact.webp';
  }
  stageElement.querySelectorAll('.impact-photo').forEach((photo) => photo.remove());
  selected.bind();
}


function go(index, { focus = true, history = true } = {}) {
  if (index < 0 || index >= slides.length || index === state.index) return;
  state.index = index;
  if (history && location.protocol !== 'about:') {
    const hash = `#${slides[index].key}`;
    if (location.hash !== hash) window.history.pushState(null, '', hash);
  }
  renderSlide();
  $('#current-slide').textContent = String(index + 1).padStart(2, '0');
  $('#prev').disabled = index === 0;
  $('#next').disabled = index === slides.length - 1;
  Array.from($('#chapters').children).forEach((button, i) => {
    if (i === index) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  document.title = `${slides[index].name} · Nightshift`;
  if (focus) {
    $('#slide-title').focus({ preventScroll: true });
    if (window.innerWidth <= 760) window.scrollTo({ top: 0 });
  }
}


function showCandidate(candidate) {
  stage.setCandidate(candidate ? {
    ...candidate, pixels: scoreStack(state.scene, candidate.vx, candidate.vy),
  } : null);
}


function renderSearch() {
  if (state.index !== 3) {
    if (state.index === 4) {
      const activeId = slide.contains(document.activeElement) ? document.activeElement.id : null;
      renderSlide();
      if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
    }
    return;
  }
  const waiting = Boolean(state.operation);
  $('#run').setAttribute('aria-disabled', String(waiting));
  $('#benchmark').setAttribute('aria-disabled', String(waiting));
  $('#inspect').hidden = !state.result;
  $('#inspect').disabled = waiting;
  for (const el of slide.querySelectorAll('[name=engine]')) el.disabled = waiting;
  stageElement.dataset.running = String(waiting);
  const status = $('#run-status');
  status.classList.toggle('error', state.error);
  status.textContent = state.status || 'Run a blind search across the synthetic exposure stack.';
  const data = $('#benchmark-data');
  data.hidden = !state.benchmark;
  if (state.benchmark) {
    const { cpu, gpu, agrees, maxDifference } = state.benchmark;
    data.innerHTML = `<span>Serial CPU median</span><strong>${elapsed(cpu)}</strong>
      <span>WebGPU median</span><strong>${gpu === null ? 'Unavailable' : elapsed(gpu)}</strong>
      <p>${gpu === null ? 'CPU search ran successfully. This browser could not run WebGPU.' :
        `${agrees ? 'Peak positions agree across all velocities.' : 'Peak position mismatch.'} Max score difference ${maxDifference.toExponential(1)}σ. Three measured trials each after warm-up.`}</p>`;
  }
  $('#stage-legend').innerHTML = slides[3].legend();
  if (state.result) {
    drawHeatmap(state.result);
  } else {
    stageContent.innerHTML = '';
    stage.setCandidate(null);
  }
}


function drawHeatmap(result) {
  stageContent.innerHTML = `<div class="scan-card">
    <p id="heatmap-label">Peak score by velocity</p>
    <canvas class="heatmap" width="121" height="121" role="group" tabindex="0" aria-label="Velocity heatmap. Click or use arrow keys to inspect a cell. Press Enter for the winning velocity."></canvas>
    <small id="heatmap-selection" aria-live="polite"></small></div>`;
  const canvas = $('.heatmap');
  const context = canvas.getContext('2d');
  const maximum = result.best.score;
  let selected = result.best;
  const draw = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const peak of result.peaks) {
      const brightness = Math.max(0, Math.min(1, (peak.score - 2) / Math.max(0.1, maximum - 2)));
      const rgb = [25 + 230 * brightness, 42 + 105 * brightness, 70 + 8 * brightness];
      context.fillStyle = `rgb(${rgb.map(Math.round).join(',')})`;
      context.fillRect((peak.vx + 5) * 11, (peak.vy + 5) * 11, 10, 10);
    }
    context.strokeStyle = '#fff2cf';
    context.strokeRect((selected.vx + 5) * 11 + .5, (selected.vy + 5) * 11 + .5, 9, 9);
    $('#heatmap-selection').textContent = `${velocity(selected)} · ${sigma(selected.score)}`;
    showCandidate(selected);
  };
  const choose = (vx, vy) => {
    selected = result.peaks.find(peak => peak.vx === vx && peak.vy === vy) || selected;
    draw();
  };
  canvas.onclick = (event) => {
    const bounds = canvas.getBoundingClientRect();
    choose(Math.floor((event.clientX - bounds.left) / bounds.width * 11) - 5,
      Math.floor((event.clientY - bounds.top) / bounds.height * 11) - 5);
  };
  canvas.onkeydown = (event) => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta && event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (delta) choose(selected.vx + delta[0], selected.vy + delta[1]);
    else choose(result.best.vx, result.best.vy);
  };
  draw();
}


async function run(compare) {
  if (state.operation) return;
  const request = {};
  state.operation = request;
  state.error = false;
  state.result = null;
  state.benchmark = null;
  state.status = compare ? 'Warming up and comparing both engines…' : 'Searching the exposure stack…';
  const scene = state.scene;
  renderSearch();
  try {
    // Give the status and the search animation a frame before starting local compute.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (state.operation !== request) return;
    if (compare) {
      const cpu = await measure(scene, 'cpu');
      if (state.operation !== request) return;
      let gpu = null;
      try {
        gpu = await measure(scene, 'gpu');
      } catch (error) {
        console.info('WebGPU comparison unavailable:', error.message);
      }
      if (state.operation !== request) return;
      const key = ({ vx, vy }) => `${vx},${vy}`;
      const byVelocity = new Map(cpu.result.peaks.map((peak) => [key(peak), peak]));
      const paired = gpu ? gpu.result.peaks.map((peak) => [peak, byVelocity.get(key(peak))]) : [];
      state.result = gpu?.result || cpu.result;
      state.benchmark = {
        cpu: cpu.median, gpu: gpu?.median ?? null,
        agrees: paired.every(([a, b]) => a.x === b.x && a.y === b.y),
        maxDifference: Math.max(0, ...paired.map(([a, b]) => Math.abs(a.score - b.score))),
      };
    } else {
      const result = await findCandidates(scene, { backend: state.backend });
      if (state.operation !== request) return;
      state.result = result;
    }
    const result = state.result;
    const engine = result.backend === 'gpu' ? 'WebGPU' : 'Serial CPU';
    state.status = `${engine} found ${sigma(result.best.score)} at ${velocity(result.best)} px/frame in ${elapsed(result.ms)}.`;
    if (!compare && state.backend === 'auto' && result.backend === 'cpu') state.status += ' Auto used its CPU fallback.';
  } catch (error) {
    if (state.operation !== request) return;
    state.error = true;
    state.status = state.backend === 'gpu'
      ? 'WebGPU search failed on this device. Choose Auto or Serial CPU to continue.'
      : 'The search failed. Run it again or change the experiment.';
    console.error(error);
  } finally {
    if (state.operation === request) {
      state.operation = null;
      renderSearch();
    }
  }
}


async function measure(scene, backend) {
  await findCandidates(scene, { backend });
  const results = [];
  for (let trial = 0; trial < 3; trial++) {
    results.push(await findCandidates(scene, { backend }));
  }
  results.sort((a, b) => a.ms - b.ms);
  return { result: results[1], median: results[1].ms };
}


function showDialog(title, body) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body;
  if (!dialog.open) dialog.showModal();
}


function openNotes() {
  const [time, note] = notes[state.index];
  showDialog(`Speaker notes · ${slides[state.index].name}`, `
    <p><strong>${time}</strong> · Max’s solo run of show</p><p>${note}</p>
    <p>Use the slide tabs or left and right arrow keys. Press F to toggle fullscreen.</p>`);
}


function openSources() {
  showDialog('Sources & methods', `
    <p>Nightshift is a synthetic tracking prototype. It searches 121 integer velocities from −5 to +5 pixels per frame on both axes. A Gaussian point-spread filter runs once per scene. Each trajectory score sums the filtered values and divides by the square root of the exposure count. The search masks tracks that move beyond the valid image region.</p>
    <p>CPU vs GPU reports medians of three measured runs after one warm-up on each engine. Timing covers search and result transfer with the same prefiltered cube. Browser, hardware and workload affect the comparison.</p>
    <p>The simulated source moves linearly in independent Gaussian noise after ideal background subtraction. Real surveys also need calibrated images, masking, subpixel paths, false-alarm estimates, and independent observations to confirm candidates.</p>
    <h3>Science and event references</h3>
    <ul>
      <li>${source('rw1', 'ESA · The 2026 RW1 impact report')}</li>
      <li>${source('nasa', 'NASA · Near-Earth Object Observations Program')}</li>
      <li>${source('hera', 'ESA · Hera stereo views, 19 November 2026')}</li>
      <li>${source('wise', 'Whittaker &amp; Margot · 2026 WISE synthetic-tracking study')}</li>
      <li>${source('gpu', 'Stănescu et al. · GPU synthetic tracking for fast near-Earth asteroids')}</li>
      <li>${source('tracking', 'Zhai et al. · Detection of a faint near-Earth asteroid using synthetic tracking')}</li>
      <li>${source('event', 'SoTA · Scientific Parallelism Hackathon')}</li>
    </ul>`);
}


function openExperiment() {
  showDialog('Change experiment', `
    <p>Keep the same seed to compare the same noise and hidden trajectory. Set brightness to zero for a blank control.</p>
    <form id="experiment-form">
      <label for="seed">Noise seed</label>
      <input type="number" id="seed" min="0" max="999999" required value="${state.seed}">
      <label for="strength">Injected peak brightness <output id="strength-out" for="strength">${state.strength.toFixed(1)}σ</output></label>
      <input type="range" id="strength" min="0" max="2.5" step="0.1" value="${state.strength}">
      <div class="actions">${action('new-seed', 'Next seed', 'secondary')}<button class="primary" type="submit">Apply experiment</button></div>
    </form>`);
  $('#strength').oninput = () => { $('#strength-out').value = `${Number($('#strength').value).toFixed(1)}σ`; };
  $('#new-seed').onclick = () => { $('#seed').value = ((Number($('#seed').value) || 0) + 1) % 1000000; };
  $('#experiment-form').onsubmit = (event) => {
    event.preventDefault();
    state.seed = Number($('#seed').value);
    state.strength = Number($('#strength').value);
    if (state.strength > 0) state.injectedStrength = state.strength;
    state.vx = 0;
    state.vy = 0;
    updateScene(true);
    dialog.close();
    renderSlide();
    $('#slide-title').focus({ preventScroll: true });
  };
}


function updatePresentationLabel() {
  const presenting = Boolean(document.fullscreenElement || document.body.classList.contains('fullscreen-fallback'));
  $('#present-label').textContent = presenting ? 'Exit fullscreen' : 'Present';
  $('#present-btn').setAttribute('aria-pressed', String(presenting));
}


async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else if (document.body.classList.contains('fullscreen-fallback')) {
    document.body.classList.remove('fullscreen-fallback');
  } else {
    try {
      if (!document.documentElement.requestFullscreen) throw new Error('Fullscreen unavailable');
      await document.documentElement.requestFullscreen();
    } catch {
      document.body.classList.add('fullscreen-fallback');
    }
  }
  updatePresentationLabel();
}


function fromHash() {
  const match = slides.findIndex((entry) => `#${entry.key}` === location.hash);
  go(Math.max(0, match), { focus: state.index !== -1, history: false });
}


for (const [index, entry] of slides.entries()) {
  const button = document.createElement('button');
  button.className = 'chapter';
  button.type = 'button';
  button.setAttribute('aria-label', entry.name);
  button.innerHTML = `<span aria-hidden="true" class="chapter-label">${entry.name}</span><span aria-hidden="true" class="chapter-compact">${entry.shortName || entry.name}</span>`;
  button.onclick = () => go(index);
  $('#chapters').append(button);
}
$('#prev').onclick = () => go(state.index - 1);
$('#next').onclick = () => go(state.index + 1);
sky.onfocus = () => { stageHint.textContent = 'Arrow keys to orbit · Home to reset'; };
sky.onblur = () => { stageHint.textContent = 'Drag to orbit'; };
$('.brand').onclick = (event) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  go(0);
};
$('#reset-view').onclick = () => stage.resetView();
$('#present-btn').onclick = toggleFullscreen;
$('#notes-btn').onclick = openNotes;
$('#sources-btn').onclick = openSources;
document.addEventListener('fullscreenchange', updatePresentationLabel);
window.addEventListener('hashchange', fromHash);
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || dialog.open || event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('input, select, textarea, [contenteditable]')) return;
  const jump = { ArrowRight: state.index + 1, PageDown: state.index + 1, ArrowLeft: state.index - 1, PageUp: state.index - 1, Home: 0, End: slides.length - 1 };
  if (Object.hasOwn(jump, event.key)) {
    event.preventDefault();
    go(jump[event.key]);
  } else if (event.key.toLowerCase() === 'f' && !event.repeat) {
    event.preventDefault();
    toggleFullscreen();
  } else if (event.key === 'Escape' && document.body.classList.contains('fullscreen-fallback')) {
    document.body.classList.remove('fullscreen-fallback');
    updatePresentationLabel();
  }
});


updateScene(true);
updatePresentationLabel();
fromHash();
