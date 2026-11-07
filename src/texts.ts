import type { HostedLimits } from './backend.js';
import type { KitDefinition, ParamDefinition, ToolDefinition } from './kits.js';

/**
 * The placeholders of makersmcp's texts: the playbooks, the instructions, and the kit
 * files' descriptions and Next lines. A placeholder is a word in braces, with an argument
 * after a colon for some, like {place} or {fact:launch-film.fps}. Each kind of text takes
 * its own set, and the same code fills them all, so a number stated in a topic and in a
 * description comes from one place.
 */

/** wait_seconds, which every kit tool and wait_for_job take. */
export const WAIT_SECONDS = { min: 0, max: 600, default: 45 } as const;

/** A placeholder, with the unit word written after a limit, which the limit then carries itself. */
const PLACEHOLDER = /\{([a-z_]+)(?::([A-Za-z0-9_./-]+))?\}( (?:seconds?|minutes?|jobs?|days?)\b)?/g;

/** Where a text is used, which decides the placeholders it takes. */
export type TextKind = 'topic' | 'instructions' | 'kit' | 'next';

const EVERYWHERE = new Set(['place', 'fact', 'bounds', 'default', 'version', 'limit']);
const BY_KIND: Record<TextKind, Set<string>> = {
  topic: new Set([...EVERYWHERE, 'base_dir', 'requests', 'flags', 'makes']),
  instructions: new Set([...EVERYWHERE, 'base_dir', 'makes']),
  kit: EVERYWHERE,
  next: new Set([...EVERYWHERE, 'job_id', 'folder', 'topic', 'file', 'name']),
};
/** Placeholders with an argument after a colon. */
const WITH_ARGUMENT = new Set(['fact', 'bounds', 'default', 'version', 'limit', 'file', 'name']);
/** Placeholders a hosted text never takes, and those only a hosted one does. */
export const LOCAL_ONLY = new Set(['base_dir', 'folder']);
export const HOSTED_ONLY = new Set(['limit']);
/** Placeholders that stand alone on their line, since each becomes a list. */
export const ON_THEIR_OWN_LINE = new Set(['requests', 'flags']);

/** A hosted service's limits, and the words that promise nothing when the service does not give one. */
const LIMITS: Record<string, { key: keyof HostedLimits; unit: [string, string]; unknown: string }> = {
  // Words that read right after "at most", "within" and "after".
  max_wait: { key: 'maxWaitSeconds', unit: ['second', 'seconds'], unknown: 'a set time' },
  job_minutes: { key: 'jobMinutes', unit: ['minute', 'minutes'], unknown: 'a set time' },
  jobs_at_once: { key: 'jobsAtOnce', unit: ['job', 'jobs'], unknown: 'a few jobs' },
  jobs_a_day: { key: 'jobsPerDay', unit: ['job', 'jobs'], unknown: 'a set number of jobs' },
  keep_days: { key: 'keepDays', unit: ['day', 'days'], unknown: 'a few days' },
};
export const LIMIT_NAMES = Object.keys(LIMITS);

/** A placeholder found in a text. */
export interface Placeholder {
  name: string;
  arg?: string;
  /** Where it starts in the text. */
  at: number;
  text: string;
}

/** The placeholders in a text, in order. */
export function placeholdersIn(text: string): Placeholder[] {
  return [...text.matchAll(PLACEHOLDER)].map(match => ({
    name: match[1]!,
    ...(match[2] !== undefined ? { arg: match[2] } : {}),
    at: match.index!,
    text: match[0].slice(0, match[0].length - (match[3]?.length ?? 0)),
  }));
}

/**
 * What is wrong with a placeholder in a text of this kind, in words, or nothing. Only the
 * form is checked here: whether a fact or a tool exists is known once the kits are.
 */
