import { blankFormRow, blankRequest, blankRow, uid } from './types';
import type { ApiRequest, Collection, Flow, FlowNode, FormDataRow, ReqoraWorkspace, WorkspaceState, WorkspaceStore } from './types';

type LegacyJourneyExtraction = { id?: string; name?: string; source?: 'json' | 'header' | 'body' | 'status'; path?: string; template?: string };
type LegacyJourneyStep = { id?: string; requestId?: string; extractions?: LegacyJourneyExtraction[] };
type LegacyJourney = { id?: string; name?: string; stopOnError?: boolean; steps?: LegacyJourneyStep[] };

function journeyToFlow(journey: LegacyJourney): Flow {
  const startId = uid();
  const endId = uid();
  const requestNodes: FlowNode[] = (journey.steps ?? []).map((step, index) => ({
    id: step.id ?? uid(),
    kind: 'request',
    position: { x: 60, y: 160 + (index + 1) * 160 },
    requestId: step.requestId ?? '',
    extractions: (step.extractions ?? []).map((extraction) => ({
      id: extraction.id ?? uid(),
      name: extraction.name ?? '',
      source: extraction.source ?? 'json',
      path: extraction.path ?? '',
      template: extraction.template ?? '{{value}}'
    }))
  }));
  const chain = [{ id: startId, kind: 'start' as const, position: { x: 60, y: 160 } }, ...requestNodes, { id: endId, kind: 'end' as const, position: { x: 60, y: 160 + (requestNodes.length + 1) * 160 } }];
  const edges = chain.slice(0, -1).map((node, index) => ({ id: uid(), fromNodeId: node.id, fromPort: 'out' as const, toNodeId: chain[index + 1].id }));
  return {
    id: journey.id ?? uid(),
    name: journey.name?.trim() || 'Untitled flow',
    stopOnError: journey.stopOnError ?? true,
    nodes: chain,
    edges
  };
}

export const starterRequest = (): ApiRequest => ({
  id: uid(),
  name: 'Echo request',
  method: 'GET',
  url: 'https://httpbin.org/anything',
  params: [
    { id: uid(), key: 'source', value: 'reqora', enabled: true },
    blankRow()
  ],
  pathParams: [blankRow()],
  headers: [
    { id: uid(), key: 'Accept', value: 'application/json', enabled: true },
    blankRow()
  ],
  bodyMode: 'none',
  body: '{\n  "hello": "world"\n}',
  formData: [blankFormRow()],
  graphqlVariables: '{\n  \n}',
  auth: { type: 'none' },
  preRequestScript: '// Runs before the request\n',
  testScript: '// Add response assertions here\n// pm.test("Status is 200", () => pm.response.to.have.status(200));\n',
  timeoutMs: 30000,
  followRedirects: true,
  validateCertificates: true
});

export const initialWorkspace = (): ReqoraWorkspace => ({
  id: uid(),
  name: 'My Workspace',
  collections: [
    {
      id: uid(),
      name: 'Reqora examples',
      description: 'A starter collection to explore Reqora.',
      expanded: true,
      variables: [blankRow()],
      auth: { type: 'none' },
      requests: [starterRequest()],
      folders: []
    }
  ],
  environments: [
    {
      id: uid(),
      name: 'Development',
      variables: [
        { id: uid(), key: 'baseUrl', value: 'https://httpbin.org', enabled: true },
        blankRow()
      ]
    }
  ],
  activeEnvironmentId: null,
  history: [],
  flows: []
});

export const blankWorkspace = (name: string): ReqoraWorkspace => ({
  id: uid(),
  name,
  collections: [],
  environments: [],
  activeEnvironmentId: null,
  history: [],
  flows: []
});

export const initialWorkspaceStore = (): WorkspaceStore => {
  const workspace = initialWorkspace();
  return { activeWorkspaceId: workspace.id, workspaces: [workspace] };
};

export function normalizeWorkspace(value: WorkspaceState, fallbackName = 'My Workspace'): ReqoraWorkspace {
  const stored = value as Partial<ReqoraWorkspace> & { journeys?: LegacyJourney[] };
  const flows: Flow[] = Array.isArray(stored.flows) && stored.flows.length
    ? stored.flows.map((flow) => ({
        id: flow.id ?? uid(),
        name: flow.name?.trim() || 'Untitled flow',
        stopOnError: flow.stopOnError ?? true,
        nodes: flow.nodes ?? [],
        edges: flow.edges ?? []
      }))
    : (stored.journeys ?? []).map(journeyToFlow);
  return {
    id: stored.id ?? uid(),
    name: stored.name?.trim() || fallbackName,
    collections: (value.collections ?? []).map(normalizeCollection),
    environments: value.environments ?? [],
    activeEnvironmentId: value.activeEnvironmentId ?? null,
    history: (value.history ?? []).slice(0, 200),
    flows
  };
}

export function normalizeWorkspaceStore(value: WorkspaceStore | WorkspaceState | null): WorkspaceStore {
  if (!value) return initialWorkspaceStore();
  const possibleStore = value as Partial<WorkspaceStore>;
  if (Array.isArray(possibleStore.workspaces)) {
    const workspaces = possibleStore.workspaces.map((workspace, index) => normalizeWorkspace(workspace, `Workspace ${index + 1}`));
    if (!workspaces.length) return initialWorkspaceStore();
    const activeWorkspaceId = workspaces.some((workspace) => workspace.id === possibleStore.activeWorkspaceId)
      ? possibleStore.activeWorkspaceId!
      : workspaces[0].id;
    return { activeWorkspaceId, workspaces };
  }
  const migrated = normalizeWorkspace(value as WorkspaceState, 'My Workspace');
  return { activeWorkspaceId: migrated.id, workspaces: [migrated] };
}

function normalizeCollection(collection: Collection): Collection {
  return {
    ...collection,
    variables: collection.variables?.length ? collection.variables : [blankRow()],
    auth: collection.auth ?? { type: 'none' },
    requests: (collection.requests ?? []).map(normalizeRequest),
    folders: (collection.folders ?? []).map((folder) => ({
      ...folder,
      expanded: folder.expanded ?? true,
      variables: folder.variables?.length ? folder.variables : [blankRow()],
      auth: folder.auth ?? { type: 'inherit' },
      requests: (folder.requests ?? []).map(normalizeRequest)
    }))
  };
}

export function normalizeRequest(request: ApiRequest): ApiRequest {
  const defaults = blankRequest(request.name);
  return {
    ...defaults,
    ...request,
    params: request.params?.length ? request.params : [blankRow()],
    pathParams: request.pathParams?.length ? request.pathParams : [blankRow()],
    headers: request.headers?.length ? request.headers : [blankRow()],
    formData: request.formData?.length
      ? request.formData.map((row) => ({ ...row, kind: (row as FormDataRow).kind ?? 'text' }))
      : [blankFormRow()],
    graphqlVariables: request.graphqlVariables ?? '{\n  \n}',
    auth: request.auth ?? { type: 'inherit' }
  };
}
