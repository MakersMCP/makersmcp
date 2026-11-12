import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { textPattern } from './args.js';
import { NotStartedError, type AvailableKit, type JobView, type KitBackend } from './backend.js';
import { strictInput } from './input.js';
import type { ParamDefinition, ToolDefinition } from './kits.js';
import { PLAYBOOK_TOOL } from './playbooks.js';
import { checkNextLines, errorResult, jobListed, jobOutputSchema, jobResult, shownView, type ResultContext } from './results.js';
import { BASE_DIR_IN_WORDS, fillText, inWords, templateInWords, TextError, WAIT_SECONDS, withoutUnlisted, type TextContext } from './texts.js';

/** A kit tool this server lists, with the kit it is of. */
export interface RegisteredKitTool {
  kit: AvailableKit;
  tool: ToolDefinition;
}

export interface ToolContext {
  version: string;
  backend: KitBackend;
  /** A local backend's folder, for the out_dir description. */
  baseDir?: string;
  /** The kits this server turned on. */
  enabled: Set<string>;
  /** What the placeholders in the kits' texts are filled from. */
  text: TextContext;
  /** The playbook topics this server offers, which the descriptions and the Next lines may point to. */
  topics: Set<string>;
  /** The kit tools registered so far, by name, for the results of wait_for_job and cancel_job. */
  tools: Map<string, RegisteredKitTool>;
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function waitSeconds(context: ToolContext): z.ZodType {
  const limit = context.text.limits?.maxWaitSeconds;
  const words = context.backend.where === 'local'
    ? 'Some clients end a call after 60 or 240 seconds; 45 is safe in all of them.'
    : limit !== undefined
      ? `Each call waits at most ${limit} seconds here, whatever this asks.`
      : 'A call here may come back sooner, with the job_id to wait on.';
  return z.number().int().min(WAIT_SECONDS.min).max(WAIT_SECONDS.max).default(WAIT_SECONDS.default)
    .describe(`How long to wait for the result, counted from the start of the call, before returning a job_id to wait on. ${words}`);
}

// A hosted kit cannot read the agent's disk: a file comes as a link, or as a file an
// earlier job of the same user saved.
const HOSTED_FILE_SOURCE = '(https?:\\/\\/\\S+|job:[^\\s/]+\\/\\S+)';
const HOSTED_FILE = new RegExp(`^${HOSTED_FILE_SOURCE}$`, 'i');
const HOSTED_FILE_HELP = ' Give an https link to the file, or job:<job_id>/<path> for a file an earlier job saved.';
const HOSTED_TEXT_OR_FILE_HELP = ' For a file, give an https link to it, or job:<job_id>/<path> for a file an earlier job saved.';
const HOSTED_ADDRESS_OR_FILE_HELP = ' A link is read as the address, so give a file as job:<job_id>/<path>, for one an earlier job saved.';

/**
 * Hosted, a url_or_path whose kit tells a file by the value itself: a link it does not
 * take for a file, or job:<job_id>/<path> for a file it does, since the kit cannot
 * download one.
 */
function hostedAddressOrFile(filePattern: string): RegExp {
  const file = `(?:${filePattern})$`;
  return new RegExp(`^(?:(?!${file})https?:\\/\\/\\S+|(?=${file})job:[^\\s/]+\\/\\S+)$`, 'i');
}

/**
 * Whether a parameter the kit reads as text also takes a number, written as text before the
 * job starts: a string, a text_or_path whose text can be a number (cuts), and an enum whose
 * values are all digits (meter). So length 29.333 and meter 4 work, and the kit and a hosted
 * service still see the text they check.
 */
export function takesNumber(param: ParamDefinition): boolean {
  if (param.type === 'string') return true;
  if (param.type === 'text_or_path') return ['1', '1.5'].some(text => textPattern(param).test(text));
  if (param.type === 'enum') return Boolean(param.values?.length) && param.values!.every(value => /^\d+$/.test(value));
  return false;
}

/**
 * A kit text with its placeholders filled and without the sentences that name a tool the
 * server does not list, or an error that names where it is.
 */
function kitText(text: string, context: ToolContext, where: string): string {
  try {
    return withoutUnlisted(fillText(text, context.text, { kind: 'kit' }), context.text);
  } catch (error) {
    if (error instanceof TextError) throw new Error(`${where}: ${error.message}`);
    throw error;
  }
}

function paramSchema(tool: ToolDefinition, name: string, param: ParamDefinition, context: ToolContext): z.ZodType {
  const hosted = context.backend.where === 'hosted';
  let schema: z.ZodType;
  // A hosted text of its own replaces the usual words about links.
  let description = kitText(hosted && param.hostedDescription ? param.hostedDescription : param.description, context, `${tool.name}.${name}`);
  const linkHelp = (help: string) => {
    if (!param.hostedDescription) description += help;
  };
  const number = takesNumber(param);
  switch (param.type) {
    case 'url':
      schema = z.string().regex(/^https?:\/\/\S+$/i, 'an address starting with http:// or https://');
      break;
    case 'path':
    case 'url_or_path':
      if (hosted && param.type === 'url_or_path' && param.filePattern !== undefined) {
        schema = z.string().regex(
          hostedAddressOrFile(param.filePattern),
          'an https address, or job:<job_id>/<path> for a file an earlier job saved',
        );
        linkHelp(HOSTED_ADDRESS_OR_FILE_HELP);
      } else if (hosted) {
        schema = z.string().regex(HOSTED_FILE, 'an https link, or job:<job_id>/<path>');
        linkHelp(HOSTED_FILE_HELP);
      } else {
        schema = z.string().min(1);
      }
      break;
    case 'text_or_path': {
      const message = hosted ? 'the text itself, an https link, or job:<job_id>/<path>' : 'the text itself, or a file';
      // The text as the kit takes it, or a file the service brings in. Never a path on its disk.
      const text = hosted
        ? z.string().regex(new RegExp(`^(?:${param.pattern})$|^${HOSTED_FILE_SOURCE}$`, 'i'), message)
        : z.string().min(1);
      if (hosted) linkHelp(HOSTED_TEXT_OR_FILE_HELP);
      schema = number
        ? z.union([text, z.number().refine(value => textPattern(param).test(String(value)), message)], { error: message })
        : text;
      break;
    }
    case 'integer':
    case 'number': {
      let value = param.type === 'integer' ? z.number().int() : z.number();
      if (param.min !== undefined) value = value.min(param.min);
      if (param.max !== undefined) value = value.max(param.max);
      schema = value;
      break;
    }
    case 'boolean':
      schema = z.boolean();
      break;
    case 'enum': {
      const values = param.values as [string, ...string[]];
      schema = number
        ? z.union([z.enum(values), z.literal(values.map(Number))], { error: `one of ${values.map(value => `"${value}"`).join('|')}, or that number` })
        : z.enum(values);
      break;
    }
    case 'list':
      schema = z.array(param.values ? z.enum(param.values as [string, ...string[]]) : z.string().min(1)).min(1);
      break;
    case 'repeat':
      schema = z.array(z.string().min(1)).min(1);
      break;
    default:
      schema = number ? z.union([z.string().min(1), z.number()], { error: 'text, or a number' }) : z.string().min(1);
  }
  if (param.required) return schema.describe(description);
  // A hosted server gives the parameter its hosted default when a call leaves it out, and its
  // schema shows it, as wait_seconds' shows its own.
  if (hosted && param.hostedDefault !== undefined) return schema.default(param.hostedDefault).describe(description);
  return schema.describe(description).optional();
}

/** Waits for a job, sending its progress lines when the client asked for progress. */
function waitFor(context: ToolContext, id: string, seconds: number, extra: Extra): Promise<JobView | undefined> {
  const progressToken = extra._meta?.progressToken;
  const startedAt = Date.now();
  let sentAt = 0;
  const onLine = progressToken === undefined ? undefined : (line: string) => {
    if (Date.now() - sentAt < 1000) return;
    sentAt = Date.now();
    extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, progress: (Date.now() - startedAt) / 1000, message: line },
    }).catch(() => {
      // Progress is best effort and never stops the job.
    });
  };
  return context.backend.wait(id, seconds, { signal: extra.signal, onLine });
}

