# neat

NEAT (NeuroEvolution of Augmenting Topologies) in TypeScript, with no dependencies.
Copy this folder into a project and import from `index.ts`. It works in the browser, in a Web Worker and in Node.

```ts
import { Neat, Genome } from "./neat/index.ts";
```

## How it works in one paragraph

`Neat` holds a **population** of networks (genomes). Every generation:

1. each genome gets a **score** (`rawFitness`, higher = better);
2. NEAT uses the scores to create the next population: species, selection, crossover, mutations.

The library does step 2. **You do step 1**, in one of two ways:

| Your problem | Mode | Example |
|---|---|---|
| A single function can compute the score of a network, right away | **Direct fitness** | XOR, classifying data, fitting a function |
| The score builds up over time, over many iterations | **Fitness over iterations** | A game, a simulation, a robot, anything with a loop |

---

## Mode 1: direct fitness

You write **one function** that receives a genome and returns its score. NEAT calls it for every genome, every generation.

### Step 1: write the fitness function

```ts
import { Neat, Genome } from "./neat/index.ts";

const cases = [
  { inputs: [0, 0], output: 0 },
  { inputs: [1, 0], output: 1 },
  { inputs: [0, 1], output: 1 },
  { inputs: [1, 1], output: 0 },
];

// Receives a genome, returns its score: higher = better
function fitness(genome: Genome): number {
  let score = 0;
  for (const c of cases) {
    const [out] = genome.predict(c.inputs);      // one value for every output
    score += 1 - Math.abs(c.output - out);       // 1 = right, 0 = completely wrong
  }
  return score / cases.length;                   // 1 = perfect
}
```

### Step 2: create `Neat` with the fitness function

```ts
const neat = new Neat({
  inputs: 2,          // length of the array you pass to predict
  outputs: 1,         // length of the array predict returns
  fitness: fitness,
});
```

### Step 3: run it

Either let it run the whole loop:

```ts
const best = neat.run({
  maxGenerations: 1000,
  targetFitness: 0.99,                           // optional: stop as soon as a genome scores this much
  onGeneration: stats => console.log("Generation " + stats.generation + ": " + stats.best.rawFitness),
});

console.log(best.predict([1, 0]));               // → [0.99...]
```

or run one generation at a time, if you want to control the loop yourself (e.g. one generation per frame, to draw it):

```ts
for (let i = 0; i < 1000; i++) {
  const stats = neat.step();                     // scores every genome with your function, then creates the next generation
  if (stats.best.rawFitness >= 0.99)
    break;
}

const best = neat.best!;
```

---

## Mode 2: fitness over iterations

There's **no fitness function**. You run your own loop (game, simulation…), let the networks act, and **add points** to each genome's `rawFitness` as things happen. When every genome is done, you call `evolve()`.

### The cycle

```
┌─▶ neat.population: every genome starts with rawFitness = 0
│
│   YOUR LOOP (as many iterations as you need)
│     for every genome:
│       action = genome.predict(what it sees)
│       apply the action in your world
│       genome.rawFitness += points earned (or -= points lost)
│
│   every genome finished?
│
└── neat.evolve() → new population, every rawFitness back to 0
```

### Complete example

Each network controls a dot on a line and has to reach a target and stay there. Every frame, it loses points equal to its distance from the target.

```ts
import { Neat } from "./neat/index.ts";

const neat = new Neat({
  inputs: 2,          // [position, target]
  outputs: 1,         // [movement]  (0 = left, 0.5 = stand still, 1 = right)
});

const STEPS = 200;                                       // iterations per generation

for (let generation = 0; generation < 100; generation++) {
  // Every genome gets its own dot
  const positions = neat.population.map(() => 0);
  const target = Math.random() * 10 - 5;

  // YOUR LOOP: all the genomes play at the same time
  for (let step = 0; step < STEPS; step++) {
    neat.population.forEach((genome, i) => {
      const [move] = genome.predict([positions[i], target]);
      positions[i] += (move - 0.5) * 0.5;                // apply the action

      genome.rawFitness -= Math.abs(target - positions[i]);   // points: closer = loses less
    });
  }

  // Every genome has played: create the next generation
  const stats = neat.evolve();
  console.log("Generation " + stats.generation + ": best score " + stats.best.rawFitness.toFixed(1));
}

const best = neat.best!;
```

The same works when the loop is **driven by frames**, e.g. a browser game. Do one iteration per frame, and call `evolve()` when the round ends:

