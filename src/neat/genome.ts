import type { Neat } from "./neat.ts";
import { activations, randomRange } from "./activations.ts";
import type { activationName } from "./activations.ts";

export type nodeType = "input" | "hidden" | "output";

export type node = {          // Geni
  id: number;
  type: nodeType;
  bias: number;
  value: number;
};

export type connection = {    // Connessione tra due geni
  id: number;
  nodeInID: number;
  nodeOutID: number;
  weight: number;
  enabled: boolean;
};

// Plain data of a genome: used to save / load it and to visualize it (it can be sent to a worker or saved as JSON)
export type GenomeData = {
  nodes: node[];
  connections: connection[];
  activation: activationName;
  fitness: number;
  rawFitness: number;
};

// Network ready to be evaluated (built from the genome, rebuilt when the structure changes)
type compiledNetwork = {
  inputIds: number[];
  outputIds: number[];
  order: { node: node; incoming: connection[] }[];   // Non-input nodes, each after all the nodes coming into it
};

export class Genome {         // Grafo completo
  nodes: Map<number, node>;
  connections: Map<number, connection>;
  activation: activationName;
  fitness: number;              // rawFitness - complexity penalty (used for selection)
  rawFitness: number;           // Score given by the problem (set by the fitness function or by hand)

  private compiled: compiledNetwork | undefined = undefined;

  constructor(nodes = new Map<number, node>(), connections = new Map<number, connection>(), activation: activationName = "sigmoid", fitness = 0, rawFitness = 0) {
    this.nodes = nodes;
    this.connections = connections;
    this.activation = activation;
    this.fitness = fitness;
    this.rawFitness = rawFitness;
  }

  // Starting genome: every input connected to every output, no hidden nodes
  static createMinimal(neat: Neat): Genome {
    const { inputs, outputs, weightRange, activation } = neat.config;
    let nodes = new Map<number, node>();
    let connections = new Map<number, connection>();

    // Inputs: ids 0 .. inputs - 1
    for (let i = 0; i < inputs; i++)
      nodes.set(i, { id: i, type: "input", bias: 0, value: 0 });

    // Outputs: ids inputs .. inputs + outputs - 1
    for (let o = inputs; o < inputs + outputs; o++) {
      nodes.set(o, { id: o, type: "output", bias: randomRange(-weightRange, weightRange), value: 0 });

      for (let i = 0; i < inputs; i++) {
        const id = neat.getConnectionId(i, o);
        connections.set(id, { id: id, nodeInID: i, nodeOutID: o, weight: randomRange(-weightRange, weightRange), enabled: true });
      }
    }

    return new Genome(nodes, connections, activation);
  }

  // Runs the network: one value for every input (in order of id), returns one value for every output (in order of id)
  predict(inputs: number[]): number[] {
    if (this.compiled === undefined)
      this.compiled = this.compile();

    const { inputIds, outputIds, order } = this.compiled;
    if (inputs.length != inputIds.length)
      throw new Error("predict: expected " + inputIds.length + " inputs, got " + inputs.length);

    for (let i = 0; i < inputIds.length; i++)
      this.nodes.get(inputIds[i])!.value = inputs[i];

    const activation = activations[this.activation];
    for (const { node, incoming } of order) {
      let sum = node.bias;
      for (const connection of incoming)
        sum += this.nodes.get(connection.nodeInID)!.value * connection.weight;

      node.value = activation(sum);
    }

    return outputIds.map(id => this.nodes.get(id)!.value);
  }

  // Topological order of the nodes (enabled connections only, the network has no cycles)
  private compile(): compiledNetwork {
    const inputIds = [...this.nodes.values()].filter(x => x.type == "input").map(x => x.id).sort((a, b) => a - b);
    const outputIds = [...this.nodes.values()].filter(x => x.type == "output").map(x => x.id).sort((a, b) => a - b);

    let incoming = new Map<number, connection[]>();
    let outgoing = new Map<number, connection[]>();
    let missingInputs = new Map<number, number>();
    for (const id of this.nodes.keys()) {
      incoming.set(id, []);
      outgoing.set(id, []);
      missingInputs.set(id, 0);
    }

    for (const connection of this.connections.values()) {
      if (!connection.enabled || !this.nodes.has(connection.nodeInID) || !this.nodes.has(connection.nodeOutID))
        continue;

      incoming.get(connection.nodeOutID)!.push(connection);
      outgoing.get(connection.nodeInID)!.push(connection);
      missingInputs.set(connection.nodeOutID, missingInputs.get(connection.nodeOutID)! + 1);
    }

    // Nodes whose inputs are all computed
    let ready = [...this.nodes.keys()].filter(id => missingInputs.get(id) == 0);
    let order: compiledNetwork["order"] = [];

    while (ready.length > 0) {
      const id = ready.pop()!;
      const n = this.nodes.get(id)!;

      if (n.type != "input")
        order.push({ node: n, incoming: incoming.get(id)! });

      for (const connection of outgoing.get(id)!) {
        const left = missingInputs.get(connection.nodeOutID)! - 1;
        missingInputs.set(connection.nodeOutID, left);
        if (left == 0)
          ready.push(connection.nodeOutID);
      }
    }

    return { inputIds, outputIds, order };
  }

