// Training page: NEAT (src/neat) learns to drive in the racing environment (src/environment).

import './style.css';
import { Renderer } from './environment/renderer.ts';
import { type Agent, DEFAULT_SIMULATION_CONFIG, Simulation, inputCount } from './environment/simulation.ts';
import { buildTrack } from './environment/track.ts';
import { TRACKS } from './environment/tracks.ts';
import { type GenerationStats, Neat } from './neat/index.ts';
import { NetworkView } from './networkView.ts';

// ---- Parameters ----
const TRACK_NAME = 'Oval'; // starting track, can be changed on the page: 'Oval', 'Twisty', 'Maze'
const POPULATION = 100; // cars per generation
const MAX_GENERATION_TIME = 30; // simulated seconds before a generation is ended (good cars could lap forever)

// Score of one car at the end of its generation: higher = better.
// One point per checkpoint, so a car that gets further (or laps faster in the time limit) wins.
function fitness(agent: Agent): number {
  return agent.checkpointsPassed;
}

const canvas = document.querySelector<HTMLCanvasElement>('#track')!;
const startButton = document.querySelector<HTMLButtonElement>('#start')!;
const trackSelect = document.querySelector<HTMLSelectElement>('#track-select')!;
const speedSelect = document.querySelector<HTMLSelectElement>('#speed')!;
const sensorsSelect = document.querySelector<HTMLSelectElement>('#show-sensors')!;
const checkpointsToggle = document.querySelector<HTMLInputElement>('#show-checkpoints')!;
const info = document.querySelector<HTMLPreElement>('#info')!;
const networksContainer = document.querySelector<HTMLDivElement>('#networks')!;

function findTrack(name: string) {
  const def = TRACKS.find((t) => t.name === name);
  if (!def) throw new Error(`No track named "${name}". Available: ${TRACKS.map((t) => t.name).join(', ')}`);
  return buildTrack(def);
}

let track = findTrack(TRACK_NAME);
const renderer = new Renderer(canvas);

for (const def of TRACKS) trackSelect.add(new Option(def.name, def.name, false, def.name === TRACK_NAME));

// Switching track keeps the trained population and restarts the current generation on the new track
trackSelect.addEventListener('change', () => {
  track = findTrack(trackSelect.value);
  startGeneration();
  resetPlayer();
});

/*
| `populationSize` | 100 | Genomes per generation |
| `activation` | `"sigmoid"` | `"sigmoid"` (steepened, as in NEAT, outputs 0..1), `"tanh"` (-1..1), `"relu"`, `"identity"` |
| `weightRange` | 3 | Weights and biases go from -weightRange to +weightRange |
| `complexityPenalty` | 0.001 | Fitness lost for every enabled connection |
| `maxNodes` / `maxConnections` | Infinity | Max size of a genome |
| `compatibilityThreshold` | 3 | Starting species threshold (then it adapts) |
| `minSpecies` / `maxSpecies` | 5 / 10 | The threshold adapts to stay in this range |
| `thresholdStep` / `minThreshold` | 0.2 / 0.3 | How the threshold adapts |
| `maxSpeciesSlots` | 100 | Max number of species at the same time |
| `maxStagnation` | 15 | Generations without improvement before a specie stops having children |
| `excessCoefficient` / `disjointCoefficient` / `weightCoefficient` | 1 / 1 / 0.4 | c1, c2, c3 of the genetic distance |
| `distanceMinGenes` | 20 | N of the genetic distance is never lower than this |
| `survivalRate` | 0.2 | Best part of a specie that can be a parent |
| `championMinSpecieSize` | 5 | The champion is copied unchanged if the specie is bigger than this |
| `cloneChance` | 0.25 | Child = copy of a parent (otherwise crossover) |
| `interspeciesCrossoverChance` | 0.001 | Second parent from another specie |
| `disabledGeneChance` | 0.75 | Gene disabled in a parent, disabled in the child |
| `weightMutationChance` | 0.8 | Chance of mutating the weights of a child |
| `weightPerturbChance` / `weightPerturbance` | 0.9 / 0.1 | Slight change (± weightPerturbance) or new random value |
| `addNodeChance` / `deleteNodeChance` | 0.03 / 0.01 | Structural mutations |
| `addConnectionChance` / `deleteConnectionChance` | 0.05 / 0.03 | Structural mutations |
| `addConnectionAttempts` | 20 | Random pairs tried by Add Connection before giving up |
*/

