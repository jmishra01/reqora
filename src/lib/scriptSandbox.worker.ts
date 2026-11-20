/// <reference lib="webworker" />
// Runs pre-request / post-response (test) scripts in an isolated worker thread.
// No DOM, no localStorage, no Tauri IPC is reachable from here, and network access
// is stripped below so an untrusted imported script can't exfiltrate variables.

declare const self: DedicatedWorkerGlobalScope;

// @ts-expect-error - intentionally removing sandbox capabilities
self.fetch = undefined;
// @ts-expect-error - intentionally removing sandbox capabilities
self.XMLHttpRequest = undefined;
// @ts-expect-error - intentionally removing sandbox capabilities
self.importScripts = undefined;

type Header = { key: string; value: string };
type ScriptKind = 'pre-request' | 'test';

type SharedContext = {
  environment: Record<string, string>;
  collectionVariables: Record<string, string>;
  variables: Record<string, string>;
  requestName?: string;
};

type PreRequestContext = SharedContext & {
  request: { method: string; url: string; headers: Header[]; body: string };
};

type TestContext = SharedContext & {
  request: { method: string; url: string; headers: Header[]; body: string };
  response: { code: number; status: string; responseTime: number; responseSize: number; headers: Header[]; body: string };
};

type ConsoleEntry = { level: 'log' | 'info' | 'warn' | 'error'; text: string };
type TestOutcome = { name: string; passed: boolean; error?: string };

type RunMessage = { id: string; kind: ScriptKind; script: string; context: PreRequestContext | TestContext };

type RunResult = {
  ok: boolean;
  error?: string;
  request: { method: string; url: string; headers: Header[]; body: string };
  tests: TestOutcome[];
  environmentSets: Record<string, string>;
  environmentUnsets: string[];
  collectionVariableSets: Record<string, string>;
  collectionVariableUnsets: string[];
  variableSets: Record<string, string>;
  consoleLogs: ConsoleEntry[];
};

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}

function fmt(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : safeStringify(value);
}

class AssertionFailure extends Error {}

class Assertion {
  constructor(private actual: unknown, private negate = false) {}

  get to() { return this; }
  get be() { return this; }
  get been() { return this; }
  get is() { return this; }
  get that() { return this; }
  get which() { return this; }
  get and() { return this; }
  get has() { return this; }
  get have() { return this; }
  get with() { return this; }
  get at() { return this; }
  get of() { return this; }
  get same() { return this; }
  get not(): Assertion { return new Assertion(this.actual, !this.negate); }
  get ok(): Assertion { this.assert(!!this.actual, 'expected value to not be truthy', 'expected value to be truthy'); return this; }

  private assert(pass: boolean, passMsg: string, failMsg: string) {
    const result = this.negate ? !pass : pass;
    if (!result) throw new AssertionFailure(this.negate ? passMsg : failMsg);
  }

  equal(expected: unknown) {
    this.assert(this.actual === expected, `expected ${fmt(this.actual)} to not equal ${fmt(expected)}`, `expected ${fmt(this.actual)} to equal ${fmt(expected)}`);
    return this;
  }

  eql(expected: unknown) {
    this.assert(deepEqual(this.actual, expected), `expected ${fmt(this.actual)} to not deeply equal ${fmt(expected)}`, `expected ${fmt(this.actual)} to deeply equal ${fmt(expected)}`);
    return this;
  }

  include(expected: unknown) {
    let pass = false;
    if (typeof this.actual === 'string') pass = this.actual.includes(String(expected));
    else if (Array.isArray(this.actual)) pass = this.actual.some((item) => deepEqual(item, expected));
    else if (this.actual && typeof this.actual === 'object') pass = Object.prototype.hasOwnProperty.call(this.actual, expected as string);
    this.assert(pass, `expected ${fmt(this.actual)} to not include ${fmt(expected)}`, `expected ${fmt(this.actual)} to include ${fmt(expected)}`);
    return this;
  }

  property(name: string, value?: unknown) {
    const has = this.actual != null && Object.prototype.hasOwnProperty.call(this.actual, name);
    if (arguments.length < 2) {
      this.assert(has, `expected object to not have property "${name}"`, `expected object to have property "${name}"`);
    } else {
      const matches = has && deepEqual((this.actual as Record<string, unknown>)[name], value);
      this.assert(matches, `expected property "${name}" to not equal ${fmt(value)}`, `expected property "${name}" to equal ${fmt(value)}`);
    }
    return this;
  }

  above(n: number) {
    this.assert(typeof this.actual === 'number' && this.actual > n, `expected ${fmt(this.actual)} to not be above ${n}`, `expected ${fmt(this.actual)} to be above ${n}`);
    return this;
  }

  below(n: number) {
    this.assert(typeof this.actual === 'number' && this.actual < n, `expected ${fmt(this.actual)} to not be below ${n}`, `expected ${fmt(this.actual)} to be below ${n}`);
    return this;
  }

  lengthOf(n: number) {
    const len = (this.actual as { length?: number } | null)?.length;
    this.assert(len === n, `expected length to not be ${n}`, `expected length ${len} to be ${n}`);
    return this;
  }

  a(type: string) {
    const actualType = Array.isArray(this.actual) ? 'array' : typeof this.actual;
    this.assert(actualType === type, `expected ${fmt(this.actual)} to not be a ${type}`, `expected ${fmt(this.actual)} to be a ${type}`);
    return this;
  }

  an(type: string) { return this.a(type); }

