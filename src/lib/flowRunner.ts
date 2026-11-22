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

export type FlowIssueSeverity = 'error' | 'warning';

export type FlowIssue = {
  nodeId: string;
  severity: FlowIssueSeverity;
  message: string;
};

export function validateFlow(flow: Flow, hasRequest: (requestId: string) => boolean): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const incoming = new Set(flow.edges.map((edge) => edge.toNodeId));
  const hasCollectNode = flow.nodes.some((node) => node.kind === 'collect');

  for (const node of flow.nodes) {
    if (node.kind !== 'start' && !incoming.has(node.id)) {
      issues.push({ nodeId: node.id, severity: 'warning', message: 'This node is not connected to the flow.' });
    }
    switch (node.kind) {
      case 'request':
        if (!node.requestId || !hasRequest(node.requestId)) {
          issues.push({ nodeId: node.id, severity: 'error', message: 'Choose a saved request.' });
        }
        for (const extraction of node.extractions ?? []) {
          if (!extraction.name.trim()) issues.push({ nodeId: node.id, severity: 'error', message: 'An output is missing a variable name.' });
          else if (extraction.source === 'header' && !extraction.path.trim()) issues.push({ nodeId: node.id, severity: 'error', message: `Output "${extraction.name}" needs a header name.` });
        }
        break;
      case 'condition':
        if (!node.conditionLeft?.trim()) issues.push({ nodeId: node.id, severity: 'error', message: 'Left value is required.' });
        if (node.conditionOperator !== 'exists' && !node.conditionRight?.trim()) issues.push({ nodeId: node.id, severity: 'error', message: 'Right value is required.' });
        break;
      case 'setVariable':
        if (!node.variableName?.trim()) issues.push({ nodeId: node.id, severity: 'error', message: 'Variable name is required.' });
        break;
      case 'for':
        if (!node.forListTemplate?.trim()) issues.push({ nodeId: node.id, severity: 'error', message: 'A list is required.' });
        if (!node.forItemVariable?.trim()) issues.push({ nodeId: node.id, severity: 'error', message: 'Item variable name is required.' });
        if (!hasCollectNode) issues.push({ nodeId: node.id, severity: 'error', message: 'Add a Collect node to close the loop.' });
        break;
    }
  }

  return issues;
}

const MAX_STEPS = 500;
const MAX_ITERATIONS = 1000;

// Static (non-executing) lookahead used only to locate the resume point for a zero-iteration
// loop: follows any outgoing edge from each node, without evaluating conditions.
function findReachableCollect(flow: Flow, fromNodeId: string): string | undefined {
  const guard = new Set<string>();
  let currentId: string | undefined = fromNodeId;
  while (currentId) {
    if (guard.has(currentId)) return undefined;
    guard.add(currentId);
    const node = flow.nodes.find((candidate) => candidate.id === currentId);
    if (node?.kind === 'collect') return node.id;
    const edge = flow.edges.find((candidate) => candidate.fromNodeId === currentId);
    currentId = edge?.toNodeId;
  }
  return undefined;
}

function resolveTemplate(input: string, vars: Record<string, string>) {
  let output = input;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = output.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
    if (next === output) break;
    output = next;
  }
  return output;
}

type Port = 'out' | 'true' | 'false';

type WalkResult = {
  vars: Record<string, string>;
  failed: boolean;
  stoppedAtNodeId?: string;
  visited: Set<string>;
};

async function runFrom(
  flow: Flow,
  nodesById: Map<string, FlowNode>,
  startNodeId: string,
  initialVars: Record<string, string>,
  handlers: FlowNodeHandlers,
  onNodeUpdate: (result: FlowNodeResult) => void,
  stopOnError: boolean,
  stopAtKind: string | undefined,
  stepBudget: { remaining: number }
): Promise<WalkResult> {
  let vars = initialVars;
  let current: FlowNode | undefined = nodesById.get(startNodeId);
  let failed = false;
  const visited = new Set<string>();

  while (current && stepBudget.remaining > 0) {
    if (stopAtKind && current.kind === stopAtKind) {
      return { vars, failed, stoppedAtNodeId: current.id, visited };
    }

    stepBudget.remaining -= 1;
    const node: FlowNode = current;
    visited.add(node.id);
    onNodeUpdate({ nodeId: node.id, state: 'running' });

    let nextPort: Port = 'out';
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
        case 'for': {
          const result = await runForLoop(flow, nodesById, node, vars, handlers, onNodeUpdate, stopOnError, stepBudget);
          vars = result.vars;
          if (result.failed) failed = true;
          if (result.stoppedAtNodeId) {
            for (const id of result.visited) visited.add(id);
            onNodeUpdate({ nodeId: node.id, state: result.failed ? 'failed' : 'passed' });
            current = nodesById.get(result.stoppedAtNodeId);
            continue;
          }
          onNodeUpdate({ nodeId: node.id, state: result.failed ? 'failed' : 'passed', error: result.failed ? 'A node inside the loop body failed' : undefined });
          stopAfterThis = result.failed && stopOnError;
          break;
        }
        case 'collect':
          // Reached a collect node outside of a matching for-loop walk (e.g. the flow has no for
          // node feeding it, or the for node's body never rejoins here) - treat it as a pass-through.
          onNodeUpdate({ nodeId: node.id, state: 'passed' });
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onNodeUpdate({ nodeId: node.id, state: 'failed', error: message });
      failed = true;
      stopAfterThis = stopOnError;
    }

    if (stopAfterThis) return { vars, failed, visited };

    const edge: { toNodeId: string } | undefined = flow.edges.find((candidate) => candidate.fromNodeId === node.id && candidate.fromPort === nextPort);
    current = edge ? nodesById.get(edge.toNodeId) : undefined;
  }

  return { vars, failed, visited };
}

