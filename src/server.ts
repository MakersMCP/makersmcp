import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { isAvailable, type AvailableKit, type KitBackend } from './backend.js';
import { loadKitDefinitions, type KitDefinition } from './kits.js';
import { LocalBackend } from './local-backend.js';
import {
  instructionsText,
  loadPlaybooks,
  offeredTopics,
  PlaybookError,
  registerPlaybookResources,
  registerPlaybookTool,
  type Playbooks,
} from './playbooks.js';
import { REPEAT_TIMING, startLedger, type RepeatTiming } from './repeats.js';
import { withDraft2020 } from './schema-dialect.js';
import { defaultOutDir } from './setup.js';
import { onNames, type TextContext } from './texts.js';
import { registerCoreTools, registerKitTool, type ToolContext } from './tools.js';

export { loadKitDefinitions, resolveKit, validateKitDefinition, docNames, docEntry, KITS_DIR } from './kits.js';
export type {
  DocEntry,
  FactValue,
  Facts,
  InstalledKit,
  KitDefinition,
  MissingKit,
  NextLines,
  OutDefinition,
  ParamDefinition,
  ParamType,
  ReplacedFolder,
  ReplacedFor,
  ToolDefinition,
} from './kits.js';
export {
  indexText,
  instructionsText,
  loadPlaybooks,
  offeredTopics,
  renderTopic,
  PlaybookError,
  PLAYBOOK_TOOL,
  PLAYBOOKS_DIR,
} from './playbooks.js';
export type { Playbooks, Topic } from './playbooks.js';
export { TEXTS_LEAVE_OUT, textsLeaveOut } from './texts.js';
export type { TextContext } from './texts.js';
export { JobManager, Job, FolderBusyError } from './jobs.js';
export type { JobSpec } from './jobs.js';
export { ArgumentError, buildCommand, expandHome } from './args.js';
export type { BuiltCommand, CommandContext } from './args.js';
export { LocalBackend, failureText, listFiles, readDocs, viewJob } from './local-backend.js';
export type { LocalBackendOptions } from './local-backend.js';
export { NotStartedError, isAvailable } from './backend.js';
export { REPEAT_TIMING } from './repeats.js';
export type { RepeatTiming } from './repeats.js';
export type {
  AvailableKit,
  HostedLimits,
  JobDoc,
  JobFile,
  JobStatus,
  JobView,
  KitBackend,
  SetupOptions,
  StartRequest,
  UnavailableKit,
  WaitOptions,
} from './backend.js';

const require = createRequire(import.meta.url);
export const version = (require('../package.json') as { version: string }).version;

export interface MakersMcpOptions {
  /** Turn on only these kits. Empty, or with "all" in it: every kit the backend can run. */
  kits?: string[];
  /** Where kits save, and what relative paths are read from. For the local backend. */
  outDir?: string;
  /** A kit's folder to use instead of its installed package, like { musicfit: '../musicfit' }; ~ is the home folder. For the local backend. */
  kitPaths?: Record<string, string>;
  /**
   * Kit definitions to use instead of the ones in kits/. A kit of kits/ given with fewer
   * tools, as a service passes one whose machines cannot run some of its tools, keeps the
   * others for the texts: they are not listed, and the texts leave out what names them.
   */
  definitions?: KitDefinition[];
  /** Where the jobs run. Default: a LocalBackend on outDir and kitPaths. */
  backend?: KitBackend;
  /**
   * The playbooks, as a folder of topics and its _instructions.md, or as loadPlaybooks read
   * them. Default: the package's playbooks/, read once per process.
   */
  playbooks?: string | Playbooks;
  /**
   * The most array items and object members one tool call may carry, counted before its
   * arguments are checked. Default: 10,000; Infinity turns the check off.
   */
  maxToolInputElements?: number;
  /**
   * When a kit tool call identical to an earlier one of the same backend identity continues
   * that call's job instead of starting another: within unansweredWindowMs of that call ending
   * with no answer that reached its client, or while it still waits, once retryAfterMs have
   * passed since it began. Default: REPEAT_TIMING, 10 minutes and 10 seconds.
   */
  repeatTiming?: Partial<RepeatTiming>;
}

/** maxToolInputElements when the options give none. No kit tool takes a list near it. */
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

interface Prepared {
  backend: KitBackend;
  /** Every kit the server knows, each with all its tools, for the texts. */
  definitions: KitDefinition[];
  available: AvailableKit[];
  enabled: Set<string>;
  /** The kit tools the server lists. */
  listed: Set<string>;
}

