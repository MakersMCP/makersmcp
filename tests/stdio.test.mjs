// makersmcp over stdio, started the way an MCP client starts it, with easybrandkit's
// tools running the fake kit: what happens to the jobs when the client goes away.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '..', 'dist', 'index.js');
const fakekit = path.join(here, 'fixtures', 'fakekit');
const posix = process.platform === 'win32' ? 'process groups are POSIX' : false;
const text = result => result.content.map(item => item.text).join('\n');

const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
};
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}

async function startServer({ cwd, env = {}, args = [] }) {
  const { MAKERSMCP_OUT, MAKERSMCP_KITS, MAKERSMCP_KIT_PATHS, ...rest } = process.env;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin, '--kits', 'easybrandkit', '--kit-path', `easybrandkit=${fakekit}`, ...args],
    cwd,
    env: { ...rest, ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport, server: transport.pid };
}

// Starts a job whose kit runs until it is stopped and has a browser of its own.
async function startTree(client, out) {
  const started = await client.callTool({ name: 'make_brand_kit', arguments: { url: 'https://tree.example.com', wait_seconds: 0 } });
  assert.equal(started.structuredContent.status, 'running', text(started));
  const file = path.join(out, 'easybrandkit-tree.example.com', 'pids.json');
  assert.ok(await until(() => existsSync(file)), 'the kit started');
  const pids = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(alive(pids.kit) && alive(pids.browser));
  return [pids.kit, pids.browser];
}

async function lifecycle(name, stop) {
  test(name, { skip: posix }, async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-stdio-'));
    let pids = [];
    let server;
    let client;
    try {
      ({ client, server } = await startServer({ cwd: out, args: ['--out', out] }));
      pids = await startTree(client, out);
      await stop({ client, server });
      assert.ok(await until(() => !alive(server)), 'makersmcp ended');
      assert.ok(await until(() => pids.every(pid => !alive(pid))), 'the kit and its browser ended with it');
    } finally {
      for (const pid of [server, ...pids]) if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
      await client?.close();
      rmSync(out, { recursive: true, force: true });
    }
  });
}

lifecycle('when the client closes stdin, makersmcp ends at once and stops its kits', async ({ client }) => {
  const at = Date.now();
  await client.close();
  // A client waits 2 s after closing stdin before it sends SIGTERM.
  assert.ok(Date.now() - at < 1500, `the close took ${Date.now() - at} ms, so makersmcp did not end on its own`);
});

lifecycle('on SIGTERM, makersmcp stops its kits before it ends', async ({ server }) => {
  process.kill(server, 'SIGTERM');
});

lifecycle('even when makersmcp is killed outright, its kits do not outlive it', async ({ server }) => {
  process.kill(server, 'SIGKILL');
});