export function placeholderProblem(placeholder: Pick<Placeholder, 'name' | 'arg'>, kind: TextKind): string | undefined {
  const { name, arg } = placeholder;
  const shown = `{${name}${arg !== undefined ? `:${arg}` : ''}}`;
  if (!BY_KIND[kind].has(name)) {
    const known = [...BY_KIND[kind]].map(entry => (WITH_ARGUMENT.has(entry) ? `{${entry}:...}` : `{${entry}}`)).join(', ');
    return `${shown} is not a placeholder here; the placeholders are ${known}. Write a name's variable part as <like-this>`;
  }
  if (WITH_ARGUMENT.has(name) !== (arg !== undefined)) {
    return WITH_ARGUMENT.has(name) ? `${shown} needs what it names after a colon, like {${name}:...}` : `${shown} takes nothing after a colon`;
  }
  if (arg === undefined) return undefined;
  switch (name) {
    case 'limit':
      return LIMITS[arg] ? undefined : `${shown}: the limits are ${LIMIT_NAMES.join(', ')}`;
    case 'fact':
      return /^[a-z0-9-]+\.[a-z][a-z0-9_]*(?:\.[a-z0-9][a-z0-9_]*)?$/.test(arg) ? undefined : `${shown} is written {fact:<kit>.<key>}, or {fact:<kit>.<key>.<key>}`;
    case 'bounds':
    case 'default':
      return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(arg) ? undefined : `${shown} is written {${name}:<tool>.<parameter>}`;
    case 'version':
      return /^[a-z0-9-]+$/.test(arg) ? undefined : `${shown} is written {version:<kit>}`;
    default:
      return undefined;
  }
}

/**
 * Whether a placeholder starts a sentence of its text: at its start or a line's, after a
 * list's mark, or after a sentence's end.
 */
export function startsSentence(text: string, at: number): boolean {
  const before = text.slice(0, at);
  return /(?:^|\n)[ \t]*(?:(?:[-*]|\d+\.)[ \t]+)?$/.test(before) || /[.!?][ \t]+$/.test(before);
}

/**
 * What is wrong with where a placeholder stands, or nothing: a limit at the start of a
 * sentence would start it with "a few jobs" on a service that gives none.
 */
export function placeProblem(placeholder: Placeholder, text: string): string | undefined {
  if (placeholder.name === 'limit' && startsSentence(text, placeholder.at)) {
    return `${placeholder.text} starts a sentence, which then reads "${LIMITS[placeholder.arg!]?.unknown ?? 'a few'}" on a service that gives no limits: start it with other words, like "At most"`;
  }
  return undefined;
}

/** The problems with the placeholders of one text, each in words. With `where`, the side the text is for. */
export function textProblems(text: string, kind: TextKind, where?: 'local' | 'hosted'): string[] {
  const problems: string[] = [];
  for (const placeholder of placeholdersIn(text)) {
    const problem = placeholderProblem(placeholder, kind) ?? placeProblem(placeholder, text);
    if (problem) problems.push(problem);
    else if (where === 'local' && HOSTED_ONLY.has(placeholder.name)) problems.push(`${placeholder.text} is for a hosted text only`);
    else if (where === 'hosted' && LOCAL_ONLY.has(placeholder.name)) problems.push(`${placeholder.text} is for a local text only`);
  }
  return problems;
}

/** What the placeholders of the kits' texts and of the playbooks are filled from. */
export interface TextContext {
  where: 'local' | 'hosted';
  /** Where jobs run, like "on this machine" or "on makersmcp.com". */
  place: string;
  /** The local backend's folder. */
  baseDir?: string;
  /**
   * Every kit this server knows, on or off, each with all its tools, the ones the server
   * does not list too, so a text can still fill a default of such a tool and leave out
   * what names it.
   */
  definitions: KitDefinition[];
  /** The kits that are on. */
  enabled: Set<string>;
  /** The kit tools the server lists. Without it, every tool of a kit that is on. */
  listed?: Set<string>;
  /** The version each kit the backend can run is at. */
  versions: Map<string, string>;
  /** A hosted service's limits. */
  limits?: HostedLimits;
}

/** A placeholder that cannot be filled, like a fact a kit does not have. */
export class TextError extends Error {}

/** {base_dir} for a local backend that does not say where it saves. */
export const BASE_DIR_IN_WORDS = 'the folder the kits save in';

/** The kit tools the server lists: the context's, or every tool of a kit that is on. */
export function listedTools(context: TextContext): Set<string> {
  if (context.listed) return context.listed;
  return new Set(context.definitions.filter(kit => context.enabled.has(kit.kit)).flatMap(kit => kit.tools.map(tool => tool.name)));
}