```ts
let step = 0;

function frame() {
  for (const genome of neat.population) {
    // predict, apply the action, add points to genome.rawFitness
  }

  step++;
  if (step == STEPS) {                                   // round over
    neat.evolve();
    resetWorld();                                        // your code: new world for the new population
    step = 0;
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

### Rules for this mode

- **Every genome in `neat.population` must be evaluated** before `evolve()`. A genome you skip keeps `rawFitness = 0` and is judged as if it had scored 0.
- **Give every genome the same conditions**: same world, same number of iterations, same target. Otherwise the scores aren't comparable, and NEAT selects the luckiest genome, not the best one.
- **`evolve()` replaces `neat.population`** with new genomes. Don't keep references to the old ones: read `neat.population` again after every `evolve()`.
- You can evaluate genomes **all at the same time** (like the examples) or **one after the other**. NEAT only looks at `rawFitness` when you call `evolve()`.
- The score **can be negative**. Only the order matters: higher = better.
- If the world is random (e.g. random target), use several rounds per generation and add up the points. One lucky round then matters less.

---

## Using a trained network

```ts
const best = neat.best!;                         // best genome ever found (in both modes)
const outputs = best.predict([0.5, 1]);

const saved = JSON.stringify(best.toJSON());     // save it (file, localStorage, ...)
const loaded = Genome.fromJSON(JSON.parse(saved));
loaded.predict([0.5, 1]);                        // same outputs, no Neat needed
```

To **continue training** from a saved genome, seed a new `Neat` with it (same `inputs` and `outputs`):

```ts
const neat = new Neat({ inputs: 2, outputs: 1 });
neat.seed(loaded, 250);                          // optional: number of the next generation (default 1)
```

The population becomes copies of the genome: one unchanged, the others with mutated weights. Species and `neat.best` start again from zero.

## What `step()`, `evolve()` and `run()` return

`step()` and `evolve()` return the stats of the generation that was just evaluated. `run()` calls `onGeneration` with these stats after every generation.

```ts
{
  generation: number,              // number of the evaluated generation
  best: Genome,                    // best genome of this generation
  bestEver: Genome,                // best genome ever found (same as neat.best)
  species: number,                 // number of species
  compatibilityThreshold: number,  // current species threshold
}
```

## Data for a visualization

`neat.getSnapshot()` returns plain data about the last evolved generation. It can be sent to a page with `postMessage` or saved as JSON:

```ts
{
  generation: number,
  bestEver: GenomeData,                           // { nodes, connections, activation, fitness, rawFitness }
  species: { id, genomes, best: GenomeData }[]    // best genome of every specie
}
```

Node ids: inputs are `0 .. inputs-1`, outputs are `inputs .. inputs+outputs-1`, hidden nodes come after.

## Fitness and rawFitness

- **`rawFitness`** is your score: what your function returns (mode 1) or what you add up (mode 2).
- **`fitness`** is `rawFitness - complexityPenalty × enabled connections`. Selection uses it, so smaller networks win when the score is the same.
- `targetFitness` in `run()` is compared with `rawFitness`.

If your scores are large (e.g. thousands of points), the default penalty of 0.001 per connection has almost no effect. Scale `complexityPenalty` to your scores.

## Options

Every option is optional except `inputs` and `outputs`. The defaults are in `config.ts`.

| Option | Default | Meaning |
|---|---|---|
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
| `championMinSpecieSize` | 5 | The champion is copied unchanged if the specie is bigger than this (the best genome of the whole generation is always copied unchanged) |
| `cloneChance` | 0.25 | Child = copy of a parent (otherwise crossover) |
| `interspeciesCrossoverChance` | 0.001 | Second parent from another specie |
| `disabledGeneChance` | 0.75 | Gene disabled in a parent, disabled in the child |
| `weightMutationChance` | 0.8 | Chance of mutating the weights of a child |
| `weightPerturbChance` / `weightPerturbance` | 0.9 / 0.1 | Slight change (± weightPerturbance) or new random value |
| `addNodeChance` / `deleteNodeChance` | 0.03 / 0.01 | Structural mutations |
| `addConnectionChance` / `deleteConnectionChance` | 0.05 / 0.03 | Structural mutations |
| `addConnectionAttempts` | 20 | Random pairs tried by Add Connection before giving up |

## Limits

- Networks are feedforward only (no cycles), so they have **no memory** between two `predict` calls. If your problem needs to remember the past (e.g. speed), put it in the inputs yourself, e.g. the previous position.
- If you change `genome.nodes` / `genome.connections` by hand, the network is not rebuilt automatically. Use the mutation methods.
