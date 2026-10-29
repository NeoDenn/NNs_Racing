// Training page: NEAT (src/neat) learns to drive in the racing environment (src/environment).
// The training itself is in training.ts, shared with the terminal (npm run train).

import './style.css';
import { Renderer } from './environment/renderer.ts';
import { type Agent, DEFAULT_SIMULATION_CONFIG, Simulation } from './environment/simulation.ts';
import { TRACKS } from './environment/tracks.ts';
import { NetworkView } from './networkView.ts';
import { DEFAULT_TRACK, MAX_GENERATION_TIME, type SaveFile, Trainer, findTrack } from './training.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#track')!;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!;
const trackSelect = document.querySelector<HTMLSelectElement>('#track-select')!;
const speedSelect = document.querySelector<HTMLSelectElement>('#speed')!;
const sensorsSelect = document.querySelector<HTMLSelectElement>('#show-sensors')!;
const checkpointsToggle = document.querySelector<HTMLInputElement>('#show-checkpoints')!;
const info = document.querySelector<HTMLPreElement>('#info')!;
const networksContainer = document.querySelector<HTMLDivElement>('#networks')!;

// ---- Save file (saves/best-genome.json), shared with the terminal through the dev server (vite.config.ts) ----
const SAVE_URL = '/api/save';
let savedGeneration: number | null = null; // last generation in the save file, null = no save

async function loadSave(): Promise<SaveFile | null> {
  try {
    const res = await fetch(SAVE_URL);
    return res.ok ? ((await res.json()) as SaveFile) : null;
  } catch {
    return null; // no dev server (e.g. a static build): no saves
  }
}

function writeSave(save: SaveFile): void {
  fetch(SAVE_URL, { method: 'PUT', body: JSON.stringify(save) })
    .then((res) => {
      if (res.ok) savedGeneration = save.generation;
    })
    .catch(() => {});
}

// A save that doesn't fit the network anymore (e.g. the number of sensors changed) is ignored
function createTrainer(save: SaveFile | null): Trainer {
  if (save) {
    try {
      const trainer = new Trainer(track, save);
      savedGeneration = save.generation;
      return trainer;
    } catch (e) {
      console.warn('Save file ignored:', e);
    }
  }
  savedGeneration = null;
  return new Trainer(track);
}

const save = await loadSave();
const startTrack = save && TRACKS.some((t) => t.name === save.track) ? save.track : DEFAULT_TRACK;
let track = findTrack(startTrack);
let trainer = createTrainer(save);
const renderer = new Renderer(canvas);

for (const def of TRACKS) trackSelect.add(new Option(def.name, def.name, false, def.name === startTrack));

// Switching track keeps the trained population and restarts the current generation on the new track
trackSelect.addEventListener('change', () => {
  track = findTrack(trackSelect.value);
  trainer.setTrack(track);
  resetPlayer();
});

let running = false;

startButton.addEventListener('click', () => {
  running = !running;
  startButton.textContent = running ? 'Pause' : 'Resume';
});

resetButton.addEventListener('click', async () => {
  if (!confirm('Delete the saved genome and start training again from generation 1?')) return;
  try {
    await fetch(SAVE_URL, { method: 'DELETE' });
  } catch {
    // no dev server: nothing to delete
  }
  trainer = createTrainer(null);
  networkView.clear();
  networksDirty = false;
});

// Network graphs in the footer. Node labels: one per ray (its angle), then the extra inputs
const rayLabels = DEFAULT_SIMULATION_CONFIG.sensors.angles.map((a) => `${Math.round((a * 180) / Math.PI)}°`);
const networkView = new NetworkView(networksContainer, [...rayLabels, 'speed', 'accel', 'drift'], ['steer', 'throttle']);

// Rebuilding the graphs takes time, so at high speeds they are redrawn at most every NETWORK_REDRAW_MS
const NETWORK_REDRAW_MS = 500;
let networksDirty = false;
let lastNetworkDraw = 0;

function updateNetworks(): void {
  const snapshot = trainer.neat.getSnapshot();
  if (!networksDirty || !snapshot || performance.now() - lastNetworkDraw < NETWORK_REDRAW_MS) return;
  networkView.show(snapshot);
  networksDirty = false;
  lastNetworkDraw = performance.now();
}

/** One training step; at the end of a generation the best genome is saved. */
function step(): void {
  if (!trainer.step()) return;
  networksDirty = true;
  writeSave(trainer.toSave()!);
}

// ---- Red test car: driven with the keyboard, in its own simulation so generations never reset it ----
let playerSim: Simulation;
let player: Agent;

function resetPlayer(): void {
  playerSim = new Simulation(track, { stuckTime: Infinity });
  [player] = playerSim.spawn(1);
}