/** A folder name template in words, like "the folder of source" for {dir:source}. */
function inPlainWords(template: string): string {
  return template
    .replace(/\{dir:(\w+)\}/g, 'the folder of $1')
    .replace(/\{stem:(\w+)\}/g, "$1's name")
    .replace(/\{host\}/g, "the site's host");
}

/**
 * out_dir's description: the plain case first (the folder it saves in by default, and that
 * a run replaces what an earlier one left there), then the rules for the folders a kit
 * makes again in it, like launch-film's brand/.
 */
function outDirHelp(tool: ToolDefinition, baseDir: string | undefined): string {
  const out = tool.out!;
  const parts: string[] = [];
  if (out.name.includes('{host}')) parts.push("<host> is the site's host without www or the port");
  for (const [, name] of out.name.matchAll(/\{stem:(\w+)\}/g)) parts.push(`<${name}-name> is the name of ${name} without its extension`);
  for (const [, name] of out.name.matchAll(/\{dir:(\w+)\}/g)) parts.push(`<${name}-folder> is the folder ${name} is in`);
  let help = `Folder to save into, absolute or relative to ${baseDir ?? BASE_DIR_IN_WORDS}. Default: ${templateInWords(out.name)}${parts.length ? `, where ${inWords(parts)}` : ''}.`;
  // The screenshot kit tells its screenshots and its demos apart, so the earlier run is this tool's.
  if (out.ownOnly) {
    // These kits clear the folder as they start, so a run that then fails has cleared it too.
    help += ' A run deletes what an earlier run of this tool left there as it starts, so one that fails loses it too: give each version its own out_dir.'
      + ' The folder must be empty or hold an earlier run of this tool: any other folder stops it.';
  } else if (!tool.check) {
    // A check writes only its report; the other kits replace their earlier files once they have new ones.
    help += ' A run replaces the files an earlier run of this kit left there, so give each version its own out_dir.';
  }
  if (out.otherwise) help += ` Given a file instead of an address, the kit saves in ${inPlainWords(out.otherwise)} and takes no out_dir.`;
  for (const [name, kind] of Object.entries(out.replaces ?? {})) {
    // A kit that deletes the folder for some addresses only makes it again where it is for the others.
    const when = kind.addresses
      ? ` ${[kind.from ? `when given ${kind.from}` : '', `for ${kind.addresses.about}`].filter(Boolean).join(', or ')}`
      : '';
    help += ` The kit deletes the ${name}/ folder in it and makes it again${when}, so it does not start${when ? ' then' : ''} while that folder holds a file other than a kit's own that would be lost.`;
    if (kind.addresses && kind.names !== undefined) {
      help += ` Otherwise it makes the kit in ${name}/ again where it is, so it does not start while ${name}/ holds a file named like a kit's own, in any letter case, that its ${kind.marker} does not list.`;
    }
    if (kind.from) help += ` To use that ${name}/ folder where it is, give ${kind.from} as out_dir with /${name} added, written the same way.`;
  }
  return help;
}