// A loop body is walked with stopAtKind: 'collect', so it stops at the first 'collect' node
// reached on whichever branch executes - this supports a Condition inside the body naturally,
// but a 'for' node nested inside another 'for' node's body isn't supported: both share the same
// stop-at-kind, so the inner loop's own collect would be mistaken for the outer one's.
async function runForLoop(
  flow: Flow,
  nodesById: Map<string, FlowNode>,
  node: FlowNode,
  vars: Record<string, string>,
  handlers: FlowNodeHandlers,
  onNodeUpdate: (result: FlowNodeResult) => void,
  stopOnError: boolean,
  stepBudget: { remaining: number }
): Promise<{ vars: Record<string, string>; failed: boolean; stoppedAtNodeId?: string; visited: Set<string> }> {
  const visited = new Set<string>();
  const bodyEdge = flow.edges.find((candidate) => candidate.fromNodeId === node.id && candidate.fromPort === 'out');
  const itemVar = (node.forItemVariable ?? 'item').trim() || 'item';
  const indexVar = (node.forIndexVariable ?? 'index').trim() || 'index';
  const resultVar = (node.collectResultVariable ?? 'results').trim() || 'results';

  if (!bodyEdge) return { vars, failed: true, visited };

  let list: unknown;
  try {
    const resolved = resolveTemplate(node.forListTemplate ?? '', vars);
    list = JSON.parse(resolved);
  } catch {
    return { vars, failed: true, visited };
  }
  if (!Array.isArray(list)) return { vars, failed: true, visited };
  if (list.length > MAX_ITERATIONS) return { vars, failed: true, visited };

  if (list.length === 0) {
    const collectId = findReachableCollect(flow, bodyEdge.toNodeId);
    if (!collectId) return { vars, failed: true, visited };
    return { vars: { ...vars, [resultVar]: '[]' }, failed: false, stoppedAtNodeId: collectId, visited };
  }

  const collected: unknown[] = [];
  let collectNodeId: string | undefined;
  let failed = false;

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const iterationVars = { ...vars, [itemVar]: typeof item === 'string' ? item : JSON.stringify(item), [indexVar]: String(i) };
    const result = await runFrom(flow, nodesById, bodyEdge.toNodeId, iterationVars, handlers, onNodeUpdate, stopOnError, 'collect', stepBudget);
    for (const id of result.visited) visited.add(id);
    if (result.failed) {
      failed = true;
      if (stopOnError) return { vars, failed, visited };
    }
    if (!result.stoppedAtNodeId) {
      // The loop body never reached a collect node - stop iterating, flag as failed.
      return { vars, failed: true, visited };
    }
    collectNodeId = result.stoppedAtNodeId;
    const collectNode = nodesById.get(collectNodeId);
    const valueTemplate = collectNode?.collectValueTemplate ?? '{{item}}';
    const rawValue = resolveTemplate(valueTemplate, result.vars);
    collected.push(rawValue);
    if (stepBudget.remaining <= 0) break;
  }

  if (!collectNodeId) return { vars, failed: true, visited };
  return { vars: { ...vars, [resultVar]: JSON.stringify(collected) }, failed, stoppedAtNodeId: collectNodeId, visited };
}

export async function runFlow(
  flow: Flow,
  handlers: FlowNodeHandlers,
  onNodeUpdate: (result: FlowNodeResult) => void,
  stopOnError: boolean
): Promise<Record<string, string>> {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const start = flow.nodes.find((node) => node.kind === 'start');
  if (!start) return {};

  const stepBudget = { remaining: MAX_STEPS };
  const result = await runFrom(flow, nodesById, start.id, {}, handlers, onNodeUpdate, stopOnError, undefined, stepBudget);

  if (result.failed && stopOnError) {
    for (const node of flow.nodes) {
      if (!result.visited.has(node.id)) onNodeUpdate({ nodeId: node.id, state: 'skipped' });
    }
  }

  return result.vars;
}
