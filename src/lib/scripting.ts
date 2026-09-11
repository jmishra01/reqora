export type ScriptHeader = { key: string; value: string };
export type ScriptConsoleEntry = { level: 'log' | 'info' | 'warn' | 'error'; text: string };
export type ScriptTestOutcome = { name: string; passed: boolean; error?: string };

type SharedContext = {
  environment: Record<string, string>;
  collectionVariables: Record<string, string>;
  variables: Record<string, string>;
  requestName?: string;
};

export type PreRequestContext = SharedContext & {
  request: { method: string; url: string; headers: ScriptHeader[]; body: string };
};

export type TestContext = SharedContext & {
  request: { method: string; url: string; headers: ScriptHeader[]; body: string };
  response: { code: number; status: string; responseTime: number; responseSize: number; headers: ScriptHeader[]; body: string };
};

export type ScriptRunResult = {
  ok: boolean;
  error?: string;
  request: { method: string; url: string; headers: ScriptHeader[]; body: string };
  tests: ScriptTestOutcome[];
  environmentSets: Record<string, string>;
  environmentUnsets: string[];
  collectionVariableSets: Record<string, string>;
  collectionVariableUnsets: string[];
  variableSets: Record<string, string>;
  consoleLogs: ScriptConsoleEntry[];
};

const TIMEOUT_MS = 5000;

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./scriptSandbox.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function resetWorker() {
  worker?.terminate();
  worker = null;
}

function emptyResult(request: PreRequestContext['request'], error?: string): ScriptRunResult {
  return {
    ok: !error,
    error,
    request,
    tests: [],
    environmentSets: {},
    environmentUnsets: [],
    collectionVariableSets: {},
    collectionVariableUnsets: [],
    variableSets: {},
    consoleLogs: []
  };
}

function runInSandbox(kind: 'pre-request' | 'test', script: string, context: PreRequestContext | TestContext): Promise<ScriptRunResult> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const activeWorker = getWorker();

    const timer = window.setTimeout(() => {
      activeWorker.removeEventListener('message', onMessage);
      resetWorker();
      resolve(emptyResult(context.request, `Script timed out after ${TIMEOUT_MS / 1000}s (possible infinite loop).`));
    }, TIMEOUT_MS);

    function onMessage(event: MessageEvent<{ id: string; result: ScriptRunResult }>) {
      if (event.data?.id !== id) return;
      window.clearTimeout(timer);
      activeWorker.removeEventListener('message', onMessage);
      resolve(event.data.result);
    }

    activeWorker.addEventListener('message', onMessage);
    activeWorker.postMessage({ id, kind, script, context });
  });
}

export async function runPreRequestScript(script: string, context: PreRequestContext): Promise<ScriptRunResult> {
  if (!script.trim()) return emptyResult(context.request);
  return runInSandbox('pre-request', script, context);
}

export async function runTestScript(script: string, context: TestContext): Promise<ScriptRunResult> {
  if (!script.trim()) return emptyResult(context.request);
  return runInSandbox('test', script, context);
}