  // The structure changed: the network has to be built again before the next predict
  private structureChanged(): void {
    this.compiled = undefined;
  }

  toJSON(): GenomeData {
    return {
      nodes: [...this.nodes.values()].map(x => ({ ...x })),
      connections: [...this.connections.values()].map(x => ({ ...x })),
      activation: this.activation,
      fitness: this.fitness,
      rawFitness: this.rawFitness,
    };
  }

  static fromJSON(data: GenomeData): Genome {
    return new Genome(
      new Map(data.nodes.map(x => [x.id, { ...x }])),
      new Map(data.connections.map(x => [x.id, { ...x }])),
      data.activation,
      data.fitness,
      data.rawFitness
    );
  }

  clone(): Genome {
    let newNodes = new Map<number, node>();
    for (const [id, node] of this.nodes)
      newNodes.set(id, { ...node });

    let newConnections = new Map<number, connection>();
    for (const [id, connection] of this.connections)
      newConnections.set(id, { ...connection });

    return new Genome(newNodes, newConnections, this.activation, this.fitness, this.rawFitness);
  }

  static crossover(parent1: Genome, parent2: Genome | undefined, neat: Neat): Genome {
    // No second parent (e.g. only 1 specie in the far crossover) -> copy of the first parent
    if (parent2 === undefined)
      return parent1.clone();

    // 1 Dominant parent (higher fitness, random if equal)
    let dominant: Genome;
    let secondary: Genome;
    if (parent1.fitness > parent2.fitness || (parent1.fitness == parent2.fitness && Math.random() < 0.5)) {
      dominant = parent1;
      secondary = parent2;
    }
    else {
      dominant = parent2;
      secondary = parent1;
    }

    // 2 Connections (structure from the dominant parent)
    let newConnections = new Map<number, connection>();
    for (const [id, dominantConnection] of dominant.connections) {
      const secondaryConnection = secondary.connections.get(id);

      // Only the dominant parent has it
      if (secondaryConnection === undefined) {
        newConnections.set(id, { ...dominantConnection });
        continue;
      }

      // Matching gene -> random parent
      let newConnection: connection = (Math.random() < 0.5) ? { ...dominantConnection } : { ...secondaryConnection };

      // Disabled in at least one parent -> disabledGeneChance of being disabled
      if (!dominantConnection.enabled || !secondaryConnection.enabled)
        newConnection.enabled = (Math.random() >= neat.config.disabledGeneChance);
      else
        newConnection.enabled = true;

      newConnections.set(id, newConnection);
    }

    // 3 Nodes (structure from the dominant parent)
    let newNodes = new Map<number, node>();
    for (const [id, dominantNode] of dominant.nodes) {
      const secondaryNode = secondary.nodes.get(id);

      // Only the dominant parent has it
      if (secondaryNode === undefined) {
        newNodes.set(id, { ...dominantNode });
        continue;
      }

      // Matching gene -> bias from a random parent
      newNodes.set(id, { ...dominantNode, bias: (Math.random() < 0.5) ? dominantNode.bias : secondaryNode.bias });
    }

    // 4 Child
    return new Genome(newNodes, newConnections, dominant.activation);
  }

  mutateWeights(neat: Neat): void {
    const { weightRange, weightPerturbChance, weightPerturbance } = neat.config;

    // Change all Weights
    for (const connection of this.connections.values()) {
      if (randomRange(0, 1) < weightPerturbChance) {
        let min = Math.max(-weightRange, connection.weight - weightPerturbance);
        let max = Math.min(weightRange, connection.weight + weightPerturbance);
        connection.weight = randomRange(min, max);
      }
      else {
        connection.weight = randomRange(-weightRange, weightRange);
      }
    }

    // Change all Biases
    for (const node of this.nodes.values()) {
      if(node.type == "input")
        continue;

      if (randomRange(0, 1) < weightPerturbChance) {
        let min = Math.max(-weightRange, node.bias - weightPerturbance);
        let max = Math.min(weightRange, node.bias + weightPerturbance);
        node.bias = randomRange(min, max);
      }
      else {
        node.bias = randomRange(-weightRange, weightRange);
      }
    }
  }

