<script lang="ts">
  import { CirclePlay, Clock, Combine, Flag, GitBranch, Maximize, Minus, Plus, Repeat, Terminal, TriangleAlert, Trash2, Variable, X, Zap } from '@lucide/svelte';
  import type { ApiRequest, Flow, FlowConditionOperator, FlowEdge, FlowEdgePort, FlowNode, FlowNodeKind } from '../lib/types';
  import { blankFlowExtraction, uid } from '../lib/types';
  import type { FlowIssue, FlowNodeResult } from '../lib/flowRunner';

  export let flow: Flow;
  export let savedRequests: Array<{ request: ApiRequest; label: string }>;
  export let results: Record<string, FlowNodeResult> = {};
  export let runVariables: Record<string, string> = {};
  export let running = false;
  export let issues: FlowIssue[] = [];
  export let onChange: () => void = () => {};

  let issuesOpen = false;
  $: errorNodeIds = new Set(issues.filter((issue) => issue.severity === 'error').map((issue) => issue.nodeId));

  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 68;

  const NODE_META: Record<FlowNodeKind, { label: string; icon: typeof Zap }> = {
    start: { label: 'Start', icon: CirclePlay },
    request: { label: 'Request', icon: Zap },
    condition: { label: 'Condition', icon: GitBranch },
    delay: { label: 'Delay', icon: Clock },
    setVariable: { label: 'Set variable', icon: Variable },
    log: { label: 'Log', icon: Terminal },
    for: { label: 'For each', icon: Repeat },
    collect: { label: 'Collect', icon: Combine },
    end: { label: 'End', icon: Flag }
  };

  let viewportEl: HTMLDivElement;
  let selectedNodeId: string | null = null;
  let selectedEdgeId: string | null = null;
  let dragNodeId: string | null = null;
  let dragOffset = { x: 0, y: 0 };
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  let panning = false;
  let panStart = { x: 0, y: 0, panX: 0, panY: 0 };
  let connecting: { fromNodeId: string; fromPort: FlowEdgePort; x: number; y: number } | null = null;

  $: selectedNode = flow.nodes.find((node) => node.id === selectedNodeId) ?? null;

  function toWorld(clientX: number, clientY: number) {
    const rect = viewportEl.getBoundingClientRect();
    return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
  }

  function touchNodes() {
    flow.nodes = [...flow.nodes];
    onChange();
  }

  function touchEdges() {
    flow.edges = [...flow.edges];
    onChange();
  }

  function selectNode(id: string) {
    if (running) return;
    selectedNodeId = id;
    selectedEdgeId = null;
  }

  function outputPorts(node: FlowNode): Array<{ port: FlowEdgePort; y: number; label?: string }> {
    if (node.kind === 'end') return [];
    if (node.kind === 'condition') return [
      { port: 'true', y: NODE_HEIGHT * 0.32, label: 'T' },
      { port: 'false', y: NODE_HEIGHT * 0.72, label: 'F' }
    ];
    return [{ port: 'out', y: NODE_HEIGHT / 2 }];
  }

  function hasInput(node: FlowNode) {
    return node.kind !== 'start';
  }

  function outputPortPos(node: FlowNode, port: FlowEdgePort) {
    const ports = outputPorts(node);
    const def = ports.find((item) => item.port === port) ?? ports[0];
    return { x: node.position.x + NODE_WIDTH, y: node.position.y + (def?.y ?? NODE_HEIGHT / 2) };
  }

  function inputPortPos(node: FlowNode) {
    return { x: node.position.x, y: node.position.y + NODE_HEIGHT / 2 };
  }

  function nodeById(id: string) {
    return flow.nodes.find((node) => node.id === id);
  }

  function edgePath(edge: FlowEdge) {
    const from = nodeById(edge.fromNodeId);
    const to = nodeById(edge.toNodeId);
    if (!from || !to) return null;
    const p1 = outputPortPos(from, edge.fromPort);
    const p2 = inputPortPos(to);
    const dx = Math.max(60, Math.abs(p2.x - p1.x) / 2);
    return { d: `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`, midX: (p1.x + p2.x) / 2, midY: (p1.y + p2.y) / 2 };
  }

  function tempPath() {
    if (!connecting) return null;
    const from = nodeById(connecting.fromNodeId);
    if (!from) return null;
    const p1 = outputPortPos(from, connecting.fromPort);
    const dx = Math.max(60, Math.abs(connecting.x - p1.x) / 2);
    return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${connecting.x - dx} ${connecting.y}, ${connecting.x} ${connecting.y}`;
  }

  function operatorLabel(op?: FlowConditionOperator) {
    switch (op) {
      case 'notEquals': return '≠';
      case 'contains': return 'contains';
      case 'greaterThan': return '>';
      case 'lessThan': return '<';
      case 'exists': return 'exists';
      default: return '=';
    }
  }

  function nodeSummary(node: FlowNode) {
    switch (node.kind) {
      case 'start': return 'Flow entry point';
      case 'end': return 'Flow exit point';
      case 'request': {
        const found = savedRequests.find((item) => item.request.id === node.requestId);
        return found ? found.label : 'No request selected';
      }
      case 'condition':
        return `${node.conditionLeft || '—'} ${operatorLabel(node.conditionOperator)} ${node.conditionOperator === 'exists' ? '' : node.conditionRight || '—'}`.trim();
      case 'delay':
        return `Wait ${node.delayMs ?? 0} ms`;
      case 'setVariable':
        return `${node.variableName || 'variable'} = ${node.variableValue ?? ''}`;
      case 'log':
        return node.logTemplate || '{{value}}';
      case 'for':
        return `For each ${node.forItemVariable || 'item'} in ${node.forListTemplate || '—'}`;
      case 'collect':
        return `Collect ${node.collectValueTemplate || '{{item}}'} as ${node.collectResultVariable || 'results'}`;
      default:
        return '';
    }
  }

  function addNode(kind: FlowNodeKind) {
    if (running) return;
    const rect = viewportEl?.getBoundingClientRect();
    const center = rect ? toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: 320, y: 220 };
    const jitter = (flow.nodes.length % 5) * 18;
    const base: FlowNode = { id: uid(), kind, position: { x: center.x - NODE_WIDTH / 2 + jitter, y: center.y - NODE_HEIGHT / 2 + jitter } };
    const node: FlowNode = kind === 'request'
      ? { ...base, requestId: savedRequests[0]?.request.id ?? '', extractions: [] }
      : kind === 'condition'
        ? { ...base, conditionLeft: '{{status}}', conditionOperator: 'equals', conditionRight: '200' }
        : kind === 'delay'
          ? { ...base, delayMs: 500 }
          : kind === 'setVariable'
            ? { ...base, variableName: '', variableValue: '' }
            : kind === 'log'
              ? { ...base, logTemplate: '{{value}}' }
              : kind === 'for'
                ? { ...base, forListTemplate: '{{items}}', forItemVariable: 'item', forIndexVariable: 'index' }
                : kind === 'collect'
                  ? { ...base, collectValueTemplate: '{{item}}', collectResultVariable: 'results' }
                  : base;
    flow.nodes = [...flow.nodes, node];
    selectedNodeId = node.id;
    onChange();
  }

  function deleteNode(id: string) {
    const node = nodeById(id);
    if (!node || node.kind === 'start' || node.kind === 'end' || running) return;
    flow.nodes = flow.nodes.filter((item) => item.id !== id);
    flow.edges = flow.edges.filter((edge) => edge.fromNodeId !== id && edge.toNodeId !== id);
    if (selectedNodeId === id) selectedNodeId = null;
    onChange();
  }

  function deleteEdge(id: string) {
    if (running) return;
    flow.edges = flow.edges.filter((edge) => edge.id !== id);
    if (selectedEdgeId === id) selectedEdgeId = null;
    onChange();
  }

  function addExtraction(node: FlowNode) {
    if (running) return;
    node.extractions = [...(node.extractions ?? []), blankFlowExtraction()];
    touchNodes();
  }

  function removeExtraction(node: FlowNode, id: string) {
    node.extractions = (node.extractions ?? []).filter((item) => item.id !== id);
    touchNodes();
  }

  function beginNodeDrag(event: PointerEvent, node: FlowNode) {
    if (running) return;
    event.stopPropagation();
    selectNode(node.id);
    const world = toWorld(event.clientX, event.clientY);
    dragOffset = { x: world.x - node.position.x, y: world.y - node.position.y };
    dragNodeId = node.id;
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
  }

  function beginConnection(event: PointerEvent, node: FlowNode, port: FlowEdgePort) {
    if (running) return;
    event.stopPropagation();
    const world = toWorld(event.clientX, event.clientY);
    connecting = { fromNodeId: node.id, fromPort: port, x: world.x, y: world.y };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
  }

  function completeConnection(toNodeId: string) {
    if (!connecting || running) return;
    if (toNodeId === connecting.fromNodeId) { connecting = null; return; }
    const kept = flow.edges.filter((edge) => !(edge.fromNodeId === connecting!.fromNodeId && edge.fromPort === connecting!.fromPort));
    flow.edges = [...kept, { id: uid(), fromNodeId: connecting.fromNodeId, fromPort: connecting.fromPort, toNodeId }];
    connecting = null;
    onChange();
  }

  function beginPan(event: PointerEvent) {
    if (running) return;
    selectedNodeId = null;
    selectedEdgeId = null;
    panning = true;
    panStart = { x: event.clientX, y: event.clientY, panX, panY };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
  }

  function onWindowPointerMove(event: PointerEvent) {
    if (dragNodeId) {
      const world = toWorld(event.clientX, event.clientY);
      const node = nodeById(dragNodeId);
      if (node) {
        node.position = { x: world.x - dragOffset.x, y: world.y - dragOffset.y };
        flow.nodes = [...flow.nodes];
      }
    } else if (panning) {
      panX = panStart.panX + (event.clientX - panStart.x);
      panY = panStart.panY + (event.clientY - panStart.y);
    } else if (connecting) {
      const world = toWorld(event.clientX, event.clientY);
      connecting = { ...connecting, x: world.x, y: world.y };
    }
  }

  function onWindowPointerUp() {
    if (dragNodeId) onChange();
    dragNodeId = null;
    panning = false;
    connecting = null;
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
  }

  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.08 : -0.08);
  }

  function zoomBy(delta: number) {
    zoom = Math.min(1.6, Math.max(0.5, Math.round((zoom + delta) * 100) / 100));
  }

  function resetView() {
    zoom = 1;
    panX = 0;
    panY = 0;
  }
</script>

<div class="flow-canvas-root">
  <div class="flow-toolbar">
    <div class="flow-palette">
      <button on:click={() => addNode('request')} disabled={running} title="Add a request node"><Zap size={13} /> Request</button>
      <button on:click={() => addNode('condition')} disabled={running} title="Add a condition node"><GitBranch size={13} /> Condition</button>
      <button on:click={() => addNode('delay')} disabled={running} title="Add a delay node"><Clock size={13} /> Delay</button>
      <button on:click={() => addNode('setVariable')} disabled={running} title="Add a set-variable node"><Variable size={13} /> Set variable</button>
      <button on:click={() => addNode('log')} disabled={running} title="Add a log node"><Terminal size={13} /> Log</button>
      <button on:click={() => addNode('for')} disabled={running} title="Add a for-each node"><Repeat size={13} /> For each</button>
      <button on:click={() => addNode('collect')} disabled={running} title="Add a collect node"><Combine size={13} /> Collect</button>
    </div>
    <div class="flow-zoom-controls">
      <button on:click={() => zoomBy(-0.1)} title="Zoom out"><Minus size={13} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button on:click={() => zoomBy(0.1)} title="Zoom in"><Plus size={13} /></button>
      <button on:click={resetView} title="Reset view"><Maximize size={13} /></button>
    </div>
  </div>
  {#if issues.length}
    <div class="flow-issues">
      <button class="flow-issues-summary" on:click={() => issuesOpen = !issuesOpen}>
        <TriangleAlert size={13} />
        {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
        {#if errorNodeIds.size} · fix errors before running{/if}
      </button>
      {#if issuesOpen}
        <div class="flow-issues-list">
          {#each issues as issue, index (index)}
            <button class="flow-issue-row" class:error={issue.severity === 'error'} on:click={() => { selectNode(issue.nodeId); issuesOpen = false; }}>
              <span class="flow-issue-node">{NODE_META[nodeById(issue.nodeId)?.kind ?? 'log'].label}</span>
              <span>{issue.message}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  <div class="flow-body">
    <div class="flow-viewport" bind:this={viewportEl} on:wheel={onWheel} role="presentation">
      <div class="flow-world" style={`transform: translate(${panX}px, ${panY}px) scale(${zoom})`} on:pointerdown={beginPan} role="presentation">
        <svg class="flow-edge-layer">
          {#each flow.edges as edge (edge.id)}
            {@const path = edgePath(edge)}
            {#if path}
              <path d={path.d} class="flow-edge" class:selected={edge.id === selectedEdgeId} role="presentation" on:pointerdown|stopPropagation={() => { selectedEdgeId = edge.id; selectedNodeId = null; }} />
              <g class="flow-edge-delete" role="presentation" on:pointerdown|stopPropagation={() => deleteEdge(edge.id)}>
                <circle cx={path.midX} cy={path.midY} r="8" />
                <text x={path.midX} y={path.midY + 3}>×</text>
              </g>
            {/if}
          {/each}
          {#if connecting}
            {@const temp = tempPath()}
            {#if temp}<path d={temp} class="flow-edge flow-edge-pending" />{/if}
          {/if}
        </svg>
        {#each flow.nodes as node (node.id)}
          {@const meta = NODE_META[node.kind]}
          {@const result = results[node.id]}
          <div
            class="flow-node flow-node-{node.kind}"
            class:selected={node.id === selectedNodeId}
            class:running={result?.state === 'running'}
            class:passed={result?.state === 'passed'}
            class:failed={result?.state === 'failed'}
            class:skipped={result?.state === 'skipped'}
            class:invalid={errorNodeIds.has(node.id)}
            style={`left:${node.position.x}px; top:${node.position.y}px; width:${NODE_WIDTH}px; height:${NODE_HEIGHT}px`}
          >
            {#if hasInput(node)}<span class="flow-port flow-port-in" role="presentation" on:pointerup|stopPropagation={() => completeConnection(node.id)}></span>{/if}
            <div
              class="flow-node-header"
              role="button"
              tabindex="0"
              on:pointerdown={(event) => beginNodeDrag(event, node)}
              on:click|stopPropagation={() => selectNode(node.id)}
              on:keydown={(event) => { if (event.key === 'Enter' || event.key === ' ') selectNode(node.id); }}
            >
              <svelte:component this={meta.icon} size={13} />
              <strong>{meta.label}</strong>
              {#if node.kind !== 'start' && node.kind !== 'end'}
                <button class="flow-node-delete" on:pointerdown|stopPropagation on:click|stopPropagation={() => deleteNode(node.id)} title="Delete node"><X size={11} /></button>
              {/if}
            </div>
            <div class="flow-node-body">{nodeSummary(node)}</div>
            {#each outputPorts(node) as portDef (portDef.port)}
              <span class="flow-port flow-port-out" role="presentation" style={`top:${portDef.y}px`} on:pointerdown|stopPropagation={(event) => beginConnection(event, node, portDef.port)}>
                {#if portDef.label}<small>{portDef.label}</small>{/if}
              </span>
            {/each}
          </div>
        {/each}
      </div>
    </div>
    <aside class="flow-properties">
      {#if selectedNode}
        <div class="flow-props-header"><strong>{NODE_META[selectedNode.kind].label}</strong>{#if selectedNode.kind !== 'start' && selectedNode.kind !== 'end'}<button on:click={() => deleteNode(selectedNode?.id ?? '')} disabled={running} title="Delete node"><Trash2 size={13} /></button>{/if}</div>
        {#if selectedNode.kind === 'request'}
          <label><span>Saved request</span>
            <select bind:value={selectedNode.requestId} on:change={touchNodes} disabled={running}>
              {#each savedRequests as option}<option value={option.request.id}>{option.label}</option>{/each}
            </select>
          </label>
          <div class="flow-props-extractions-heading"><span>Outputs</span><button on:click={() => addExtraction(selectedNode)} disabled={running}><Plus size={12} /> Add output</button></div>
          {#each selectedNode.extractions ?? [] as extraction (extraction.id)}
            <div class="flow-extraction-row">
              <input bind:value={extraction.name} on:input={touchNodes} placeholder="variableName" aria-label="Output variable name" disabled={running} />
              <select bind:value={extraction.source} on:change={touchNodes} aria-label="Output source" disabled={running}>
                <option value="json">JSON path</option><option value="header">Header</option><option value="body">Full body</option><option value="status">Status code</option>
              </select>
              <input bind:value={extraction.path} on:input={touchNodes} disabled={running || extraction.source === 'body' || extraction.source === 'status'} placeholder={extraction.source === 'header' ? 'Header name' : '$.data.id'} aria-label="JSON path or header name" />
              <button on:click={() => removeExtraction(selectedNode, extraction.id)} disabled={running} title="Remove output"><X size={12} /></button>
            </div>
          {/each}
          {#if !selectedNode.extractions?.length}<p class="flow-properties-hint">No outputs. Add one if a later node needs data from this response.</p>{/if}
        {:else if selectedNode.kind === 'condition'}
          <label><span>Left value</span><input bind:value={selectedNode.conditionLeft} on:input={touchNodes} placeholder={'{{status}}'} disabled={running} /></label>
          <label><span>Operator</span>
            <select bind:value={selectedNode.conditionOperator} on:change={touchNodes} disabled={running}>
              <option value="equals">Equals</option><option value="notEquals">Not equals</option><option value="contains">Contains</option><option value="greaterThan">Greater than</option><option value="lessThan">Less than</option><option value="exists">Exists / non-empty</option>
            </select>
          </label>
          {#if selectedNode.conditionOperator !== 'exists'}<label><span>Right value</span><input bind:value={selectedNode.conditionRight} on:input={touchNodes} disabled={running} /></label>{/if}
        {:else if selectedNode.kind === 'delay'}
          <label><span>Delay (ms)</span><input type="number" min="0" step="100" bind:value={selectedNode.delayMs} on:input={touchNodes} disabled={running} /></label>
        {:else if selectedNode.kind === 'setVariable'}
          <label><span>Variable name</span><input bind:value={selectedNode.variableName} on:input={touchNodes} placeholder="variableName" disabled={running} /></label>
          <label><span>Value</span><input bind:value={selectedNode.variableValue} on:input={touchNodes} placeholder={'{{existingVar}}-suffix'} disabled={running} /></label>
        {:else if selectedNode.kind === 'log'}
          <label><span>Message template</span><textarea bind:value={selectedNode.logTemplate} on:input={touchNodes} placeholder={'{{value}}'} disabled={running}></textarea></label>
        {:else if selectedNode.kind === 'for'}
          <label><span>List</span><input bind:value={selectedNode.forListTemplate} on:input={touchNodes} placeholder={'{{items}}'} disabled={running} /></label>
          <label><span>Item variable</span><input bind:value={selectedNode.forItemVariable} on:input={touchNodes} placeholder="item" disabled={running} /></label>
          <label><span>Index variable</span><input bind:value={selectedNode.forIndexVariable} on:input={touchNodes} placeholder="index" disabled={running} /></label>
          <p class="flow-properties-hint">Connect this node's output to the start of the loop body. The body must reach a Collect node.</p>
        {:else if selectedNode.kind === 'collect'}
          <label><span>Value per iteration</span><input bind:value={selectedNode.collectValueTemplate} on:input={touchNodes} placeholder={'{{item}}'} disabled={running} /></label>
          <label><span>Result variable</span><input bind:value={selectedNode.collectResultVariable} on:input={touchNodes} placeholder="results" disabled={running} /></label>
          <p class="flow-properties-hint">Pairs with the nearest For each node upstream. Its output continues after the loop.</p>
        {:else}
          <p class="flow-properties-hint">{selectedNode.kind === 'start' ? 'Every flow begins here. Drag a connection out to the next node.' : 'Every flow ends here.'}</p>
        {/if}
        {#if results[selectedNode.id]}
          {@const nodeResult = results[selectedNode.id]}
          <div class="flow-node-result flow-result-{nodeResult.state}">
            <span>{nodeResult.state}</span>
            {#if nodeResult.error}<p>{nodeResult.error}</p>{/if}
            {#if nodeResult.extracted && Object.keys(nodeResult.extracted).length}
              <div class="flow-result-vars">{#each Object.entries(nodeResult.extracted) as [key, value]}<span><code>{key}</code><b>{value}</b></span>{/each}</div>
            {/if}
          </div>
        {/if}
      {:else}
        <p class="flow-properties-empty">Select a node to edit its settings, or use the palette above to add one.</p>
      {/if}
    </aside>
  </div>
  {#if Object.keys(runVariables).length}
    <div class="flow-variables-rail">
      <span>Runtime variables</span>
      {#each Object.entries(runVariables) as [key, value]}<span class="flow-variable-chip"><code>{key}</code><b>{value}</b></span>{/each}
    </div>
  {/if}
</div>
