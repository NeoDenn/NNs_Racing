// Draws the best network of the best species with Cytoscape, the overall best one highlighted.

import cytoscape from 'cytoscape';
import type { GenomeData, Snapshot } from './neat/index.ts';

const SPECIES_SHOWN = 3;

const COLORS = {
  input: '#4ea1ff',
  hidden: '#9aa0aa',
  output: '#ff9f1c',
  label: '#b8bcc4',
  positive: '#4ade80',
  negative: '#f87171',
};

export class NetworkView {
  private readonly container: HTMLElement;
  private readonly inputLabels: string[];
  private readonly outputLabels: string[];
  private graphs: cytoscape.Core[] = [];

  constructor(container: HTMLElement, inputLabels: string[], outputLabels: string[]) {
    this.container = container;
    this.inputLabels = inputLabels;
    this.outputLabels = outputLabels;
    this.clear();

    window.addEventListener('resize', () => {
      for (const cy of this.graphs) {
        cy.resize();
        cy.fit(undefined, 12);
      }
    });
  }

  /** Removes the graphs, until the next show. */
  clear(): void {
    for (const cy of this.graphs) cy.destroy();
    this.graphs = [];
    this.container.innerHTML = '<p class="net-empty">The best network of each specie appears after the first generation</p>';
  }

  show(snapshot: Snapshot): void {
    for (const cy of this.graphs) cy.destroy();
    this.graphs = [];
    this.container.innerHTML = '';

    // Only the best species, best first
    const species = [...snapshot.species].sort((a, b) => b.best.fitness - a.best.fitness).slice(0, SPECIES_SHOWN);

    // Create every panel first, so each graph is drawn at its final (shared) width
    const graphContainers = species.map((specie, i) => {
      const panel = document.createElement('div');
      panel.className = i === 0 ? 'net-panel best' : 'net-panel';

      const title = document.createElement('div');
      title.className = 'net-title';
      title.textContent = `${i === 0 ? '★ ' : ''}Specie ${specie.id} · ${specie.genomes} genomes · fitness ${specie.best.rawFitness.toFixed(1)}`;

      const graph = document.createElement('div');
      graph.className = 'net-graph';

      panel.append(title, graph);
      this.container.append(panel);
      return graph;
    });
    this.graphs = species.map((specie, i) => this.drawGraph(graphContainers[i], specie.best));
  }

  private drawGraph(container: HTMLElement, genome: GenomeData): cytoscape.Core {
    const positions = layoutNodes(genome);
    const inputs = genome.nodes.filter((n) => n.type === 'input').sort((a, b) => a.id - b.id);
    const outputs = genome.nodes.filter((n) => n.type === 'output').sort((a, b) => a.id - b.id);
    const labelOf = new Map<number, string>([
      ...inputs.map((n, i): [number, string] => [n.id, this.inputLabels[i] ?? `in ${i}`]),
      ...outputs.map((n, i): [number, string] => [n.id, this.outputLabels[i] ?? `out ${i}`]),
    ]);
    const maxWeight = Math.max(1, ...genome.connections.map((c) => Math.abs(c.weight)));

    const elements: cytoscape.ElementDefinition[] = [
      ...genome.nodes.map((n) => ({
        group: 'nodes' as const,
        data: { id: String(n.id), label: labelOf.get(n.id) ?? '', type: n.type },
        position: positions.get(n.id)!,
      })),
      ...genome.connections
        .filter((c) => c.enabled)
        .map((c) => ({
          group: 'edges' as const,
          data: {
            id: `c${c.id}`,
            source: String(c.nodeInID),
            target: String(c.nodeOutID),
            color: c.weight >= 0 ? COLORS.positive : COLORS.negative,
            width: 0.5 + (Math.abs(c.weight) / maxWeight) * 3,
            opacity: 0.35 + (Math.abs(c.weight) / maxWeight) * 0.65,
          },
        })),
    ];

    const cy = cytoscape({
      container,
      elements,
      layout: { name: 'preset' },
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: [
        {
          selector: 'node',
          style: {
            width: 9,
            height: 9,
            'background-color': COLORS.hidden,
            label: 'data(label)',
            'font-size': 8,
            color: COLORS.label,
            'text-valign': 'center',
          },
        },
        { selector: 'node[type = "input"]', style: { 'background-color': COLORS.input, 'text-halign': 'left', 'text-margin-x': -3 } },
        { selector: 'node[type = "output"]', style: { 'background-color': COLORS.output, 'text-halign': 'right', 'text-margin-x': 3 } },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': 'data(color)',
            opacity: 'data(opacity)' as unknown as number,
            'curve-style': 'straight',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': 'data(color)',
            'arrow-scale': 0.4,
          },
        },
      ],
    });
    cy.fit(undefined, 12);
    return cy;
  }
}

/** Inputs in the left column, outputs in the right one, hidden nodes in between by how deep they are. */
function layoutNodes(genome: GenomeData): Map<number, { x: number; y: number }> {
  const incoming = new Map<number, number[]>();
  for (const c of genome.connections) {
    if (!c.enabled) continue;
    incoming.set(c.nodeOutID, [...(incoming.get(c.nodeOutID) ?? []), c.nodeInID]);
  }

  // Depth = longest path from an input (the networks are feedforward, so this always ends)
  const depth = new Map<number, number>();
  const typeOf = new Map(genome.nodes.map((n) => [n.id, n.type]));
  const depthOf = (id: number): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const d = typeOf.get(id) === 'input' ? 0 : 1 + Math.max(0, ...(incoming.get(id) ?? []).map(depthOf));
    depth.set(id, d);
    return d;
  };
  for (const n of genome.nodes) depthOf(n.id);

  const hiddenDepths = genome.nodes.filter((n) => n.type === 'hidden').map((n) => depth.get(n.id)!);
  const outputColumn = Math.max(1, ...hiddenDepths.map((d) => d + 1));

  const columns = new Map<number, number[]>();
  for (const n of [...genome.nodes].sort((a, b) => a.id - b.id)) {
    const column = n.type === 'input' ? 0 : n.type === 'output' ? outputColumn : depth.get(n.id)!;
    columns.set(column, [...(columns.get(column) ?? []), n.id]);
  }

  const positions = new Map<number, { x: number; y: number }>();
  const rowGap = 14;
  const tallest = Math.max(...[...columns.values()].map((ids) => ids.length));
  const columnGap = Math.max(60, (tallest * rowGap) / outputColumn);
  for (const [column, ids] of columns) {
    ids.forEach((id, i) => {
      positions.set(id, { x: column * columnGap, y: (i - (ids.length - 1) / 2) * rowGap });
    });
  }
  return positions;
}