  mutateAddNode(neat: Neat): void {
    // 0 Max size reached (1 new node and 2 new connections)
    if (this.nodes.size + 1 > neat.config.maxNodes || this.connections.size + 2 > neat.config.maxConnections)
      return;

    // 1 Get a random connection
    const entries = [...this.connections.entries()].filter(x => x[1].enabled);
    if (entries.length === 0)
      return;
    const randomConnectionId = entries[Math.floor(Math.random() * entries.length)][0];

    this.structureChanged();

    // 2 Disable connection in the genome
    let connectionSelected = this.connections.get(randomConnectionId)!;
    connectionSelected.enabled = false;

    // 3 Check if a node got created by splitting that connection
    const tempNode = neat.splitNodes.get(randomConnectionId);
    let newNodeId: number;
    if(tempNode !== undefined)
      newNodeId = tempNode;
    else {
      newNodeId = neat.nextNodeID;
      neat.nextNodeID++;
      neat.splitNodes.set(randomConnectionId, newNodeId);
    }

    // 4 Check if the node exists
    // It exists
    if(this.nodes.has(newNodeId)) {
      newNodeId = neat.nextNodeID;
      neat.nextNodeID++;
    }

    // 5 Create node
    this.nodes.set(newNodeId, {
      id: newNodeId,
      type: "hidden",
      bias: 0,
      value: 0
    });

    // 6 Connessione partenza -> nuovo nodo
    const startNodeId = connectionSelected.nodeInID;
    const endNodeId = connectionSelected.nodeOutID;
    let idToUse = neat.getConnectionId(startNodeId, newNodeId);

    this.connections.set(idToUse, {
      id: idToUse,
      nodeInID: startNodeId,
      nodeOutID: newNodeId,
      weight: 1,
      enabled: true
    });

    // 7 nuovo nodo -> nodo out
    idToUse = neat.getConnectionId(newNodeId, endNodeId);

    this.connections.set(idToUse, {
      id: idToUse,
      nodeInID: newNodeId,
      nodeOutID: endNodeId,
      weight: connectionSelected.weight,
      enabled: true
    });
  }

  mutateDeleteNode(neat: Neat): void {
    // Hidden nodes
    let availableNodes = [...this.nodes.values()].filter(x => x.type == "hidden");

    if(availableNodes.length == 0)
      return;

    this.structureChanged();

    // Random node
    let tempNode = availableNodes[Math.floor(Math.random() * availableNodes.length)];

    // Remove all connections attached to that node
    for (const [id, connection] of this.connections) {
      if(connection.nodeInID == tempNode.id || connection.nodeOutID == tempNode.id)
        this.connections.delete(id);
    }

    // Remove node
    this.nodes.delete(tempNode.id);

    // Reactivate connection disabled on node creation
    for (const [connectionId, nodeId] of neat.splitNodes) {
      if(this.connections.has(connectionId) && nodeId == tempNode.id)
        this.connections.get(connectionId)!.enabled = true;
    }
  }

  mutateAddConnection(neat: Neat): void {
    // Max size reached
    if (this.connections.size + 1 > neat.config.maxConnections)
      return;

    let startingNodes = [...this.nodes.values()].filter(x => (x.type != "output"));
    let endingNodes = [...this.nodes.values()].filter(x => (x.type != "input"));

    for (let i = 0; i < neat.config.addConnectionAttempts; i++) {
      let startNode = startingNodes[Math.floor(Math.random() * startingNodes.length)];
      let endNode = endingNodes[Math.floor(Math.random() * endingNodes.length)];

      // Check if it's the same node
      if (startNode.id == endNode.id)
        continue;

      // Check if the connection already exists in this genome
      let existingId = neat.connectionIds.get(startNode.id + "->" + endNode.id);
      let existingConnection = (existingId !== undefined) ? this.connections.get(existingId) : undefined;

      if (existingConnection !== undefined) {
        // Disabled -> enable it
        if (!existingConnection.enabled) {
          existingConnection.enabled = true;
          this.structureChanged();
          return;
        }
        // Enabled -> try another pair
        else
          continue;
      }

      // Not in this genome (even if another genome has it) -> keep checking

      // Check if it creates a cycle (the end node can already reach the start node)
      if (this.canReach(endNode.id, startNode.id))
        continue;

      // Pair is good
      const newConnectionId = neat.getConnectionId(startNode.id, endNode.id);

      this.connections.set(newConnectionId, {
        id: newConnectionId,
        nodeInID: startNode.id,
        nodeOutID: endNode.id,
        weight: randomRange(-neat.config.weightRange, neat.config.weightRange),
        enabled: true
      });

      this.structureChanged();
      return;
    }
  }

