import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { TOPIC_NAME } from './kits.js';
import {
  fillText,
  HOSTED_ONLY,
  inWords,
  listedTools,
  LOCAL_ONLY,
  onNames,
  ON_THEIR_OWN_LINE,
  placeholderProblem,
  placeholdersIn,
  placeProblem,
  textProblems,
  TextError,
  type Placeholder,
  type TextContext,
  type TextKind,
} from './texts.js';

/**
 * The playbooks: one Markdown file per topic in playbooks/, each the whole of one kind
 * of job, read by the model through makersmcp_playbook and as resources. A topic has its
 * frontmatter between --- lines, then Markdown with blocks for one side or for the kits
 * that are on or off:
 *
 *   <!-- local --> ... <!-- end -->          only on this machine
 *   <!-- hosted --> ... <!-- end -->         only on a hosted server
 *   <!-- with launch-film --> ... <!-- end -->     only while that kit is on
 *   <!-- without launch-film --> ... <!-- end -->  only while it is off
 *   <!-- with check_video --> ... <!-- end -->     only while the server lists that tool
 *   <!-- with easybrandkit, easyfontkit --> ... <!-- end -->  while any of them is on;
 *                                            without, while none is
 *
 * and placeholders from a fixed list (texts.ts), so one file serves every side and every
 * set of kits. playbooks/_instructions.md is the server's instructions, made the same way.
 * Every file is read and checked once per process; renderings are kept per side, kits
 * and limits, since a hosted service builds a server for every request.
 */

export const PLAYBOOKS_DIR = fileURLToPath(new URL('../playbooks/', import.meta.url));
export const PLAYBOOK_TOOL = 'makersmcp_playbook';
export const INSTRUCTIONS_FILE = '_instructions.md';
/** The most topics one call reads, so the three largest stay inside a client's result limit together. */
export const TOPICS_A_CALL = 3;
const MAX_INDEX = 120;
const MAX_DESCRIPTION = 1024;
/** Blocks go two deep at most: a side, and a kit inside it, or the other way round. */
const MAX_DEPTH = 2;
const KIT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A kit tool's name, which a block and a topic's requires can name as they name a kit. */
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const isName = (name: string) => KIT_ID.test(name) || TOOL_NAME.test(name);
const KEYS = ['name', 'title', 'index', 'description', 'kit', 'requires', 'any', 'optional', 'order'] as const;
const LIST_KEYS = new Set(['requires', 'any', 'optional']);
const REQUIRED_KEYS = ['name', 'title', 'index', 'description', 'kit', 'order'];
/**
 * Jobs of more than one step the index names as examples, each while its topic is offered, so a
 * held tool's job, like music fitted to a video while fit_music is held back, or a launch film
 * while launch-film's film tools are, is never one.
 */
const EXAMPLE_JOBS: Array<[string, string]> = [['launch-film', 'a launch film'], ['music', 'music fitted to a video'], ['launch-kit', 'a launch kit']];

/**
 * The head of makersmcp_playbook's description: what a topic holds, and that a job of more than
 * one step reads its topic, and waits for it, before any other call, since a client may send a
 * kit tool's call beside the playbook's and choose it without the topic.
 */
function indexHead(offered: Topic[]): string {
  const jobs = EXAMPLE_JOBS.filter(([name]) => offered.some(topic => topic.name === name)).map(([, job]) => job);
  const like = jobs.length ? `, like ${inWords(jobs, 'or')}` : '';
  return "Returns MakersMCP's playbooks. Each covers one kind of job for the kits on this server: the order of calls, "
    + `the arguments that matter, what to check and what to hand over. Before a job with more than one step${like}, `
    + "or when unsure which tool fits a request, read its topic and wait for it before any other call: the topic can change the job's first call. "
    + 'Each topic is complete for its job, and up to three can be read in one call. Topics:';
}

/** A playbook file that cannot be used, with where and why. */
export class PlaybookError extends Error {}

/** A block's condition: a side, or kits that are on or off and tools the server lists or not, any of them for with. */
type Condition = { kind: 'local' | 'hosted' } | { kind: 'with' | 'without'; names: string[] };

interface Line {
  line: number;
  text: string;
  /** In a fenced code block, fence lines included. */
  code: boolean;
}

