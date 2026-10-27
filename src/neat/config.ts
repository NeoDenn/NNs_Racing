import type { activationName } from "./activations.ts";
import type { Genome } from "./genome.ts";

export type NeatConfig = {
  inputs: number;
  outputs: number;

  populationSize: number;
  activation: activationName;
  weightRange: number;                  // Weights and biases go from -weightRange to +weightRange
  complexityPenalty: number;            // Fitness lost for every enabled connection

  maxNodes: number;                     // Max size of a genome (Add Node / Add Connection stop here)
  maxConnections: number;

  // Species
  compatibilityThreshold: number;       // Starting value, then it adapts
  minSpecies: number;                   // Wanted range of species
  maxSpecies: number;
  thresholdStep: number;                // Change of the threshold per generation
  minThreshold: number;                 // Lowest value of the threshold
  maxSpeciesSlots: number;              // Max number of species at the same time
  maxStagnation: number;                // Generations without improvement before a specie stops having children

  // Genetic distance: c1 * E / N + c2 * D / N + c3 * W
  excessCoefficient: number;            // c1
  disjointCoefficient: number;          // c2
  weightCoefficient: number;            // c3
  distanceMinGenes: number;             // N is never lower than this

  // Reproduction
  survivalRate: number;                 // Best part of a specie that can be a parent
  championMinSpecieSize: number;        // The champion is copied unchanged if the specie has more genomes than this
  cloneChance: number;                  // Child = copy of a parent (otherwise crossover)
  interspeciesCrossoverChance: number;  // Second parent from another specie
  disabledGeneChance: number;           // Gene disabled in a parent -> disabled in the child

  // Mutations
  weightMutationChance: number;
  weightPerturbChance: number;          // Slight change (otherwise new random value)
  weightPerturbance: number;            // Value +/-
  addNodeChance: number;
  deleteNodeChance: number;
  addConnectionChance: number;
  deleteConnectionChance: number;
  addConnectionAttempts: number;        // Random pairs tried before giving up
};

// Everything is optional except inputs and outputs.
// fitness: only for the automatic mode (step / run), see README.md
export type NeatOptions = Partial<NeatConfig> & {
  inputs: number;
  outputs: number;
  fitness?: (genome: Genome) => number;
};

export const defaultConfig: Omit<NeatConfig, "inputs" | "outputs"> = {
  populationSize: 100,
  activation: "sigmoid",
  weightRange: 3,
  complexityPenalty: 0.001,

  maxNodes: Infinity,
  maxConnections: Infinity,

  compatibilityThreshold: 3,
  minSpecies: 5,
  maxSpecies: 10,
  thresholdStep: 0.2,
  minThreshold: 0.3,
  maxSpeciesSlots: 100,
  maxStagnation: 15,

  excessCoefficient: 1,
  disjointCoefficient: 1,
  weightCoefficient: 0.4,
  distanceMinGenes: 20,

  survivalRate: 0.2,
  championMinSpecieSize: 5,
  cloneChance: 0.25,
  interspeciesCrossoverChance: 0.001,
  disabledGeneChance: 0.75,

  weightMutationChance: 0.8,
  weightPerturbChance: 0.9,
  weightPerturbance: 0.1,
  addNodeChance: 0.03,
  deleteNodeChance: 0.01,
  addConnectionChance: 0.05,
  deleteConnectionChance: 0.03,
  addConnectionAttempts: 20,
};
