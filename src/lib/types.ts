export type KeyValue = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  secret?: boolean;
};

export type FormDataRow = KeyValue & {
  kind: 'text' | 'file';
  fileName?: string;
  mimeType?: string;
  dataBase64?: string;
};

export type BinaryFile = {
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

export type BodyMode = 'none' | 'json' | 'text' | 'javascript' | 'html' | 'xml' | 'form' | 'urlencoded' | 'binary' | 'graphql';
export type AuthType = 'inherit' | 'none' | 'bearer' | 'jwt-bearer' | 'basic' | 'api-key' | 'oauth2';

export type RequestAuth = {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  placement?: 'header' | 'query';
  prefix?: string;
  oauthGrantType?: 'client_credentials' | 'password';
  oauthTokenUrl?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScope?: string;
  oauthUsername?: string;
  oauthPassword?: string;
  oauthClientAuthHeader?: boolean;
};

export type ApiRequest = {
  id: string;
  name: string;
  method: string;
  url: string;
  params: KeyValue[];
  pathParams: KeyValue[];
  headers: KeyValue[];
  bodyMode: BodyMode;
  body: string;
  formData: FormDataRow[];
  binaryFile?: BinaryFile;
  graphqlVariables: string;
  auth: RequestAuth;
  preRequestScript: string;
  testScript: string;
  timeoutMs: number;
  followRedirects: boolean;
  validateCertificates: boolean;
};

export type CollectionFolder = {
  id: string;
  name: string;
  expanded: boolean;
  variables: KeyValue[];
  auth: RequestAuth;
  requests: ApiRequest[];
};

export type Collection = {
  id: string;
  name: string;
  description: string;
  expanded: boolean;
  variables: KeyValue[];
  auth: RequestAuth;
  requests: ApiRequest[];
  folders: CollectionFolder[];
};

export type Environment = {
  id: string;
  name: string;
  variables: KeyValue[];
};

export type ResponseData = {
  status: number;
  statusText: string;
  headers: KeyValue[];
  body: string;
  contentType: string;
  elapsedMs: number;
  sizeBytes: number;
  url: string;
  timings?: {
    ttfbMs?: number;
    dnsMs?: number;
    connectMs?: number;
    tlsMs?: number;
  };
};

export type HistoryEntry = {
  id: string;
  request: ApiRequest;
  status?: number;
  elapsedMs?: number;
  createdAt: string;
  response?: ResponseData;
  requestError?: string;
};

export type FlowExtractionSource = 'json' | 'header' | 'body' | 'status';

export type FlowExtraction = {
  id: string;
  name: string;
  source: FlowExtractionSource;
  path: string;
  template: string;
};

export type FlowNodeKind = 'start' | 'request' | 'condition' | 'delay' | 'setVariable' | 'log' | 'for' | 'collect' | 'end';

export type FlowConditionOperator = 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan' | 'exists';

export type FlowNode = {
  id: string;
  kind: FlowNodeKind;
  position: { x: number; y: number };
  // kind === 'request'
  requestId?: string;
  extractions?: FlowExtraction[];
  // kind === 'condition'
  conditionLeft?: string;
  conditionOperator?: FlowConditionOperator;
  conditionRight?: string;
  // kind === 'delay'
  delayMs?: number;
  // kind === 'setVariable'
  variableName?: string;
  variableValue?: string;
  // kind === 'log'
  logTemplate?: string;
  // kind === 'for'
  forListTemplate?: string;
  forItemVariable?: string;
  forIndexVariable?: string;
  // kind === 'collect'
  collectValueTemplate?: string;
  collectResultVariable?: string;
};

export type FlowEdgePort = 'out' | 'true' | 'false';

export type FlowEdge = {
  id: string;
  fromNodeId: string;
  fromPort: FlowEdgePort;
  toNodeId: string;
};

export type Flow = {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  stopOnError: boolean;
};

export type FlowRunNodeState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type FlowRunNodeResult = {
  nodeId: string;
  state: FlowRunNodeState;
  error?: string;
  extracted?: Record<string, string>;
};

export type FlowRunEntry = {
  id: string;
  flowId: string;
  flowName: string;
  startedAt: string;
  durationMs: number;
  succeeded: boolean;
  nodeResults: Record<string, FlowRunNodeResult>;
  variables: Record<string, string>;
};

export type WorkspaceState = {
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  history: HistoryEntry[];
  flows: Flow[];
  flowHistory: FlowRunEntry[];
};

export type ReqoraWorkspace = WorkspaceState & {
  id: string;
  name: string;
};

export type WorkspaceStore = {
  activeWorkspaceId: string;
  workspaces: ReqoraWorkspace[];
};

export type RequestInput = {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: string;
  multipart?: Array<{
    name: string;
    value: string;
    kind: 'text' | 'file';
    fileName?: string;
    mimeType?: string;
    dataBase64?: string;
  }>;
  binary?: BinaryFile;
  timeoutMs: number;
  followRedirects: boolean;
  validateCertificates: boolean;
};

export const uid = () => crypto.randomUUID();

export const blankRow = (): KeyValue => ({
  id: uid(),
  key: '',
  value: '',
  enabled: true
});

export const blankFormRow = (): FormDataRow => ({
  ...blankRow(),
  kind: 'text'
});

export const blankRequest = (name = 'Untitled Request'): ApiRequest => ({
  id: uid(),
  name,
  method: 'GET',
  url: '',
  params: [blankRow()],
  pathParams: [blankRow()],
  headers: [blankRow()],
  bodyMode: 'none',
  body: '{\n  \n}',
  formData: [blankFormRow()],
  graphqlVariables: '{\n  \n}',
  auth: { type: 'inherit' },
  preRequestScript: '',
  testScript: '',
  timeoutMs: 30000,
  followRedirects: true,
  validateCertificates: true
});

export const blankFlowExtraction = (): FlowExtraction => ({ id: uid(), name: '', source: 'json', path: '', template: '{{value}}' });

export const blankFlow = (name = 'Untitled flow'): Flow => {
  const startId = uid();
  const endId = uid();
  return {
    id: uid(),
    name,
    stopOnError: true,
    nodes: [
      { id: startId, kind: 'start', position: { x: 60, y: 160 } },
      { id: endId, kind: 'end', position: { x: 60, y: 360 } }
    ],
    edges: []
  };
};