  // True if "to" can be reached from "from" following the connections (disabled ones too, they can be enabled again)
  canReach(fromId: number, toId: number): boolean {
    let visited = new Set<number>();
    let toVisit = [fromId];

    while (toVisit.length > 0) {
      const id = toVisit.pop()!;
      if (id == toId)
        return true;

      if (visited.has(id))
        continue;
      visited.add(id);

      for (const connection of this.connections.values()) {
        if (connection.nodeInID == id)
          toVisit.push(connection.nodeOutID);
      }
    }

    return false;
  }

  mutateDeleteConnection(): void {
    let enabledConnections = [...this.connections.values()].filter(x => x.enabled);

    // Count enabled connections going in and out of every node
    let incoming = new Map<number, number>();
    let outgoing = new Map<number, number>();
    for (const connection of enabledConnections) {
      incoming.set(connection.nodeOutID, (incoming.get(connection.nodeOutID) ?? 0) + 1);
      outgoing.set(connection.nodeInID, (outgoing.get(connection.nodeInID) ?? 0) + 1);
    }

    // Connections that can be deleted without leaving orphan nodes
    let availableConnections = enabledConnections.filter(x => {
      // Connections between an input and an output can't be deleted
      if(this.nodes.get(x.nodeInID)!.type == "input" && this.nodes.get(x.nodeOutID)!.type == "output")
        return false;

      // The ending node must keep at least 1 connection going in
      if(incoming.get(x.nodeOutID)! < 2)
        return false;

      // A hidden starting node must keep at least 1 connection going out
      if(this.nodes.get(x.nodeInID)!.type == "hidden" && outgoing.get(x.nodeInID)! < 2)
        return false;

      return true;
    });

    if(availableConnections.length == 0)
      return;

    this.structureChanged();

    // Random connection
    let tempConnection = availableConnections[Math.floor(Math.random() * availableConnections.length)];

    // Remove connection
    this.connections.delete(tempConnection.id);
  }

  geneticDistance(subject: Genome, neat: Neat): number {
    /*
      E = geni excess, leader gene più alto 5, subject 3, E = 2
      D = geni disjoint, presenti in un solo genoma ma con id dentro il range dell'altro
      W = differenza media dei pesi (bias forse in futuro)
      N = numero di geni del genoma più grande (minimo distanceMinGenes), rende D ed E proporzionali

      leader = this
    */

    const c1 = neat.config.excessCoefficient;
    const c2 = neat.config.disjointCoefficient;
    const c3 = neat.config.weightCoefficient;

    let E: number;
    let D: number = 0;
    let W: number = 0;
    let N: number;

    let highestLeaderConnection: number = -1;
    let highestSubjectConnection: number = -1;
    let min = -1;

    for(const id of this.connections.keys()){
      if(id > highestLeaderConnection)
        highestLeaderConnection = id;
    }

    for(const id of subject.connections.keys()){
      if(id > highestSubjectConnection)
        highestSubjectConnection = id;
    }

    // Highest id that both genomes reach
    min = Math.min(highestLeaderConnection, highestSubjectConnection);

    // E: genes with an id higher than the other genome's highest id
    E = 0;
    for(const id of this.connections.keys()){
      if(id > min)
        E++;
    }
    for(const id of subject.connections.keys()){
      if(id > min)
        E++;
    }

    // D: genes present in only one genome, with an id inside the other genome's range
    for(const id of this.connections.keys()){
      if(id <= min && !subject.connections.has(id))
        D++;
    }
    for(const id of subject.connections.keys()){
      if(id <= min && !this.connections.has(id))
        D++;
    }

    // W
    let cont = 0;
    for (const [id, connection] of this.connections) {
      const other = subject.connections.get(id);
      if (other !== undefined) {
        W += Math.abs(connection.weight - other.weight);
        cont++;
      }
    }

    if(cont != 0)
      W = W / cont;

    // N: genes of the bigger genome (never lower than distanceMinGenes)
    N = Math.max(this.connections.size, subject.connections.size, neat.config.distanceMinGenes);

    return ((c1 * (E / N)) + (c2 * (D / N)) + (c3 * W));
  }
}