  status(code: number) {
    const actualCode = this.actual && typeof this.actual === 'object' && 'code' in (this.actual as Record<string, unknown>)
      ? (this.actual as Record<string, unknown>).code
      : this.actual;
    this.assert(actualCode === code, `expected status to not be ${code}`, `expected status ${actualCode} to be ${code}`);
    return this;
  }
}

function buildPmApi(kind: ScriptKind, context: PreRequestContext | TestContext) {
  const environmentStore: Record<string, string> = { ...context.environment };
  const environmentSets: Record<string, string> = {};
  const environmentUnsets: string[] = [];

  const collectionVariableStore: Record<string, string> = { ...context.collectionVariables };
  const collectionVariableSets: Record<string, string> = {};
  const collectionVariableUnsets: string[] = [];

  const variableStore: Record<string, string> = { ...context.variables };
  const variableSets: Record<string, string> = {};

  const requestSnapshot = {
    method: context.request.method,
    url: context.request.url,
    headers: context.request.headers.map((header) => ({ ...header })),
    body: context.request.body
  };

  const tests: TestOutcome[] = [];

  const makeStore = (
    store: Record<string, string>,
    sets: Record<string, string>,
    unsets: string[]
  ) => ({
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => { const stringValue = String(value); store[key] = stringValue; sets[key] = stringValue; },
    unset: (key: string) => { delete store[key]; unsets.push(key); },
    has: (key: string) => key in store,
    toObject: () => ({ ...store })
  });

  const pm: Record<string, unknown> = {
    environment: makeStore(environmentStore, environmentSets, environmentUnsets),
    collectionVariables: makeStore(collectionVariableStore, collectionVariableSets, collectionVariableUnsets),
    variables: {
      get: (key: string) => variableStore[key],
      set: (key: string, value: unknown) => { const stringValue = String(value); variableStore[key] = stringValue; variableSets[key] = stringValue; },
      unset: (key: string) => { delete variableStore[key]; },
      has: (key: string) => key in variableStore,
      toObject: () => ({ ...variableStore })
    },
    info: { requestName: context.requestName ?? '' },
    test: (name: string, fn: () => void) => {
      try {
        fn();
        tests.push({ name, passed: true });
      } catch (error) {
        tests.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
    expect: (actual: unknown) => new Assertion(actual),
    sendRequest: () => { throw new Error('pm.sendRequest is not supported yet.'); }
  };

  pm.request = {
    get method() { return requestSnapshot.method; },
    set method(value: string) { requestSnapshot.method = String(value).toUpperCase(); },
    get url() { return requestSnapshot.url; },
    set url(value: string) { requestSnapshot.url = String(value); },
    get body() {
      return {
        get raw() { return requestSnapshot.body; },
        set raw(value: string) { requestSnapshot.body = String(value); }
      };
    },
    headers: {
      get: (name: string) => requestSnapshot.headers.find((h) => h.key.toLowerCase() === String(name).toLowerCase())?.value,
      has: (name: string) => requestSnapshot.headers.some((h) => h.key.toLowerCase() === String(name).toLowerCase()),
      add: (entry: Header) => requestSnapshot.headers.push({ key: entry.key, value: entry.value }),
      upsert: (entry: Header) => {
        const existing = requestSnapshot.headers.find((h) => h.key.toLowerCase() === entry.key.toLowerCase());
        if (existing) existing.value = entry.value;
        else requestSnapshot.headers.push({ key: entry.key, value: entry.value });
      },
      remove: (name: string) => {
        requestSnapshot.headers = requestSnapshot.headers.filter((h) => h.key.toLowerCase() !== String(name).toLowerCase());
      }
    }
  };

  if (kind === 'test') {
    const responseContext = (context as TestContext).response;
    pm.response = {
      code: responseContext.code,
      status: responseContext.status,
      responseTime: responseContext.responseTime,
      responseSize: responseContext.responseSize,
      headers: {
        get: (name: string) => responseContext.headers.find((h) => h.key.toLowerCase() === String(name).toLowerCase())?.value,
        has: (name: string) => responseContext.headers.some((h) => h.key.toLowerCase() === String(name).toLowerCase())
      },
      text: () => responseContext.body,
      json: () => JSON.parse(responseContext.body)
    };
  }

  return { pm, tests, requestSnapshot, environmentSets, environmentUnsets, collectionVariableSets, collectionVariableUnsets, variableSets };
}

self.onmessage = (event: MessageEvent<RunMessage>) => {
  const { id, kind, script, context } = event.data;
  const logs: ConsoleEntry[] = [];
  const capture = (level: ConsoleEntry['level']) => (...args: unknown[]) => {
    logs.push({ level, text: args.map(safeStringify).join(' ') });
  };
  const consoleShim = { log: capture('log'), info: capture('info'), warn: capture('warn'), error: capture('error') };

  const { pm, tests, requestSnapshot, environmentSets, environmentUnsets, collectionVariableSets, collectionVariableUnsets, variableSets } = buildPmApi(kind, context);

  let error: string | undefined;
  try {
    const fn = new Function('pm', 'console', 'request', 'response', script);
    fn(pm, consoleShim, pm.request, pm.response);
  } catch (err) {
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  const result: RunResult = {
    ok: !error,
    error,
    request: requestSnapshot,
    tests,
    environmentSets,
    environmentUnsets,
    collectionVariableSets,
    collectionVariableUnsets,
    variableSets,
    consoleLogs: logs
  };

  self.postMessage({ id, result });
};
