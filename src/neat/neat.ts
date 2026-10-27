import { Genome } from "./genome.ts";
import type { GenomeData } from "./genome.ts";
import { defaultConfig } from "./config.ts";
import type { NeatConfig, NeatOptions } from "./config.ts";
import { randomRange } from "./activations.ts";

type specie = {
  genomes: Genome[];
  leaderGenome: Genome;

  childrenInNextGen: number;
  generationCreated: number;
  noImprovementGenerations: number;

  bestFitness: number;
  avgFitness: number;

  killSwitch: boolean;
}

// Result of a generation
export type GenerationStats = {
  generation: number;
  best: Genome;                 // Best genome of this generation
  bestEver: Genome;             // Best genome ever found
  species: number;
  compatibilityThreshold: number;
};

// Data for the visualization: plain data only, it can be sent to a worker / the page
export type SpecieSnapshot = {
  id: number;
  genomes: number;              // Number of genomes in the specie
  best: GenomeData;
};

export type Snapshot = {
  generation: number;
  bestEver: GenomeData;
  species: SpecieSnapshot[];
};

export type RunOptions = {
  maxGenerations: number;
  targetFitness?: number;                           // Stop when the best rawFitness reaches this
  onGeneration?: (stats: GenerationStats) => void;
};

export class Neat {
  readonly config: NeatConfig;
  private fitnessFunction: ((genome: Genome) => number) | undefined;

  // Genomes of the current generation (in manual mode set their rawFitness, then call evolve)
  population: Genome[] = new Array(0);
  generation = 1;
  best: Genome | undefined = undefined;               // Best genome ever found

  // Public: read and updated by the Genome mutations
  connectionIds = new Map<string, number>();          // "nodeInID->nodeOutID" -> id della connessione
  splitNodes = new Map<number, number>();             // id della connessione spezzata -> id del nuovo nodo
  nextConnectionID = 0;
  nextNodeID = 0;

  private speciesPool = new Map<number, specie>();
  private compatibilityThreshold: number;
  private snapshot: Snapshot | undefined = undefined;

  constructor(options: NeatOptions) {
    const { fitness, ...config } = options;
    this.config = { ...defaultConfig, ...config };
    this.fitnessFunction = fitness;
    this.compatibilityThreshold = this.config.compatibilityThreshold;

    // Ids after the inputs and the outputs
    this.nextNodeID = this.config.inputs + this.config.outputs;

    // Generate starting Genome Pool
    for (let i = 0; i < this.config.populationSize; i++)
      this.population.push(Genome.createMinimal(this));
  }

  // Id of the connection "nodeInID -> nodeOutID": same connection = same id in every genome
  getConnectionId(nodeInID: number, nodeOutID: number): number {
    const key = nodeInID + "->" + nodeOutID;
    let id = this.connectionIds.get(key);

    if (id === undefined) {
      id = this.nextConnectionID;
      this.connectionIds.set(key, id);
      this.nextConnectionID++;
    }

    return id;
  }

  // Automatic mode: evaluates every genome with the fitness function, then creates the next generation
  step(): GenerationStats {
    if (this.fitnessFunction === undefined)
      throw new Error("step: no fitness function, pass one to the constructor or set rawFitness by hand and call evolve()");

    for (const genome of this.population)
      genome.rawFitness = this.fitnessFunction(genome);

    return this.evolve();
  }

  // Automatic mode: runs generations until the target or the max number of generations, returns the best genome
  run(options: RunOptions): Genome {
    for (let i = 0; i < options.maxGenerations; i++) {
      const stats = this.step();
      options.onGeneration?.(stats);

      // Solution found
      if (options.targetFitness !== undefined && stats.best.rawFitness >= options.targetFitness)
        break;
    }

    return this.best!;
  }

  // Manual mode: the rawFitness of every genome in population must already be set.
  // Creates the next generation (population is replaced, every rawFitness starts again from 0)
  evolve(): GenerationStats {
    // 1 Fitness with the complexity penalty: smaller networks with the same rawFitness are better
    for (const genome of this.population) {
      let enabledConnections = 0;
      for (const connection of genome.connections.values()) {
        if (connection.enabled)
          enabledConnections++;
      }

      genome.fitness = genome.rawFitness - (this.config.complexityPenalty * enabledConnections);
    }

    // Best genome of this generation (copy, the population gets replaced)
    let bestOfGeneration = this.population[0];
    for (const genome of this.population) {
      if (genome.fitness > bestOfGeneration.fitness)
        bestOfGeneration = genome;
    }
    if (this.best === undefined || bestOfGeneration.fitness > this.best.fitness)
      this.best = bestOfGeneration.clone();

    // 2 Divide Species
    this.divideSpecies();

    this.snapshot = this.createSnapshot();
    const stats: GenerationStats = {
      generation: this.generation,
      best: bestOfGeneration.clone(),
      bestEver: this.best,
      species: this.speciesPool.size,
      compatibilityThreshold: this.compatibilityThreshold,
    };

    // 3 Calculate number of children per Specie AND best and avg fitness of the specie
    this.calculateChildrenAndFitnessData();

    // 4 e 5 Children creation and specie death
    this.population = this.selectAndMutateChildren();
    for (const genome of this.population) {
      genome.rawFitness = 0;
      genome.fitness = 0;
    }

    this.generation++;
    return stats;
  }

