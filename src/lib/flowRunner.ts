import type { Flow, FlowNode, HistoryEntry } from './types';

export type FlowNodeState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type FlowNodeResult = {
  nodeId: string;
  state: FlowNodeState;
  error?: string;
  extracted?: Record<string, string>;
  historyEntry?: HistoryEntry;
};

export type FlowRequestOutcome = {
  vars: Record<string, string>;
  extracted: Record<string, string>;
  succeeded: boolean;
  error?: string;
  historyEntry?: HistoryEntry;
};

export type FlowNodeHandlers = {
  request: (node: FlowNode, vars: Record<string, string>) => Promise<FlowRequestOutcome>;
  condition: (node: FlowNode, vars: Record<string, string>) => boolean;
  delay: (node: FlowNode) => Promise<void>;
  setVariable: (node: FlowNode, vars: Record<string, string>) => Record<string, string>;
  log: (node: FlowNode, vars: Record<string, string>) => void;
};

// Loops (For/Repeat) aren't supported yet - the max-steps guard below is what protects against
// a cyclic edge until a real loop node is added.
const MAX_STEPS = 500;

export async function runFlow(
  flow: Flow,
  handlers: FlowNodeHandlers,
  onNodeUpdate: (result: FlowNodeResult) => void,
  stopOnError: boolean
): Promise<Record<string, string>> {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const start = flow.nodes.find((node) => node.kind === 'start');
  let vars: Record<string, string> = {};
  if (!start) return vars;

  let current: FlowNode | undefined = start;
  let steps = 0;
  let failed = false;
  const visited = new Set<string>();

  while (current && steps < MAX_STEPS) {
    steps += 1;
    const node: FlowNode = current;
    visited.add(node.id);
    onNodeUpdate({ nodeId: node.id, state: 'running' });

    let nextPort: 'out' | 'true' | 'false' = 'out';
    let stopAfterThis = false;
    try {
      switch (node.kind) {
        case 'start':
        case 'end':
          onNodeUpdate({ nodeId: node.id, state: 'passed' });
          break;
        case 'request': {
          const outcome = await handlers.request(node, vars);
          vars = outcome.vars;
          if (outcome.succeeded) {
            onNodeUpdate({ nodeId: node.id, state: 'passed', extracted: outcome.extracted, historyEntry: outcome.historyEntry });
          } else {
            onNodeUpdate({ nodeId: node.id, state: 'failed', error: outcome.error, extracted: outcome.extracted, historyEntry: outcome.historyEntry });
            failed = true;
            stopAfterThis = stopOnError;
          }
          break;
        }
        case 'condition': {
          const value = handlers.condition(node, vars);
          nextPort = value ? 'true' : 'false';
          onNodeUpdate({ nodeId: node.id, state: 'passed' });
          break;
        }
        case 'delay':
          await handlers.delay(node);
          onNodeUpdate({ nodeId: node.id, state: 'passed' });
          break;
        case 'setVariable':
          vars = handlers.setVariable(node, vars);
          onNodeUpdate({ nodeId: node.id, state: 'passed' });
          break;
        case 'log':
          handlers.log(node, vars);
          onNodeUpdate({ nodeId: node.id, state: 'passed' });
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onNodeUpdate({ nodeId: node.id, state: 'failed', error: message });
      failed = true;
      stopAfterThis = stopOnError;
    }

    if (stopAfterThis) break;

    const edge: { toNodeId: string } | undefined = flow.edges.find((candidate) => candidate.fromNodeId === node.id && candidate.fromPort === nextPort);
    current = edge ? nodesById.get(edge.toNodeId) : undefined;
  }

  if (failed && stopOnError) {
    for (const node of flow.nodes) {
      if (!visited.has(node.id)) onNodeUpdate({ nodeId: node.id, state: 'skipped' });
    }
  }

  return vars;
}