const neat = new Neat({
  inputs: inputCount(), // rays + speed + acceleration + drift
  outputs: 2, // steer, throttle
  activation: 'tanh', // outputs in -1..1
  populationSize: POPULATION,
  complexityPenalty: 0,
  weightRange: 10,
  maxStagnation: 50,
  addNodeChance: 0.1,
  deleteNodeChance: 0.02,
  addConnectionChance: 0.15,
  deleteConnectionChance: 0.75,
  minSpecies: 20,
  maxSpecies: 30,
});

let sim: Simulation;
let agents: Agent[] = [];
let lastStats: GenerationStats | null = null;
let running = false;

// Network graphs in the footer. Node labels: one per ray (its angle), then the extra inputs
const rayLabels = DEFAULT_SIMULATION_CONFIG.sensors.angles.map((a) => `${Math.round((a * 180) / Math.PI)}°`);
const networkView = new NetworkView(networksContainer, [...rayLabels, 'speed', 'accel', 'drift'], ['steer', 'throttle']);

// Rebuilding the graphs takes time, so at high speeds they are redrawn at most every NETWORK_REDRAW_MS
const NETWORK_REDRAW_MS = 500;
let networksDirty = false;
let lastNetworkDraw = 0;

function updateNetworks(): void {
  const snapshot = neat.getSnapshot();
  if (!networksDirty || !snapshot || performance.now() - lastNetworkDraw < NETWORK_REDRAW_MS) return;
  networkView.show(snapshot);
  networksDirty = false;
  lastNetworkDraw = performance.now();
}

startButton.addEventListener('click', () => {
  running = !running;
  startButton.textContent = running ? 'Pause' : 'Resume';
});

// One car per genome; agents[i] is driven by neat.population[i]
function startGeneration(): void {
  sim = new Simulation(track);
  agents = sim.spawn(neat.population.length);
}

function endGeneration(): void {
  agents.forEach((agent, i) => {
    neat.population[i].rawFitness = fitness(agent);
  });
  lastStats = neat.evolve();
  networksDirty = true;
  startGeneration();
}

/** One simulation step: every alive car asks its genome what to do, then the world moves. */
function step(): void {
  agents.forEach((agent, i) => {
    if (!agent.alive) return;
    const [steer, throttle] = neat.population[i].predict(agent.sensors);
    agent.setControls({ steer, throttle });
  });
  sim.step();
  if (sim.allDead || sim.time >= MAX_GENERATION_TIME) endGeneration();
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
  for (const agent of agents) {
    if (!agent.alive) continue;
    if (!best || agent.checkpointsPassed > best.checkpointsPassed) best = agent;
  }
  return best;
}

function updateInfo(focus: Agent | null): void {
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
    while (accumulator >= sim.config.dt && performance.now() - frameStart < FRAME_BUDGET_MS) {
      step();
      stepPlayer();
      accumulator -= sim.config.dt;
    }
    accumulator = Math.min(accumulator, sim.config.dt); // don't build up a backlog when the CPU can't keep up
  }

  const focus = leader();
  renderer.draw(sim, {
    focus,
    showSensors: sensorsSelect.value as 'none' | 'focus' | 'all',
    showCheckpoints: checkpointsToggle.checked,
    player,
  });
  updateInfo(focus);
  updateNetworks();
  requestAnimationFrame(frame);
}

startGeneration();
resetPlayer();
requestAnimationFrame(frame);