/** The topic that says which request each tool the server lists fits, which every server offers. */
const STARTED_TOPIC = 'getting-started';

/**
 * A kit tool's description as the client gets it: when to use it in the user's words
 * (asks), what it makes (the kit file's description, or hostedDescription on a hosted
 * server), the topic that has the whole job, and last the kit, its version and where it runs.
 * A tool whose own topic the server does not offer, like analyze_music while fit_music is
 * held back, points to getting-started, which lists what it fits then.
 */
export function kitToolDescription(context: ToolContext, kit: AvailableKit, tool: ToolDefinition): string {
  const hosted = context.backend.where === 'hosted';
  const place = context.text.place;
  const parts: string[] = [];
  if (tool.asks) parts.push(`Use it when the user wants ${kitText(tool.asks, context, `${tool.name}.asks`)}.`);
  parts.push(kitText(hosted && tool.hostedDescription ? tool.hostedDescription : tool.description, context, tool.name));
  if (tool.playbook && context.topics.has(tool.playbook)) parts.push(`The ${tool.playbook} playbook (${PLAYBOOK_TOOL}) has the whole job.`);
  else if (tool.playbook && context.topics.has(STARTED_TOPIC)) parts.push(`The ${STARTED_TOPIC} playbook (${PLAYBOOK_TOOL}) says which requests it fits here.`);
  parts.push(`(${kit.definition.kit} ${kit.version}, ${place}.)`);
  return parts.join(' ');
}

