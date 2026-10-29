// Training shared by the page (main.ts) and the terminal (scripts/train.ts): NEAT drives one car per genome.
// No DOM here, so it runs in the browser and in Node.

import { type Agent, Simulation, inputCount } from './environment/simulation.ts';
import { type Track, buildTrack } from './environment/track.ts';
import { TRACKS } from './environment/tracks.ts';
import { type GenerationStats, type GenomeData, Genome, Neat } from './neat/index.ts';

// ---- Parameters ----
export const DEFAULT_TRACK = 'Maze'; // 'Oval', 'Twisty', 'Maze'
const POPULATION = 100; // cars per generation
export const MAX_GENERATION_TIME = 30; // simulated seconds before a generation is ended (good cars could lap forever)

// Score of one car at the end of its generation: higher = better.
// One point per checkpoint, so a car that gets further (or laps faster in the time limit) wins.
function fitness(agent: Agent): number {
  return agent.checkpointsPassed;
}

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

function createNeat(): Neat {
  return new Neat({
    inputs: inputCount(), // rays + speed + acceleration + drift
    outputs: 2, // steer, throttle
    activation: 'tanh', // outputs in -1..1
    populationSize: POPULATION,
    complexityPenalty: 0,
    weightRange: 10,
    maxStagnation: 30,
    addNodeChance: 0.1,
    deleteNodeChance: 0.02,
    addConnectionChance: 0.15,
    deleteConnectionChance: 0.75,
    minSpecies: 20,
    maxSpecies: 30,
  });
}

/** Content of the save file (saves/best-genome.json), written after every generation. */
export interface SaveFile {
  generation: number; // last generation completed
  track: string; // track it was trained on
  genome: GenomeData; // best genome of that generation
  savedAt: string;
}

export function findTrack(name: string): Track {
  const def = TRACKS.find((t) => t.name === name);
  if (!def) throw new Error(`No track named "${name}". Available: ${TRACKS.map((t) => t.name).join(', ')}`);
  return buildTrack(def);
}

export class Trainer {
  readonly neat = createNeat();
  track: Track;
  sim!: Simulation;
  agents: Agent[] = []; // agents[i] is driven by neat.population[i]
  lastStats: GenerationStats | null = null;

  /** With a save, the population starts from its genome and the generation count continues from it. */
  constructor(track: Track, save?: SaveFile) {
    this.track = track;
    if (save) this.neat.seed(Genome.fromJSON(save.genome), save.generation + 1);
    this.startGeneration();
  }

  /** Keeps the trained population and restarts the current generation on the new track. */
  setTrack(track: Track): void {
    this.track = track;
    this.startGeneration();
  }

  /** One simulation step: every alive car asks its genome what to do, then the world moves.
   *  Returns the stats when the step ended a generation. */
  step(): GenerationStats | null {
    this.agents.forEach((agent, i) => {
      if (!agent.alive) return;
      const [steer, throttle] = this.neat.population[i].predict(agent.sensors);
      agent.setControls({ steer, throttle });
    });
    this.sim.step();
    if (this.sim.allDead || this.sim.time >= MAX_GENERATION_TIME) return this.endGeneration();
    return null;
  }

  // The best genome of the last generation, not the best ever: it is kept unchanged in the next generation anyway,
  // and after a track change it is the best on the current track
  toSave(): SaveFile | null {
    if (!this.lastStats) return null;
    return {
      generation: this.lastStats.generation,
      track: this.track.name,
      genome: this.lastStats.best.toJSON(),
      savedAt: new Date().toISOString(),
    };
  }

  private startGeneration(): void {
    this.sim = new Simulation(this.track);
    this.agents = this.sim.spawn(this.neat.population.length);
  }

  private endGeneration(): GenerationStats {
    this.agents.forEach((agent, i) => {
      this.neat.population[i].rawFitness = fitness(agent);
    });
    this.lastStats = this.neat.evolve();
    this.startGeneration();
    return this.lastStats;
  }
}