interface Block {
  condition?: Condition;
  line: number;
  items: Array<Line | Block>;
}

export interface Topic {
  name: string;
  title: string;
  /** Its line in makersmcp_playbook's description. */
  index: string;
  /** What it is for, the resource's description now and a skill's later. */
  description: string;
  /** The kit that owns it, or makersmcp for one across kits. */
  kit: string;
  /** Kits that must all be on, and tools the server must list, for it to be offered. */
  requires: string[];
  /**
   * Kits and tools of which one must be on or listed, when any are named, like the film tools that
   * launch-film and launch-kit need, which a service may hold back while the kit is on.
   */
  any: string[];
  /** Kits and tools the text has with or without blocks for. */
  optional: string[];
  /** Its place in the index. */
  order: number;
  file: string;
  body: Block;
}

export interface Playbooks {
  dir: string;
  /** In their order in the index. */
  topics: Topic[];
  instructions: Block;
  instructionsFile: string;
}

const loaded = new Map<string, Playbooks>();

/**
 * Every playbook in a folder, playbooks/ by default, read and checked once per process:
 * the frontmatter's keys and lengths, the block markers, and that each placeholder is one
 * of the list and stands where its side allows it. A file that breaks a rule is an error
 * that names it, its line and the rule.
 */
export function loadPlaybooks(dir: string = PLAYBOOKS_DIR): Playbooks {
  const resolved = path.resolve(dir);
  const known = loaded.get(resolved);
  if (known) return known;
  if (!existsSync(resolved)) throw new PlaybookError(`There is no playbooks folder at ${resolved}`);
  const files = readdirSync(resolved).filter(file => file.endsWith('.md')).sort();
  if (!files.includes(INSTRUCTIONS_FILE)) throw new PlaybookError(`${path.join(resolved, INSTRUCTIONS_FILE)} is missing: it holds the server's instructions`);
  const topics: Topic[] = [];
  for (const file of files) {
    if (file === INSTRUCTIONS_FILE) continue;
    if (file.startsWith('_')) throw new PlaybookError(`${file}: only ${INSTRUCTIONS_FILE} starts with _; a topic is named for what it covers`);
    topics.push(parseTopic(path.join(resolved, file), readFileSync(path.join(resolved, file), 'utf8')));
  }
  topics.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  const instructionsFile = path.join(resolved, INSTRUCTIONS_FILE);
  const text = readFileSync(instructionsFile, 'utf8');
  if (/^---\s*$/m.test(text.split('\n')[0] ?? '')) throw new PlaybookError(`${INSTRUCTIONS_FILE}:1: the instructions have no frontmatter`);
  const playbooks = { dir: resolved, topics, instructions: parseBody(text, INSTRUCTIONS_FILE, 1, 'instructions'), instructionsFile };
  loaded.set(resolved, playbooks);
  return playbooks;
}