  // Best genome ever and best genome of every specie, from the last evolved generation
  getSnapshot(): Snapshot | undefined {
    return this.snapshot;
  }

  private createSnapshot(): Snapshot {
    let species: SpecieSnapshot[] = new Array(0);
    for (const [id, specie] of this.speciesPool) {
      let bestOfSpecie = specie.genomes[0];
      for (const genome of specie.genomes) {
        if (genome.fitness > bestOfSpecie.fitness)
          bestOfSpecie = genome;
      }

      species.push({ id: id, genomes: specie.genomes.length, best: bestOfSpecie.toJSON() });
    }

    return { generation: this.generation, bestEver: this.best!.toJSON(), species: species };
  }

  private selectAndMutateChildren(): Genome[] {
    let newPopulation: Genome[] = new Array(0);

    for(const [id, specie] of this.speciesPool) {
      // 4.1 Selezione
      let childrenLeftToMake = specie.childrenInNextGen;
      let nOfGenomes = specie.genomes.length;

      // Kill specie if there aren't any children to make or the specie has no genomes
      if (childrenLeftToMake <= 0 || nOfGenomes <= 0) {
        specie.killSwitch = true;
        continue;
      }

      // Sort from best to worst
      specie.genomes.sort((a, b) => b.fitness - a.fitness);

      // Copy 1 champion if the specie is big enough
      if(nOfGenomes > this.config.championMinSpecieSize) {
        newPopulation.push(specie.genomes[0].clone());
        childrenLeftToMake--;
      }

      // Filter the best part for children generation (with a minimum of 2)
      let minimumNOfParents = Math.min(nOfGenomes, 2);
      let nOfParents = Math.max(Math.ceil(nOfGenomes * this.config.survivalRate), minimumNOfParents);
      let parents: Genome[] = specie.genomes.slice(0, nOfParents);

      // 4.2 Riproduzione
      while(childrenLeftToMake > 0) {
        childrenLeftToMake--;

        let child: Genome;

        // Copia di un genitore
        if(randomRange(0, 1) < this.config.cloneChance) {
          child = parents[Math.floor(Math.random() * parents.length)].clone();
        }

        // Crossover tra due genitori (a volte secondo genitore di un'altra specie)
        else {
          // Far crossover
          if(randomRange(0, 1) < this.config.interspeciesCrossoverChance) {
            let tempParents: Genome[] = new Array(0);
            // Get parent from all different species
            for (const [tempId, tempSpecie] of this.speciesPool) {
              if(id != tempId) {
                tempParents.push(...tempSpecie.genomes);
              }
            }

            // Do the crossover
            child = Genome.crossover(parents[Math.floor(Math.random() * parents.length)], tempParents[Math.floor(Math.random() * tempParents.length)], this);
          }

          // Near Crossover
          else {
            if(nOfParents == 1)
              child = parents[Math.floor(Math.random() * parents.length)].clone();
            else
              child = Genome.crossover(parents[Math.floor(Math.random() * parents.length)], parents[Math.floor(Math.random() * parents.length)], this);
          }
        }

        // 5 Mutate the Child
        // Weights and Biases
        if(randomRange(0, 1) < this.config.weightMutationChance)
          child.mutateWeights(this);

        // Add Node
        if(randomRange(0, 1) < this.config.addNodeChance)
          child.mutateAddNode(this);

        // Delete Node
        if(randomRange(0, 1) < this.config.deleteNodeChance)
          child.mutateDeleteNode(this);

        // Add Connection
        if(randomRange(0, 1) < this.config.addConnectionChance)
          child.mutateAddConnection(this);

        // Delete Connection
        if(randomRange(0, 1) < this.config.deleteConnectionChance)
          child.mutateDeleteConnection();

        // Add Children to pool
        newPopulation.push(child);
      }
    }

    // Erase species without children
    for(const [id, specie] of this.speciesPool) {
      if(specie.killSwitch)
        this.speciesPool.delete(id);
    }

    return newPopulation;
  }