test('started outside any project, as Claude Desktop does, the files go to ~/makersmcp, made on the first job', { skip: posix }, async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-home-'));
  let client;
  try {
    ({ client } = await startServer({ cwd: '/', env: { HOME: home } }));
    const folder = path.join(home, 'makersmcp');
    const setup = text(await client.callTool({ name: 'check_setup', arguments: {} }));
    assert.match(setup, new RegExp(`Files go to ${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} .*It does not exist yet; the first job makes it\\.`));
    const result = await client.callTool({ name: 'make_brand_kit', arguments: { url: 'https://example.com' } });
    assert.equal(result.structuredContent.status, 'done', text(result));
    assert.ok(existsSync(path.join(folder, 'easybrandkit-example.com', 'REPORT.md')));
    await client.close();

    // A client's JSON settings have no shell to read ~.
    ({ client } = await startServer({ cwd: '/', env: { HOME: home, MAKERSMCP_OUT: '~/films' } }));
    const tilde = text(await client.callTool({ name: 'check_setup', arguments: {} }));
    assert.match(tilde, new RegExp(`Files go to ${path.join(home, 'films').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `));
  } finally {
    await client?.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('a kit path that starts with ~ is in the home folder, from --kit-path and from MAKERSMCP_KIT_PATHS', { skip: posix }, () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-home-'));
  try {
    mkdirSync(path.join(home, 'kits'));
    symlinkSync(fakekit, path.join(home, 'kits', 'fakekit'));
    const { MAKERSMCP_OUT, MAKERSMCP_KITS, MAKERSMCP_KIT_PATHS, ...rest } = process.env;
    const check = (args, env = {}) => {
      const run = spawnSync(process.execPath, [bin, '--check', '--kits', 'easybrandkit', ...args], {
        cwd: home, env: { ...rest, HOME: home, ...env }, encoding: 'utf8',
      });
      assert.equal(run.status, 0, run.stderr);
      return run.stdout;
    };
    for (const output of [
      check(['--kit-path', 'easybrandkit=~/kits/fakekit']),
      check([], { MAKERSMCP_KIT_PATHS: 'easybrandkit=~/kits/fakekit' }),
    ]) {
      assert.match(output, /^- easybrandkit \(design\): 1\.2\.3, on\./m);
    }
    assert.ok(!existsSync(path.join(home, '~')), 'no folder named ~');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/** The timers that keep this process running: node --test waits for each of them before it ends the file. */
const timers = () => process.getActiveResourcesInfo().filter(type => type === 'Timeout').length;

/**
 * Starts a server with these arguments on pipes, as a client does: sends initialize and waits for its answer, so a start
 * that takes seconds on a loaded machine is over, then sends notifications/initialized and the call and closes stdin
 * right after them. Gives the exit code, the time from stdin's close to the end, and the answers.
 *
 * The timers of its two races do not keep this process running: while the server runs, its process and pipes do, so
 * each timer still ends its race when it should, and the one a race leaves when it is won does not hold this file for up
 * to a minute after its last test.
 */
async function closeRightAfter(args, call) {
  const before = timers();
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  let result;
  try {
    let stdout = '';
    const answers = () => stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
    let initialized;
    const answered = new Promise(resolve => {
      initialized = resolve;
    });
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk;
      if (stdout.endsWith('\n') && answers().some(answer => answer.id === 1)) initialized(true);
    });
    const ended = new Promise(resolve => child.on('close', code => resolve(code)));
    const lines = messages => messages.map(message => JSON.stringify(message)).join('\n') + '\n';
    child.stdin.write(lines([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pipe', version: '1' } } }]));
    assert.equal(await Promise.race([answered, ended.then(() => 'ended'), sleep(60_000, 'no answer', { ref: false })]), true, 'the server answered initialize');
    child.stdin.end(lines([{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: call }]));
    const at = Date.now();
    const code = await Promise.race([ended, sleep(4000, 'still running', { ref: false })]);
    result = { code, took: Date.now() - at, answers: answers() };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  assert.equal(timers(), before, 'a timer of the races is left running, which keeps this file going after its last test');
  return result;
}

test('a client that closes stdin right after its requests still gets the answers', async () => {
  const out = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-stdio-'));
  try {
    // makersmcp answers what was sent for up to a second after stdin ends, so the call gives wait_seconds 0 and returns
    // once its job starts, instead of waiting for a kit, which can take longer than that to start on a loaded machine.
    // The job, a slow one that writes nothing for 3 s, stops with makersmcp.
    const { code, took, answers } = await closeRightAfter([bin, '--kits', 'easybrandkit', '--kit-path', `easybrandkit=${fakekit}`, '--out', out],
      { name: 'make_brand_kit', arguments: { url: 'https://slow.example.com', wait_seconds: 0 } });
    assert.equal(code, 0);
    assert.ok(took < 2000, `it ended ${took} ms after stdin closed, so a client would have sent SIGTERM`);
    assert.deepEqual(answers.map(answer => answer.id), [1, 2]);
    assert.equal(answers[1].result.structuredContent.status, 'running');
    assert.match(answers[1].result.structuredContent.job_id, /\S/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('an answer that comes after stdin ends is still sent, within the second makersmcp waits for it', async () => {
  // A backend in makersmcp's own process whose job ends 300 ms after it starts, so no kit has to start on a loaded
  // machine, and the answer comes after stdin has ended.
  const server = pathToFileURL(path.join(here, '..', 'dist', 'server.js')).href;
  const script = [
    `import { loadKitDefinitions, serveStdio } from ${JSON.stringify(server)};`,
    "const definitions = loadKitDefinitions().filter(kit => kit.kit === 'easybrandkit');",
    'let view;',
    'const backend = {',
    "  where: 'local', place: 'on this machine', baseDir: process.cwd(),",
    "  available: kits => kits.map(definition => ({ definition, version: '9.9.9' })),",
    "  async start(request) { view = { id: 'job_1', kit: 'easybrandkit', tool: request.tool.name, title: request.tool.title, status: 'running', exitCode: null, elapsedSeconds: 0 }; return view; },",
    "  async wait() { await new Promise(resolve => setTimeout(resolve, 300)); return { ...view, status: 'done', exitCode: 0, summary: 'Saved it.', files: [], docs: [] }; },",
    "  async cancel() { return undefined; }, async list() { return []; }, setupReport: () => '', close() {},",
    '};',
    'await serveStdio({ backend, definitions });',
  ].join('\n');
  const { code, took, answers } = await closeRightAfter(['--input-type=module', '-e', script], { name: 'make_brand_kit', arguments: { url: 'https://example.com' } });
  assert.equal(code, 0);
  assert.ok(took < 2000, `it ended ${took} ms after stdin closed, so a client would have sent SIGTERM`);
  assert.deepEqual(answers.map(answer => answer.id), [1, 2]);
  assert.equal(answers[1].result.structuredContent.status, 'done');
});