function unquoted(value: string): string {
  const match = /^(["'])(.*)\1$/.exec(value);
  return match ? match[2]! : value;
}

function parseTopic(file: string, text: string): Topic {
  const base = path.basename(file);
  const name = path.basename(file, '.md');
  const fail = (line: number | undefined, message: string): never => {
    throw new PlaybookError(`${base}${line ? `:${line}` : ''}: ${message}`);
  };
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
  if (lines[0]?.trim() !== '---') fail(1, 'a topic starts with its frontmatter between --- lines');
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) fail(1, 'the frontmatter has no closing --- line');

  const fields: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const match = /^([a-z_]+):(?:\s+(.*))?$/.exec(line.trimEnd());
    if (!match) fail(i + 1, 'each frontmatter line is key: value, with lists as [a, b]');
    const key = match![1]!;
    if (!(KEYS as readonly string[]).includes(key)) fail(i + 1, `${key} is not a frontmatter key; the keys are ${KEYS.join(', ')}`);
    if (key in fields) fail(i + 1, `${key} is given twice`);
    fields[key] = unquoted((match![2] ?? '').trim());
  }
  for (const key of REQUIRED_KEYS) if (!fields[key]) fail(undefined, `the frontmatter needs ${key}`);
  if (fields['name'] !== name) fail(undefined, `name is ${fields['name']}, and it must be the file's name, ${name}`);
  if (!TOPIC_NAME.test(name)) fail(undefined, 'a topic\'s name is lowercase letters, digits and hyphens');
  if (fields['index']!.length > MAX_INDEX) fail(undefined, `index is ${fields['index']!.length} characters, over ${MAX_INDEX}`);
  if (fields['description']!.length > MAX_DESCRIPTION) fail(undefined, `description is ${fields['description']!.length} characters, over ${MAX_DESCRIPTION}`);
  if (!KIT_ID.test(fields['kit']!)) fail(undefined, `kit ${fields['kit']} is not a kit's id`);
  const order = Number(fields['order']);
  if (!Number.isFinite(order)) fail(undefined, `order is a number, not ${fields['order']}`);
  for (const key of ['title', 'index', 'description']) {
    const problem = textProblems(fields[key]!, 'kit', 'local')[0];
    if (problem) fail(undefined, `${key}: ${problem}`);
  }

  const list = (key: string): string[] => {
    const value = fields[key];
    if (value === undefined || value === '') return [];
    const match = /^\[(.*)\]$/.exec(value);
    if (!match) fail(undefined, `${key} is a list, like [launch-film, musicfit]`);
    const items = match![1]!.split(',').map(item => unquoted(item.trim())).filter(Boolean);
    for (const item of items) if (!isName(item)) fail(undefined, `${key}: ${item} is not a kit's id or a tool's name`);
    return items;
  };
  const requires = list('requires');
  const any = list('any');
  const optional = list('optional');

  const bodyText = lines.slice(end + 1).join('\n');
  const body = parseBody(bodyText, base, end + 2, 'topic');
  const listed = new Set([...requires, ...any, ...optional]);
  for (const [name, kind, line] of blockNames(body)) {
    if (!listed.has(name)) fail(line, `<!-- ${kind} ${name} --> names a kit or a tool the frontmatter does not list: add it to optional`);
    if (kind === 'without' && requires.includes(name)) fail(line, `<!-- without ${name} --> never shows, since the topic requires ${name}`);
  }
  const first = bodyText.split('\n').find(line => line.trim());
  if (first?.startsWith('# ') && first.trim() !== `# ${fields['title']}`) fail(end + 2, `the heading is not the title, # ${fields['title']}`);

  return {
    name,
    title: fields['title']!,
    index: fields['index']!,
    description: fields['description']!,
    kit: fields['kit']!,
    requires,
    any,
    optional,
    order,
    file,
    body,
  };
}

/** The kits and tools a block's with and without markers name, with the line of each. */
function blockNames(block: Block): Array<[string, 'with' | 'without', number]> {
  const found: Array<[string, 'with' | 'without', number]> = [];
  for (const item of block.items) {
    if (!('items' in item)) continue;
    if (item.condition && 'names' in item.condition) {
      for (const name of item.condition.names) found.push([name, item.condition.kind, item.line]);
    }
    found.push(...blockNames(item));
  }
  return found;
}