  private calculateChildrenAndFitnessData(): void {
    let numberOfSpieces = this.speciesPool.size;

    if(numberOfSpieces == 0)
      return;

    // Calculate best and avg fintesses
    let bestSpecieID = -1;
    let bestSpecieFitness = -Infinity;
    for(const [id, specie] of this.speciesPool) {
      let sum = 0;
      let max = -Infinity;

      for(const genome of specie.genomes){
        sum += genome.fitness;

        if(genome.fitness > max)
          max = genome.fitness;
      }

      specie.avgFitness = (sum / specie.genomes.length);

      // Stagnation (bestFitness = best fitness ever reached by the specie)
      if(max > specie.bestFitness) {
        specie.bestFitness = max;
        specie.noImprovementGenerations = 0;
      }
      else
        specie.noImprovementGenerations++;

      // Specie with the best genome of this generation
      if(max > bestSpecieFitness) {
        bestSpecieFitness = max;
        bestSpecieID = id;
      }
    }

    // Species allowed to have children (stagnant species get 0, the best specie is always kept)
    let eligibleSpecies: specie[] = new Array(0);
    for(const [id, specie] of this.speciesPool) {
      if(specie.noImprovementGenerations >= this.config.maxStagnation && id != bestSpecieID) {
        specie.childrenInNextGen = 0;
        continue;
      }

      eligibleSpecies.push(specie);
    }

    // Shares of children proportional to the average fitness.
    // Fitness can be 0 or negative (e.g. games): shift so the worst specie is just above 0
    const lowestAvg = Math.min(...eligibleSpecies.map(x => x.avgFitness));
    const shift = (lowestAvg <= 0) ? -lowestAvg + 1e-6 : 0;
    let sumOfAvgFitnesses = 0;
    for (const specie of eligibleSpecies)
      sumOfAvgFitnesses += specie.avgFitness + shift;

    // Divide between the max n. of genomes
    let sumOfCalculatedChildren = 0;
    for(const specie of eligibleSpecies) {
      // If only 1 specie, then full pool of children
      if (eligibleSpecies.length == 1)
        specie.childrenInNextGen = this.config.populationSize;

      // If more, n is proportional to it's average fitness
      else {
        let percOfChildren = ((specie.avgFitness + shift) / sumOfAvgFitnesses);
        specie.childrenInNextGen = Math.floor(this.config.populationSize * percOfChildren);
        sumOfCalculatedChildren += specie.childrenInNextGen;
      }
    }

    if(eligibleSpecies.length == 1)
      return;

    // If the total is less than the n. of genomes, we add to the lowest until it's full
    let freeSpots = this.config.populationSize - sumOfCalculatedChildren;
    while (freeSpots > 0) {
      let minimumSpecie = eligibleSpecies[0];

      for (const specie of eligibleSpecies) {
        if (specie.childrenInNextGen < minimumSpecie.childrenInNextGen)
          minimumSpecie = specie;
      }

      minimumSpecie.childrenInNextGen++;
      freeSpots--;
    }
  }

  private newSpecie(leader: Genome): specie {
    return {
      genomes: [leader],
      leaderGenome: leader,

      childrenInNextGen: 0,
      generationCreated: this.generation,
      noImprovementGenerations: 0,

      bestFitness: -Infinity,
      avgFitness: 0,
      killSwitch: false
    };
  }

  private divideSpecies(): void {
    // Empty the species from the previous generation (random old genome as new leader)
    for (const specie of this.speciesPool.values()) {
      if (specie.genomes.length > 0)
        specie.leaderGenome = specie.genomes[Math.floor(Math.random() * specie.genomes.length)];

      specie.genomes = new Array(0);
    }

    for (const genome of this.population) {
      // If there are no species -> create the first specie
      if(this.speciesPool.size == 0) {
        this.speciesPool.set(0, this.newSpecie(genome));
        continue;
      }

      // If there are already species in the pool
      let hasFoundSpecie = false;
      let nearestSpecie: specie | undefined = undefined;
      let nearestDistance = Infinity;

      // Cycle all species
      for(const specie of this.speciesPool.values()) {
        let geneticDistance = specie.leaderGenome.geneticDistance(genome, this);

        // Compatible -> Add that genome to the specie
        if (geneticDistance < this.compatibilityThreshold) {
          specie.genomes.push(genome);
          hasFoundSpecie = true;
          break;
        }

        // NOT Compatible -> remember the nearest specie and keep cycling species
        if (geneticDistance < nearestDistance) {
          nearestDistance = geneticDistance;
          nearestSpecie = specie;
        }
      }

      // If it didn't find a specie, it creates its own
      if (!hasFoundSpecie) {
        for(let j = 0; j < this.config.maxSpeciesSlots; j++){
          if (!this.speciesPool.has(j)) {
            this.speciesPool.set(j, this.newSpecie(genome));
            hasFoundSpecie = true;
            break;
          }
        }

        // No free slot for a new specie -> add it to the nearest specie
        if (!hasFoundSpecie)
          nearestSpecie!.genomes.push(genome);
      }
    }

    // Erase species that didn't get any genome
    for (const [id, specie] of this.speciesPool) {
      if (specie.genomes.length == 0)
        this.speciesPool.delete(id);
    }

    // Adaptive threshold (used from the next generation)
    if (this.speciesPool.size < this.config.minSpecies)
      this.compatibilityThreshold = Math.max(this.config.minThreshold, this.compatibilityThreshold - this.config.thresholdStep);
    else if (this.speciesPool.size > this.config.maxSpecies)
      this.compatibilityThreshold += this.config.thresholdStep;
  }
}