const pressed = new Set<string>();
const KEYS = {
  left: ['ArrowLeft', 'KeyA', 'KeyJ'],
  right: ['ArrowRight', 'KeyD', 'KeyL'],
  gas: ['ArrowUp', 'KeyW', 'KeyI'],
  brake: ['ArrowDown', 'KeyS', 'KeyK'],
};
const isDown = (codes: string[]) => codes.some((c) => pressed.has(c));

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') resetPlayer();
  if (Object.values(KEYS).flat().includes(e.code)) e.preventDefault(); // don't scroll or change a focused menu
  pressed.add(e.code);
});
window.addEventListener('keyup', (e) => pressed.delete(e.code));
window.addEventListener('blur', () => pressed.clear());

function stepPlayer(): void {
  if (player.alive) {
    player.setControls({
      steer: (isDown(KEYS.right) ? 1 : 0) - (isDown(KEYS.left) ? 1 : 0),
      throttle: (isDown(KEYS.gas) ? 1 : 0) - (isDown(KEYS.brake) ? 1 : 0),
    });
  }
  playerSim.step();
}

/** The car that got furthest among those still driving. */
function leader(): Agent | null {
  let best: Agent | null = null;
  for (const agent of trainer.agents) {
    if (!agent.alive) continue;
    if (!best || agent.checkpointsPassed > best.checkpointsPassed) best = agent;
  }
  return best;
}

function updateInfo(focus: Agent | null): void {
  const { neat, sim, agents, lastStats } = trainer;
  const laps = (checkpoints: number) => (checkpoints / track.checkpoints.length).toFixed(2) + ' laps';
  info.textContent = [
    `track         ${track.name}`,
    `generation    ${neat.generation}`,
    `species       ${lastStats?.species ?? '-'}`,
    `alive         ${sim.aliveCount} / ${agents.length}`,
    `time          ${sim.time.toFixed(1)}s / ${MAX_GENERATION_TIME}s`,
    `leader        ${focus ? laps(focus.checkpointsPassed) : '-'}`,
    `last gen best ${lastStats ? laps(lastStats.best.rawFitness) : '-'}`,
    `best ever     ${neat.best ? laps(neat.best.rawFitness) : '-'}`,
    `save file     ${savedGeneration !== null ? `generation ${savedGeneration}` : '-'}`,
    ``,
    `red car       ${player.alive ? 'arrows / WASD to drive, R to reset' : 'crashed, press R to reset'}`,
    `  speed       ${player.car.speed.toFixed(0)} / ${player.car.config.maxSpeed}`,
    `  accel       ${player.car.acceleration.toFixed(0)} per second`,
    `  drift       ${Math.abs(player.car.lateralSpeed).toFixed(0)} sideways`,
    `  NN inputs   speed ${player.sensors.at(-3)!.toFixed(2)}   accel ${player.sensors.at(-2)!.toFixed(2)}   drift ${player.sensors.at(-1)!.toFixed(2)}`,
    `  progress    ${laps(player.checkpointsPassed)}`,
  ].join('\n');
}

// Fixed-timestep loop. At speed N the simulation advances N times faster than real time;
// "max" runs as many steps as fit in each frame.
const FRAME_BUDGET_MS = 14;
let last = performance.now();
let accumulator = 0;
let playerAccumulator = 0;

function frame(now: number): void {
  const frameStart = performance.now();
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  // The red car moves at the same speed multiplier as the training cars: while training runs it steps
  // together with them; while paused it keeps its own clock (with "max" counting as 1×)
  if (!running) {
    const multiplier = speedSelect.value === 'max' ? 1 : Number(speedSelect.value);
    playerAccumulator += realDt * multiplier;
    while (playerAccumulator >= playerSim.config.dt) {
      stepPlayer();
      playerAccumulator -= playerSim.config.dt;
    }
  }

  const dt = trainer.sim.config.dt;
  if (!running) {
    accumulator = 0;
  } else if (speedSelect.value === 'max') {
    while (performance.now() - frameStart < FRAME_BUDGET_MS) {
      step();
      stepPlayer();
    }
    accumulator = 0;
  } else {
    accumulator += realDt * Number(speedSelect.value);
    while (accumulator >= dt && performance.now() - frameStart < FRAME_BUDGET_MS) {
      step();
      stepPlayer();
      accumulator -= dt;
    }
    accumulator = Math.min(accumulator, dt); // don't build up a backlog when the CPU can't keep up
  }

  const focus = leader();
  renderer.draw(trainer.sim, {
    focus,
    showSensors: sensorsSelect.value as 'none' | 'focus' | 'all',
    showCheckpoints: checkpointsToggle.checked,
    player,
  });
  updateInfo(focus);
  updateNetworks();
  requestAnimationFrame(frame);
}

resetPlayer();
requestAnimationFrame(frame);