/** The parts of a line inside `code` spans, as [start, end) pairs. */
function codeSpans(text: string): Array<[number, number]> {
  return [...text.matchAll(/(`+)(?:(?!\1)[\s\S])*?\1/g)].map(match => [match.index!, match.index! + match[0].length]);
}

function parseBody(text: string, file: string, firstLine: number, kind: TextKind): Block {
  const root: Block = { line: firstLine, items: [] };
  const open: Block[] = [root];
  const fail = (line: number, message: string): never => {
    throw new PlaybookError(`${file}:${line}: ${message}`);
  };
  const within = (kindOf: Condition['kind']) => open.some(block => block.condition?.kind === kindOf);
  let fence: { char: string; size: number; line: number } | undefined;

  const checkPlaceholders = (text: string, line: number, code: boolean) => {
    const spans = code ? [] : codeSpans(text);
    for (const placeholder of placeholdersIn(text)) {
      const inCode = code || spans.some(([start, end]) => placeholder.at >= start && placeholder.at < end);
      const problem = placeholderProblem(placeholder, kind);
      if (problem) {
        // Code may hold braces of its own, like a template in an example.
        if (inCode) continue;
        fail(line, problem);
      }
      const misplaced = placeProblem(placeholder, text);
      if (misplaced) fail(line, misplaced);
      if (LOCAL_ONLY.has(placeholder.name) && !within('local')) fail(line, `${placeholder.text} goes inside a <!-- local --> block`);
      if (HOSTED_ONLY.has(placeholder.name) && !within('hosted')) fail(line, `${placeholder.text} goes inside a <!-- hosted --> block`);
      if (ON_THEIR_OWN_LINE.has(placeholder.name) && text.trim() !== placeholder.text) fail(line, `${placeholder.text} stands alone on its line`);
    }
  };

  text.split('\n').forEach((raw, i) => {
    const line = firstLine + i;
    const textLine = raw.replace(/\r$/, '');
    const block = open[open.length - 1]!;
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(textLine);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.size) fence = undefined;
      checkPlaceholders(textLine, line, true);
      block.items.push({ line, text: textLine, code: true });
      return;
    }
    const opening = /^\s*(`{3,}|~{3,})(.*)$/.exec(textLine);
    if (opening) {
      fence = { char: opening[1]![0]!, size: opening[1]!.length, line };
      block.items.push({ line, text: textLine, code: true });
      return;
    }
    const marker = /^\s*<!--(.*?)-->\s*$/.exec(textLine);
    if (marker) {
      const words = marker[1]!.trim();
      if (words === 'end') {
        if (open.length === 1) fail(line, '<!-- end --> closes no block');
        open.pop();
        return;
      }
      const nameMarker = /^(with|without)\s+(\S.*)$/.exec(words);
      const names = nameMarker ? nameMarker[2]!.split(/\s*,\s*|\s+/).filter(Boolean) : [];
      let condition: Condition;
      if (words === 'local' || words === 'hosted') condition = { kind: words };
      else if (nameMarker && names.every(isName) && new Set(names).size === names.length) condition = { kind: nameMarker[1] as 'with' | 'without', names };
      else return fail(line, `<!-- ${words} --> is not a block marker; the markers are local, hosted, with <kit or tool>, without <kit or tool> (several, with commas, for any of them) and end`);
      if (open.length > MAX_DEPTH) fail(line, `blocks go ${MAX_DEPTH} deep at most`);
      for (const outer of open) {
        const was = outer.condition;
        if (!was) continue;
        if ((was.kind === 'local' || was.kind === 'hosted') && (condition.kind === 'local' || condition.kind === 'hosted')) {
          fail(line, `a ${condition.kind} block inside a ${was.kind} block ${condition.kind === was.kind ? 'adds nothing' : 'never shows'}`);
        }
        if ('names' in was && 'names' in condition && was.names.join() === condition.names.join()) {
          fail(line, `a ${condition.kind} ${condition.names.join(', ')} block inside a ${was.kind} ${was.names.join(', ')} block ${condition.kind === was.kind ? 'adds nothing' : 'never shows'}`);
        }
      }
      const inner: Block = { condition, line, items: [] };
      block.items.push(inner);
      open.push(inner);
      return;
    }
    if (textLine.includes('<!--')) fail(line, 'an HTML comment here would reach the model; only block markers, alone on their line, are taken out');
    checkPlaceholders(textLine, line, false);
    block.items.push({ line, text: textLine, code: false });
  });
  if (fence) fail(fence.line, 'the code block that starts here is not closed');
  if (open.length > 1) fail(open[open.length - 1]!.line, 'the block that starts here has no <!-- end -->');
  return root;
}

function holds(condition: Condition | undefined, context: TextContext, on: Set<string>): boolean {
  if (!condition) return true;
  switch (condition.kind) {
    case 'local':
    case 'hosted':
      return context.where === condition.kind;
    case 'with':
      return condition.names.some(name => on.has(name));
    case 'without':
      return !condition.names.some(name => on.has(name));
  }
}

function select(block: Block, context: TextContext, on: Set<string> = onNames(context), into: Line[] = []): Line[] {
  for (const item of block.items) {
    if ('items' in item) {
      if (holds(item.condition, context, on)) select(item, context, on, into);
    } else {
      into.push(item);
    }
  }
  return into;
}

/**
 * The topics offered: those whose required kits are all on and required tools all listed,
 * with one of any. `on` holds the kits that are on and the tools the server lists, as
 * onNames gives them; a set of kits alone offers no topic that requires a tool.
 */
