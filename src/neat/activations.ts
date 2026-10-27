// Activation functions, chosen by name so a saved genome remembers which one it uses
export const activations = {
  // Steepened sigmoid (original NEAT): reaches 0 and 1 even with small weights
  sigmoid: (x: number) => 1 / (1 + Math.exp(-4.9 * x)),
  tanh: (x: number) => Math.tanh(x),
  relu: (x: number) => Math.max(0, x),
  identity: (x: number) => x,
};

export type activationName = keyof typeof activations;

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