/** A message with any placeholders of the kits' texts filled, or as it is when one cannot be. */
function filledMessage(message: string, context: ToolContext): string {
  try {
    return fillText(message, context.text, { kind: 'kit', keepUnknown: true });
  } catch {
    return message;
  }
}

/** What a result needs to say what comes next, for a job of this tool. */
function resultContext(context: ToolContext, entry: RegisteredKitTool | undefined): ResultContext {
  return { text: context.text, topics: context.topics, listed: context.tools, ...(entry ? { kit: entry.kit.definition, tool: entry.tool } : {}) };
}

export function registerKitTool(server: McpServer, context: ToolContext, kit: AvailableKit, tool: ToolDefinition): void {
  const { backend } = context;
  const hosted = backend.where === 'hosted';
  const inputSchema: Record<string, z.ZodType> = {};
  for (const [name, param] of Object.entries(tool.params)) {
    // A local parameter, like keep, means nothing where each job's work files are swept away.
    if (hosted && param.where === 'local') continue;
    inputSchema[name] = paramSchema(tool, name, param, context);
  }
  if (tool.out?.flag && !hosted) {
    inputSchema['out_dir'] = z.string().min(1).optional().describe(outDirHelp(tool, context.baseDir));
  }
  inputSchema['wait_seconds'] = waitSeconds(context);
  const numbers = Object.entries(tool.params).filter(([, param]) => takesNumber(param)).map(([name]) => name);
  // Hosted, a call with an argument only a local server takes is told why it is not taken here.
  const hints: Record<string, string> = {};
  if (hosted) {
    hints['out_dir'] = 'Each job here saves in a folder of its own, so no tool here takes `out_dir`.';
    for (const [name, param] of Object.entries(tool.params)) {
      if (param.where !== 'local') continue;
      hints[name] = param.hostedDefault !== undefined
        ? `Every call here has \`${name}\` ${typeof param.hostedDefault === 'string' ? JSON.stringify(param.hostedDefault) : String(param.hostedDefault)}.`
        : `Only makersmcp on the user's own machine takes \`${name}\`.`;
    }
  }
  const entry = { kit, tool };
  context.tools.set(tool.name, entry);
  // A Next sentence that cannot be filled stops the server, as a description does.
  checkNextLines(tool, resultContext(context, entry));

  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: kitToolDescription(context, kit, tool),
      inputSchema: strictInput(inputSchema, { nothing: 'Nothing was started.', hints }),
      outputSchema: jobOutputSchema,
      annotations: {
        title: tool.title,
        readOnlyHint: tool.readOnly === true,
        // destructive is about the local folder: a hosted job writes a folder of its own, and
        // one that takes an earlier job's files works on a copy of them.
        destructiveHint: !hosted && tool.destructive === true,
        idempotentHint: tool.readOnly === true,
        openWorldHint: hosted
          || Object.values(tool.params).some(param => param.type === 'url' || param.type === 'url_or_path'),
      },
    },
    async (input: Record<string, unknown>, extra: Extra) => {
      // wait_seconds counts from here, the start included: a hosted start can take seconds, and a
      // client that ends a call after 60 seconds would otherwise lose one that waited 45 after it.
      const calledAt = Date.now();
      // A call the client cancelled before it got here starts nothing: no answer would reach it.
      if (extra.signal.aborted) return errorResult(`## ${tool.title}: not started\n\nThe call was cancelled before its job started, so nothing was started.`);
      const { wait_seconds: wait, ...args } = input;
      // A local parameter with a hosted default is no parameter of the tool here, and every call has that value, like jobs 1 for a launch film.
      if (hosted) for (const [name, param] of Object.entries(tool.params)) if (param.where === 'local' && param.hostedDefault !== undefined) args[name] = param.hostedDefault;
      // The kit, and a hosted service, check text: a number given for one is written as text.
      for (const name of numbers) if (typeof args[name] === 'number') args[name] = String(args[name]);
      let view: JobView;
      try {
        view = await backend.start({ kit, tool, input: args });
      } catch (error) {
        // A local refusal may quote a parameter's text, whose placeholders are filled here too.
        if (error instanceof NotStartedError) return errorResult(`## ${tool.title}: not started\n\n${filledMessage(error.message, context)}`);
        throw error;
      }
      if (view.status === 'running') {
        const left = Math.max(0, Number(wait ?? WAIT_SECONDS.default) - (Date.now() - calledAt) / 1000);
        view = (await waitFor(context, view.id, left, extra)) ?? view;
      }
      return jobResult(view, resultContext(context, entry));
    },
  );
}