export function offeredTopics(playbooks: Playbooks, on: Set<string>): Topic[] {
  return playbooks.topics.filter(topic => topic.requires.every(name => on.has(name))
    && (topic.any.length === 0 || topic.any.some(name => on.has(name))));
}

/**
 * Each offered topic with the tools the server lists that it has, and what the user wants
 * when each fits (its asks), for getting-started: a line like "- brand: `make_brand_kit`,
 * a site's logo, ...", so a kit adds a line for its topic, not one for each tool. A tool
 * whose topic is not offered has a line of its own.
 */
function requestsText(playbooks: Playbooks, context: TextContext): string {
  const offered = new Set(offeredTopics(playbooks, onNames(context)).map(topic => topic.name));
  const listed = listedTools(context);
  const byTopic = new Map<string, string[]>();
  for (const kit of context.definitions.filter(entry => context.enabled.has(entry.kit))) {
    for (const tool of kit.tools.filter(entry => listed.has(entry.name))) {
      const asks = tool.asks ? fillText(tool.asks, context, { kind: 'kit' }) : tool.title;
      const topic = tool.playbook && offered.has(tool.playbook) ? tool.playbook : `\`${tool.name}\``;
      const entry = topic.startsWith('`') ? asks : `\`${tool.name}\`, ${asks}`;
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), entry]);
    }
  }
  return [...byTopic].map(([topic, entries]) => `- ${topic}: ${entries.join('; ')}.`).join('\n');
}

function filled(text: string, code: boolean, playbooks: Playbooks, context: TextContext, kind: TextKind): string {
  return fillText(text, context, {
    kind,
    // Unknown braces are code's own: the loader refused them anywhere else.
    keepUnknown: true,
    extra: (placeholder: Placeholder) => (placeholder.name === 'requests' ? requestsText(playbooks, context) : undefined),
  });
}

/**
 * Lines with one empty line at most between paragraphs, none at either end, and each
 * numbered list counted again from 1, since a block left out can take an item with it,
 * the first one too.
 */
