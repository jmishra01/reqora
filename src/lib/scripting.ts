export type ScriptHeader = { key: string; value: string };

export type ScriptConsoleEntry = { level: 'log' | 'warn' | 'error'; message: string };

export type ScriptContext = {
  url: string;
  method: string;
  headers: ScriptHeader[];
  variables: Record<string, string>;
  environment: Record<string, string>;
  hasEnvironment: boolean;
};

export type ScriptResult = {
  variables: Record<string, string>;
  environmentUpdates: Record<string, string>;
  headers: ScriptHeader[];
  console: ScriptConsoleEntry[];
  error?: string;
};

const SCRIPT_TIMEOUT_MS = 5000;

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export async function runPreRequestScript(script: string, context: ScriptContext): Promise<ScriptResult> {
  const trimmed = script.trim();
  const consoleEntries: ScriptConsoleEntry[] = [];
  const variableUpdates: Record<string, string> = {};
  const environmentUpdates: Record<string, string> = {};
  if (!trimmed) return { variables: variableUpdates, environmentUpdates, headers: context.headers, console: consoleEntries };

  const headers = context.headers.map((header) => ({ ...header }));
  const log = (level: ScriptConsoleEntry['level']) => (...args: unknown[]) => {
    consoleEntries.push({ level, message: args.map(stringifyArg).join(' ') });
  };

  const pm = {
    variables: {
      get: (key: string) => variableUpdates[key] ?? context.variables[key] ?? context.environment[key],
      set: (key: string, value: unknown) => { variableUpdates[key] = String(value); }
    },
    environment: {
      get: (key: string) => environmentUpdates[key] ?? context.environment[key],
      set: (key: string, value: unknown) => {
        environmentUpdates[key] = String(value);
        if (!context.hasEnvironment) {
          consoleEntries.push({ level: 'warn', message: `pm.environment.set("${key}", ...) — no environment is active, value kept for this request only.` });
        }
      }
    },
    request: {
      url: context.url,
      method: context.method,
      headers: {
        get: (key: string) => headers.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value,
        add: (entry: ScriptHeader) => { if (entry?.key) headers.push({ key: entry.key, value: String(entry.value ?? '') }); },
        upsert: (entry: ScriptHeader) => {
          if (!entry?.key) return;
          const index = headers.findIndex((header) => header.key.toLowerCase() === entry.key.toLowerCase());
          const row = { key: entry.key, value: String(entry.value ?? '') };
          if (index >= 0) headers[index] = row; else headers.push(row);
        }
      }
    },
    console: { log: log('log'), warn: log('warn'), error: log('error'), info: log('log') }
  };

  try {
    // eslint-disable-next-line no-new-func
    const runner = new Function('pm', 'console', `return (async () => {\n${script}\n})();`);
    await Promise.race([
      runner(pm, pm.console),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error(`Script timed out after ${SCRIPT_TIMEOUT_MS / 1000}s`)), SCRIPT_TIMEOUT_MS))
    ]);
  } catch (error) {
    return {
      variables: variableUpdates, environmentUpdates, headers: context.headers, console: consoleEntries,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  return { variables: variableUpdates, environmentUpdates, headers, console: consoleEntries };
}