export function registerCoreTools(server: McpServer, context: ToolContext): void {
  const { backend } = context;
  const local = backend.where === 'local';
  const jobId = z.string().min(1).describe('The job_id a makersmcp tool returned.');
  const unknownJob = (id: string) => errorResult(local
    ? `## No job ${id}\n\nJobs last only while this makersmcp runs. list_jobs shows the ones it has.`
    : `## No job ${id}\n\nlist_jobs shows your jobs.`);
  const result = (view: JobView) => jobResult(view, resultContext(context, context.tools.get(view.tool)));

  server.registerTool(
    'wait_for_job',
    {
      title: 'Wait for a job',
      description: 'Waits for a job a makersmcp tool started and returns its result once it ends. It also returns a finished job\'s result again. '
        + 'If it is still running, call this again with the same job_id. Never start the original tool again to check on a job: that starts a second one. '
        + 'A call that ended with no result may still have started a job: list_jobs shows it.',
      inputSchema: strictInput({ job_id: jobId, wait_seconds: waitSeconds(context) }),
      outputSchema: jobOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ job_id, wait_seconds }, extra) => {
      const view = await waitFor(context, job_id, wait_seconds as number, extra);
      return view ? result(view) : unknownJob(job_id);
    },
  );

  server.registerTool(
    'cancel_job',
    {
      title: 'Cancel a job',
      description: local
        ? 'Stops a running job and the browser or ffmpeg it started. Files it already saved stay where they are.'
        : 'Stops a running job. Files it already saved are not kept.',
      inputSchema: strictInput({ job_id: jobId }, { nothing: 'Nothing was canceled.' }),
      outputSchema: jobOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ job_id }) => {
      const view = await backend.cancel(job_id);
      return view ? result(view) : unknownJob(job_id);
    },
  );

  const again = 'Use it after a call that ended with no result, before starting that tool again: the job may be running.';
  server.registerTool(
    'list_jobs',
    {
      title: 'List jobs',
      description: local
        ? `Lists the jobs makersmcp started since it was launched, running or ended, with their folders. ${again} Jobs end when makersmcp ends, and a finished job's files stay in its folder.`
        : `Lists your recent jobs, running or ended, newest first. ${again}`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      // As a result shows them: a value of another type in a hosted view is left out (shownView).
      const jobs = (await backend.list()).map(shownView);
      const lines = jobs.map(view => `- ${view.id}: ${view.tool}, ${view.status}, ${view.elapsedSeconds} s`
        + (view.folder ? `, ${view.folder}` : ''));
      return {
        content: [{ type: 'text', text: lines.length ? `## Jobs\n\n${lines.join('\n')}` : 'No jobs yet.' }],
        // A count, not each job's files: wait_for_job gives a job's whole result.
        structuredContent: { jobs: jobs.map(jobListed) },
      };
    },
  );

  server.registerTool(
    'check_setup',
    {
      title: 'Check the setup',
      description: local
        ? 'Shows which kits makersmcp has and their versions, the Chrome and the ffmpeg found for them (and ffprobe while launch-film is on), any setting that leads to no program, and where files are saved. Use it when a tool is missing or a kit fails to start. '
          + 'Settings like CHROME_PATH, FFMPEG_PATH and MAKERSMCP_OUT go in this server\'s entry in the MCP client\'s settings, and take effect when the client starts it again.'
        : 'Shows which kits are running and their versions, and how long files are kept. Use it when a tool is missing.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => ({
      content: [{ type: 'text', text: await backend.setupReport({ version: context.version, enabled: context.enabled }) }],
    }),
  );
}