/** What a with or without block and a topic's requires can name: the kits that are on and the tools the server lists. */
export function onNames(context: TextContext): Set<string> {
  return new Set([...context.enabled, ...listedTools(context)]);
}

/** The kit tools the server knows and does not list, as their kits are off or a service holds them back. */
export function unlistedTools(context: TextContext): string[] {
  const listed = listedTools(context);
  return context.definitions.flatMap(kit => kit.tools.map(tool => tool.name)).filter(name => !listed.has(name));
}

/** Whether a text names one of these tools, as a word of its own. */
export function namesTool(text: string, tools: string[]): boolean {
  return tools.some(name => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(text));
}

/** A text's sentences: it is cut after each . ! or ? that a space follows, so 29.333 and fitted.wav stay whole. */
export function sentencesOf(text: string): string[] {
  return text.trim().split(/(?<=[.!?])\s+(?=\S)/);
}

/**
 * A kit's text without the sentences that name a tool the server does not list, like "For
 * font files, use make_font_kit instead." with easyfontkit off, so a description never
 * points at a tool that is not there.
 */
export function withoutUnlisted(text: string, context: TextContext): string {
  const absent = unlistedTools(context);
  if (!absent.length || !namesTool(text, absent)) return text;
  return sentencesOf(text).filter(sentence => !namesTool(sentence, absent)).join(' ');
}

/** Items in words: a, b and c, or with `or`, a, b or c. */
export function inWords(items: string[], last = 'and'): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}

/** A kit tool by name, among every kit this server knows. */
export function findTool(definitions: KitDefinition[], name: string): { kit: KitDefinition; tool: ToolDefinition } | undefined {
  for (const kit of definitions) {
    const tool = kit.tools.find(entry => entry.name === name);
    if (tool) return { kit, tool };
  }
  return undefined;
}

/**
 * A folder name template in words, the way a name's variable part is written in the texts:
 * easybrandkit-{host} is easybrandkit-<host>, musicfit-{stem:track} musicfit-<track-name>
 * and {dir:film}/check <film-folder>/check.
 */
export function templateInWords(template: string): string {
  return template
    .replace(/\{dir:(\w+)\}/g, '<$1-folder>')
    .replace(/\{stem:(\w+)\}/g, '<$1-name>')
    .replace(/\{host\}/g, '<host>');
}

function factValue(definitions: KitDefinition[], arg: string): string {
  const [kitName, key, sub] = arg.split('.') as [string, string, string | undefined];
  const kit = definitions.find(entry => entry.kit === kitName);
  if (!kit) throw new TextError(`{fact:${arg}}: there is no kit ${kitName}`);
  const value = kit.facts?.[key];
  const leaf = sub === undefined ? value : value !== null && typeof value === 'object' ? value[sub] : undefined;
  if (typeof leaf !== 'number' && typeof leaf !== 'string') {
    throw new TextError(`{fact:${arg}}: ${kitName} has no fact ${sub === undefined ? key : `${key}.${sub}`}${leaf !== undefined ? ' that is a number or a text' : ''}`);
  }
  return String(leaf);
}

/** A tool's parameter as the texts know it, wait_seconds and out_dir too. */
function paramOf(definitions: KitDefinition[], arg: string, placeholder: string): { tool?: ToolDefinition; name: string; param?: ParamDefinition } {
  const [toolName, name] = arg.split('.') as [string, string];
  if (name === 'wait_seconds' && (toolName === 'wait_for_job' || findTool(definitions, toolName))) return { name };
  const found = findTool(definitions, toolName);
  if (!found) throw new TextError(`{${placeholder}:${arg}}: there is no tool ${toolName}`);
  if (name === 'out_dir') {
    if (!found.tool.out?.flag) throw new TextError(`{${placeholder}:${arg}}: ${toolName} takes no out_dir`);
    return { tool: found.tool, name };
  }
  const param = found.tool.params[name];
  if (!param) throw new TextError(`{${placeholder}:${arg}}: ${toolName} has no parameter ${name}`);
  return { tool: found.tool, name, param };
}