let packageKits: KitDefinition[] | undefined;

/**
 * The kits the texts read: those given, each with the tools of the same kit in kits/ that
 * it leaves out. MakersMCP-Server passes a kit without the tools its workers cannot run now
 * (check_video and fit_music on an older ffmpeg), and the texts still have to fill a
 * default of such a tool and know to leave out what names it. With no tool left out it is
 * the very list given, so the renderings cached for that list (playbooks.ts cacheKey) are
 * found again for every server built from it, as a hosted service builds one a request.
 */
function withHeldTools(given: KitDefinition[]): KitDefinition[] {
  if (packageKits === undefined) {
    try {
      packageKits = loadKitDefinitions();
    } catch {
      packageKits = [];
    }
  }
  let changed = false;
  const result = given.map(definition => {
    const known = packageKits!.find(entry => entry.kit === definition.kit);
    const names = new Set(definition.tools.map(tool => tool.name));
    if (!known || known.tools.every(tool => names.has(tool.name))) return definition;
    changed = true;
    // The package's order, with each tool given as it was given, and any it does not know after.
    const tools = [
      ...known.tools.map(tool => definition.tools.find(entry => entry.name === tool.name) ?? tool),
      ...definition.tools.filter(tool => !known.tools.some(entry => entry.name === tool.name)),
    ];
    return { ...definition, tools };
  });
  return changed ? result : given;
}

function prepare(options: MakersMcpOptions): Prepared {
  const given = options.definitions ?? loadKitDefinitions();
  const definitions = withHeldTools(given);
  const names = new Set<string>();
  for (const definition of definitions) {
    for (const tool of definition.tools) {
      if (names.has(tool.name)) throw new Error(`Two kits have a tool named ${tool.name}`);
      names.add(tool.name);
    }
  }

  // No kits, or "all" among them, turns on every kit the backend can run.
  const asked = (options.kits ?? []).map(kit => kit.trim()).filter(Boolean);
  const all = asked.length === 0 || asked.some(kit => kit.toLowerCase() === 'all');
  const known = new Set(definitions.map(definition => definition.kit));
  const unknown = all ? [] : asked.filter(kit => !known.has(kit));
  if (unknown.length) {
    throw new Error(`Unknown kit: ${unknown.join(', ')}. The kits are ${[...known].join(', ')}, or all.`);
  }

  const backend = options.backend
    ?? new LocalBackend({ baseDir: options.outDir ?? defaultOutDir(), kitPaths: options.kitPaths });
  // The backend gets the kits as given: a service's check_setup lists their tools.
  const available = backend.available(given).filter(isAvailable);
  const wanted = all ? undefined : new Set(asked);
  const enabled = new Set(available.map(kit => kit.definition.kit).filter(kit => !wanted || wanted.has(kit)));
  const listed = new Set(available.filter(kit => enabled.has(kit.definition.kit))
    .flatMap(kit => kit.definition.tools.map(tool => tool.name).filter(name => !kit.tools || kit.tools.includes(name))));
  return { backend, definitions, available, enabled, listed };
}

/** The setup report that check_setup gives, for `makersmcp --check`. */
export async function describeSetup(options: MakersMcpOptions = {}): Promise<string> {
  const { backend, enabled } = prepare(options);
  return backend.setupReport({ version, enabled });
}

/** The tools' and the playbooks' context: the side, the kits on, their versions and texts, and the topics offered. */
function toolContext(prepared: Prepared, playbooks: Playbooks, repeatTiming: Partial<RepeatTiming> = {}): ToolContext {
  const { backend, definitions, available, enabled, listed } = prepared;
  const hosted = backend.where === 'hosted';
  const baseDir = backend.baseDir;
  const text: TextContext = {
    where: backend.where,
    place: backend.place ?? (hosted ? 'on a server' : 'on this machine'),
    ...(baseDir !== undefined && !hosted ? { baseDir } : {}),
    definitions,
    enabled,
    listed,
    versions: new Map(available.map(kit => [kit.definition.kit, kit.version])),
    ...(hosted && backend.limits ? { limits: backend.limits } : {}),
  };
  // A tool's topic is one of the playbooks, so its description never points at nothing.
  const names = new Set(playbooks.topics.map(topic => topic.name));
  for (const definition of definitions) {
    for (const tool of definition.tools) {
      if (tool.playbook !== undefined && !names.has(tool.playbook)) {
        throw new PlaybookError(`${definition.kit}: ${tool.name}'s playbook is ${tool.playbook}, which is not a topic in ${playbooks.dir}`);
      }
    }
  }
  return {
    version,
    backend,
    baseDir,
    enabled,
    text,
    topics: new Set(offeredTopics(playbooks, onNames(text)).map(topic => topic.name)),
    tools: new Map(),
    ledger: startLedger,
    repeatTiming: { ...REPEAT_TIMING, ...repeatTiming },
  };
}