function tidy(lines: Array<{ text: string; code: boolean }>): string {
  const out: string[] = [];
  let previous: number | undefined;
  for (const { text, code } of lines) {
    const line = code ? text : text.replace(/\s+$/, '');
    if (!code && !line && (!out.length || out[out.length - 1] === '')) continue;
    if (!code) {
      if (/^#{1,6} /.test(line)) previous = undefined;
      const item = /^(\d+)\. /.exec(line);
      if (item) {
        const written = Number(item[1]);
        const number = written === 1 || previous === undefined ? 1 : previous + 1;
        previous = number;
        out.push(`${number}. ${line.slice(item[0].length)}`);
        continue;
      }
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// Renderings by topic, side, kits, versions, limits and the kit files they read.
const rendered = new Map<string, string>();
const MAX_RENDERED = 500;
const fingerprints = new WeakMap<object, string>();

function cacheKey(what: string, playbooks: Playbooks, context: TextContext): string {
  let kits = fingerprints.get(context.definitions);
  if (!kits) {
    kits = createHash('sha1').update(JSON.stringify(context.definitions)).digest('hex');
    fingerprints.set(context.definitions, kits);
  }
  return JSON.stringify([what, playbooks.dir, context.where, context.place, context.baseDir ?? null, [...context.enabled].sort(),
    [...listedTools(context)].sort(), [...context.versions].sort(), context.limits ?? null, kits]);
}

function cached(key: string, make: () => string): string {
  const known = rendered.get(key);
  if (known !== undefined) return known;
  const text = make();
  if (rendered.size >= MAX_RENDERED) rendered.clear();
  rendered.set(key, text);
  return text;
}

function rendering(label: string, make: () => string): string {
  try {
    return make();
  } catch (error) {
    if (error instanceof TextError) throw new PlaybookError(`${label}: ${error.message}`);
    throw error;
  }
}

/** A topic as the model reads it on this side, with these kits on: its blocks picked and its placeholders filled. */
export function renderTopic(playbooks: Playbooks, name: string, context: TextContext): string {
  const topic = playbooks.topics.find(entry => entry.name === name);
  if (!topic) throw new PlaybookError(`There is no topic ${name}`);
  return cached(cacheKey(`topic:${name}`, playbooks, context), () => rendering(path.basename(topic.file), () => {
    const lines = select(topic.body, context).map(line => ({ text: filled(line.text, line.code, playbooks, context, 'topic'), code: line.code }));
    const body = tidy(lines.flatMap(line => line.text.split('\n').map(text => ({ text, code: line.code }))));
    return body.startsWith('# ') ? body : `# ${fillText(topic.title, context, { kind: 'kit' })}\n\n${body}`;
  }));
}

/** The server's instructions from playbooks/_instructions.md, each paragraph on one line. */
export function instructionsText(playbooks: Playbooks, context: TextContext): string {
  return cached(cacheKey('instructions', playbooks, context), () => rendering(INSTRUCTIONS_FILE, () => {
    const lines = select(playbooks.instructions, context).map(line => filled(line.text, line.code, playbooks, context, 'instructions'));
    const paragraphs: string[][] = [[]];
    for (const line of lines.join('\n').split('\n')) {
      if (line.trim()) paragraphs[paragraphs.length - 1]!.push(line.trim());
      else if (paragraphs[paragraphs.length - 1]!.length) paragraphs.push([]);
    }
    return paragraphs.filter(paragraph => paragraph.length).map(paragraph => paragraph.join(' ')).join('\n\n');
  }));
}

/** makersmcp_playbook's description: what it returns, then each offered topic's index line, in order. */
export function indexText(playbooks: Playbooks, context: TextContext): string {
  return cached(cacheKey('index', playbooks, context), () => {
    const offered = offeredTopics(playbooks, onNames(context));
    const lines = offered.map(topic => rendering(path.basename(topic.file), () => `- ${topic.name}: ${fillText(topic.index, context, { kind: 'kit' })}`));
    return `${indexHead(offered)}\n${lines.join('\n')}`;
  });
}

/**
 * makersmcp_playbook, read only: one to three of the offered topics, each as its own
 * text, Markdown from its title down. Its description is the index, so a model that sees
 * only the tool list still knows the topics. Nothing is registered when no topic is offered.
 */
export function registerPlaybookTool(server: McpServer, playbooks: Playbooks, context: TextContext): string[] {
  const names = offeredTopics(playbooks, onNames(context)).map(topic => topic.name);
  if (!names.length) return names;
  const example = names.includes('launch-film') ? 'launch-film' : names[0]!;
  server.registerTool(
    PLAYBOOK_TOOL,
    {
      title: 'MakersMCP playbooks',
      description: indexText(playbooks, context),
      inputSchema: {
        topics: z.array(z.enum(names as [string, ...string[]])).min(1).max(TOPICS_A_CALL)
          .describe(`One to three topics from this tool's list, like ["${example}"].`),
      },
      annotations: { title: 'MakersMCP playbooks', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      // Claude Code lists it from the start instead of behind its tool search.
      _meta: { 'anthropic/alwaysLoad': true },
    },
    async ({ topics }: { topics: string[] }) => {
      // Each topic on its own, so one that cannot be read leaves the others.
      const content: CallToolResult['content'] = [];
      let read = 0;
      for (const name of [...new Set(topics)]) {
        try {
          content.push({ type: 'text', text: renderTopic(playbooks, name, context) });
          read++;
        } catch (error) {
          content.push({ type: 'text', text: `## ${PLAYBOOK_TOOL}: ${name} could not be read\n\n${error instanceof Error ? error.message : String(error)}` });
        }
      }
      return read ? { content } : { content, isError: true };
    },
  );
  return names;
}

/** Each offered topic as a resource too, makersmcp://playbooks/<topic>, for clients whose users attach them. */
export function registerPlaybookResources(server: McpServer, playbooks: Playbooks, context: TextContext): void {
  for (const topic of offeredTopics(playbooks, onNames(context))) {
    const uri = `makersmcp://playbooks/${topic.name}`;
    server.registerResource(
      `playbook-${topic.name}`,
      uri,
      {
        title: fillText(topic.title, context, { kind: 'kit' }),
        description: fillText(topic.description, context, { kind: 'kit' }),
        mimeType: 'text/markdown',
      },
      async () => ({ contents: [{ uri, mimeType: 'text/markdown', text: renderTopic(playbooks, topic.name, context) }] }),
    );
  }
}