function boundsOf(definitions: KitDefinition[], arg: string): string {
  const { name, param } = paramOf(definitions, arg, 'bounds');
  if (name === 'wait_seconds') return `${WAIT_SECONDS.min} to ${WAIT_SECONDS.max}`;
  if (param && (param.type === 'integer' || param.type === 'number') && param.min !== undefined && param.max !== undefined) {
    return `${param.min} to ${param.max}`;
  }
  if (param?.values?.length) return inWords(param.values, 'or');
  throw new TextError(`{bounds:${arg}}: ${name} has no bounds`);
}

function defaultOf(definitions: KitDefinition[], arg: string): string {
  const { tool, name, param } = paramOf(definitions, arg, 'default');
  if (name === 'wait_seconds') return String(WAIT_SECONDS.default);
  if (name === 'out_dir') return templateInWords(tool!.out!.name);
  const value = param?.default;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every(item => typeof item === 'string' || typeof item === 'number')) return inWords(value.map(String));
  throw new TextError(`{default:${arg}}: ${name} has no default in its kit file`);
}

function limitOf(context: TextContext, name: string): string {
  if (context.where !== 'hosted') throw new TextError(`{limit:${name}} is for a hosted text only`);
  const limit = LIMITS[name]!;
  const value = context.limits?.[limit.key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return limit.unknown;
  return `${value} ${value === 1 ? limit.unit[0] : limit.unit[1]}`;
}

export interface FillOptions {
  kind: TextKind;
  /** Fills the placeholders only some texts take, like {requests} or {file:...}; undefined leaves it to the common ones. */
  extra?: (placeholder: Placeholder) => string | undefined;
  /** Leave a placeholder that is not one of this kind as it is, as code may hold one. */
  keepUnknown?: boolean;
}

/**
 * The text with its placeholders filled. A limit renders with its unit, like "50 seconds",
 * or in words that promise nothing when the service gives none, so the unit word a writer
 * puts after one is taken into it: {limit:max_wait} and {limit:max_wait} seconds read the same.
 */
export function fillText(text: string, context: TextContext, options: FillOptions): string {
  return text.replace(PLACEHOLDER, (whole: string, name: string, arg: string | undefined, unit: string | undefined, at: number) => {
    const placeholder: Placeholder = { name, ...(arg !== undefined ? { arg } : {}), at, text: whole.slice(0, whole.length - (unit?.length ?? 0)) };
    const after = unit ?? '';
    if (placeholderProblem(placeholder, options.kind)) {
      if (options.keepUnknown) return whole;
      throw new TextError(placeholderProblem(placeholder, options.kind)!);
    }
    const filled = options.extra?.(placeholder);
    if (filled !== undefined) return filled + after;
    switch (name) {
      case 'place':
        return context.place + after;
      case 'base_dir':
        if (context.where !== 'local') throw new TextError('{base_dir} is for a local text only');
        // A local backend need not say where it saves.
        return (context.baseDir ?? BASE_DIR_IN_WORDS) + after;
      case 'fact':
        return factValue(context.definitions, arg!) + after;
      case 'bounds':
        return boundsOf(context.definitions, arg!) + after;
      case 'default':
        return defaultOf(context.definitions, arg!) + after;
      case 'version': {
        const version = context.versions.get(arg!);
        if (!version) throw new TextError(`{version:${arg}}: ${arg} is not running here`);
        return version + after;
      }
      case 'limit': {
        const units = LIMITS[arg!]!.unit;
        if (unit && !units.includes(unit.trim())) {
          throw new TextError(`{limit:${arg}} renders with its unit, ${units[1]}, so the${unit} after it is one too many`);
        }
        // The unit is in the words already: "{limit:max_wait} seconds" is "50 seconds".
        return limitOf(context, arg!);
      }
      case 'makes':
        return makesText(context);
      case 'flags':
        return flagsText(context);
      default:
        throw new TextError(`{${name}} cannot be filled here`);
    }
  });
}

/**
 * What the kits that are on make, joined: a website's brand kit, ... and music fitted to a
 * video. A kit's own phrases count while it is on, a tool's while the server lists it.
 */
export function makesText(context: TextContext): string {
  const listed = listedTools(context);
  const phrases = context.definitions.filter(kit => context.enabled.has(kit.kit))
    .flatMap(kit => [...(kit.makes ?? []), ...kit.tools.filter(tool => listed.has(tool.name)).flatMap(tool => tool.makes ?? [])]);
  return phrases.length ? inWords([...new Set(phrases)]) : 'files';
}

/** A kit with only the tools the server lists, for the texts made from its tools. */
export function listedKit(kit: KitDefinition, context: TextContext): KitDefinition {
  const listed = listedTools(context);
  return kit.tools.every(tool => listed.has(tool.name)) ? kit : { ...kit, tools: kit.tools.filter(tool => listed.has(tool.name)) };
}

/**
 * A kit's flags and the parameters they stand for, for rewriting what the kit says in the
 * words of its tools: --out is out_dir, --timeout timeout_seconds, --no-music "music false"
 * and --facts "facts true". The tool given comes first, for a flag two tools read apart.
 */
export function flagWords(kit: KitDefinition, first?: ToolDefinition, where: 'local' | 'hosted' = 'local'): Map<string, string> {
  const words = new Map<string, string>();
  const tools = first ? [first, ...kit.tools.filter(tool => tool !== first)] : kit.tools;
  // A hosted server takes no out_dir and no local parameter, so their flags stay as the kit wrote them there.
  const hosted = where === 'hosted';
  for (const tool of tools) {
    if (tool.out?.flag && !hosted && !words.has(tool.out.flag)) words.set(tool.out.flag, 'out_dir');
    for (const [name, param] of Object.entries(tool.params)) {
      if (!param.flag || words.has(param.flag) || (hosted && param.where === 'local')) continue;
      words.set(param.flag, param.type === 'boolean' ? `${name} ${param.when === false ? 'false' : 'true'}` : name);
    }
  }
  return words;
}

/**
 * A line for each flag of the kits that are on whose parameter has another name, like
 * --out for out_dir or --no-music for "music false", then one sentence for the rest, each
 * the parameter of its own name. A flag two kits read apart is listed with both.
 */
export function flagsText(context: TextContext): string {
  const lines = new Map<string, Set<string>>();
  const same = new Set<string>();
  let example: [string, string] | undefined;
  let dashed = false;
  for (const kit of context.definitions.filter(entry => context.enabled.has(entry.kit))) {
    for (const [flag, words] of flagWords(listedKit(kit, context), undefined, context.where)) {
      const line = `\`${flag}\` is ${words.includes(' ') ? words.replace(/^(\w+)/, '`$1`') : `\`${words}\``}`;
      if (words === flag.slice(2).replace(/-/g, '_')) {
        same.add(line);
        example ??= [flag, words];
        dashed ||= flag.slice(2).includes('-');
      }
      if (!lines.has(line)) lines.set(line, new Set());
      lines.get(line)!.add(kit.kit);
    }
  }
  const flagOf = (line: string) => line.split(' ')[0]!;
  const many = new Set([...lines.keys()].map(flagOf).filter((flag, i, all) => all.indexOf(flag) !== i));
  const listed = [...lines.entries()]
    .filter(([line]) => !same.has(line) || many.has(flagOf(line)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([line, kits]) => `- ${line}${many.has(flagOf(line)) ? ` (${inWords([...kits])})` : ''}`);
  const rest = example
    ? `${listed.length ? 'Every other' : 'Each'} flag is the parameter of the same name${dashed ? ', with _ for each -' : ''}, like \`${example[0]}\` for \`${example[1]}\`.`
    : '';
  return [listed.join('\n'), rest].filter(Boolean).join('\n\n');
}

/**
 * Text a kit wrote, like its summary or FIT.md, with its flags written as the parameters
 * of its tools: "give --timeout more seconds" is "give timeout_seconds more seconds". A
 * flag in double quotes is left as it is, as in a list of the arguments the kit was given.
 */
export function inParameterWords(text: string, words: Map<string, string>): string {
  if (!words.size || !text.includes('--')) return text;
  return text.replace(/(?<![\w"-])--[a-z][a-z0-9-]*(?![\w"-])/g, flag => words.get(flag) ?? flag);
}