/**
 * An MCP server with a tool for each tool of each kit the backend can run and the
 * server turned on, plus makersmcp_playbook, wait_for_job, cancel_job, list_jobs and
 * check_setup, and the playbooks offered as resources too. Connect
 * it to any transport. With the local backend, its running jobs stop when the server
 * or the transport closes, and with this process. On stdio, use serveStdio: the stdio
 * transport does not close when the client goes away.
 */
export function createMcpServer(options: MakersMcpOptions = {}): McpServer {
  const prepared = prepare(options);
  const playbooks = typeof options.playbooks === 'object' ? options.playbooks : loadPlaybooks(options.playbooks);
  const context = toolContext(prepared, playbooks, options.repeatTiming);
  const server = new McpServer(
    { name: 'makersmcp', title: 'MakersMCP', version, websiteUrl: 'https://makersmcp.com' },
    {
      // Rendered from playbooks/_instructions.md for this side and the kits that are on. The
      // hosted text must not promise more than each parameter's own text says it takes.
      instructions: instructionsText(playbooks, context.text),
      // A list or repeat parameter has no limit of its own, so without this one call of a few
      // megabytes could hand millions of items to the argument checks.
      maxToolInputElements: options.maxToolInputElements ?? MAX_TOOL_INPUT_ELEMENTS,
    },
  );

  registerPlaybookTool(server, playbooks, context.text);
  registerPlaybookResources(server, playbooks, context.text);
  for (const kit of prepared.available) {
    if (!context.enabled.has(kit.definition.kit)) continue;
    for (const tool of kit.definition.tools) if (prepared.listed.has(tool.name)) registerKitTool(server, context, kit, tool);
  }
  registerCoreTools(server, context);

  const onclose = server.server.onclose;
  server.server.onclose = () => {
    context.backend.close();
    onclose?.();
  };

  const connect = server.connect.bind(server);
  server.connect = (transport: Transport) => connect(withDraft2020(transport));
  return server;
}

const EXIT_SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;
// A client sends SIGTERM 2 s after it closes stdin, and SIGKILL 2 s after that.
const DRAIN_MS = 1000;
const EXIT_MS = 1500;

/**
 * Serves makersmcp on this process's stdin and stdout, the way an MCP client starts it,
 * and ends the process once the client is gone: when stdin ends (after answering the
 * requests already sent, for up to a second), when stdout breaks, or on SIGTERM, SIGINT
 * or SIGHUP. The running jobs stop with it. The stdio transport alone never notices the
 * client leave, so a server on stdio should start this way.
 */
export async function serveStdio(options: MakersMcpOptions = {}): Promise<McpServer> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // The requests the client still waits on, so one that closes stdin right after its
  // last request still gets the answer.
  const waiting = new Set<string | number>();
  let drained: (() => void) | undefined;
  const receive = transport.onmessage;
  transport.onmessage = (message: JSONRPCMessage) => {
    if ('method' in message && 'id' in message) waiting.add(message.id);
    receive?.(message);
  };
  const send = transport.send.bind(transport);
  transport.send = async (message: JSONRPCMessage) => {
    try {
      await send(message);
    } finally {
      if (!('method' in message) && 'id' in message && message.id !== undefined && waiting.delete(message.id) && !waiting.size) {
        drained?.();
      }
    }
  };

  let closing = false;
  const close = (code: number, drain: boolean) => {
    if (closing) return;
    closing = true;
    const exit = () => process.exit(code);
    setTimeout(exit, EXIT_MS).unref();
    let stopped = false;
    // Closing the server stops the jobs. Their supervisors also stop them once this
    // process is gone, so it need not wait for them.
    const stop = () => {
      if (stopped) return;
      stopped = true;
      server.close().then(exit, exit);
    };
    if (drain && waiting.size) {
      drained = stop;
      setTimeout(stop, DRAIN_MS).unref();
    } else {
      stop();
    }
  };
  process.stdin.on('end', () => close(0, true));
  process.stdin.on('close', () => close(0, true));
  process.stdout.on('error', () => close(0, false));
  for (const [signal, number] of Object.entries(EXIT_SIGNALS)) process.on(signal, () => close(128 + number, false));
  return server;
}
