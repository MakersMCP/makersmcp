import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../dist/server.js';

// An identical kit tool call continues the job of an earlier one whose answer did not reach
// its client, of one that ended in an error after its job started, or of one still waiting
// since retryAfterMs, instead of starting a second job, after Wiro-MCP's
// tests/run-model-retry.test.mjs. On a short clock: an identical call 300 ms
// after a still waiting one counts as its repeat, and one that ended unanswered can be
// continued for 5 seconds.
const TIMING = { retryAfterMs: 300, unansweredWindowMs: 5_000 };

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const definitions = ['fakekit.json', 'otherkit.json'].map(file => JSON.parse(readFileSync(path.join(fixtures, file), 'utf8')));
const text = result => result.content.map(item => item.text).join('\n');

/** Waits until `check` holds, for up to five seconds. */
async function until(check) {
  for (let i = 0; i < 250 && !check(); i++) await sleep(20);
  assert.ok(check(), 'it never happened');
}

// A hosted service's jobs, which run until the test ends them, and a backend for one user of
// it, as MakersMCP-Server makes one for each request with the user as its identity.
class Service {
  jobs = new Map();
  started = [];
  waiters = new Map();
  /** While true, every wait ends in MakersMCP-Server's error for a job it cannot say how is doing. */
  waitFails = false;
  /** While true, every start ends in MakersMCP-Server's error for a start it cannot confirm, and starts nothing. */
  startFails = false;

  backend(identity) {
    return new ServiceBackend(this, identity);
  }

  end(id, status = 'done') {
    const view = this.jobs.get(id);
    Object.assign(view, { status, exitCode: status === 'done' ? 0 : 1, elapsedSeconds: 2, files: [] },
      status === 'done' ? { summary: 'Saved.' } : status === 'failed' ? { failure: 'It broke.' } : {});
    for (const wake of this.waiters.get(id) ?? []) wake();
  }
}

class ServiceBackend {
  where = 'hosted';
  place = 'on example.com';

  constructor(service, identity) {
    this.service = service;
    if (identity !== undefined) this.identity = identity;
  }

  available(kits) {
    return kits.map(definition => ({ definition, version: '9.9.9' }));
  }

  async start({ kit, tool, input }) {
    const { service } = this;
    if (service.startFails) throw new Error(`It is not known whether ${tool.title} started. Check list_jobs before you start it again.`);
    service.started.push({ identity: this.identity, tool: tool.name, input });
    const id = `job${service.started.length}`;
    const view = { id, kit: kit.definition.kit, tool: tool.name, title: tool.title, status: 'running', exitCode: null, elapsedSeconds: 0 };
    service.jobs.set(id, view);
    return { ...view };
  }

  async wait(id, seconds, { signal } = {}) {
    const { service } = this;
    const view = service.jobs.get(id);
    if (!view) return undefined;
    if (service.waitFails) throw new Error(`makersmcp.com could not say how job ${id} is doing. It is not known whether the job still runs: call wait_for_job again in a minute, never the tool that started it.`);
    if (view.status === 'running' && seconds > 0 && !signal?.aborted) {
      await new Promise(resolve => {
        const wake = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', wake);
          service.waiters.get(id).delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, seconds * 1000);
        signal?.addEventListener('abort', wake, { once: true });
        if (!service.waiters.has(id)) service.waiters.set(id, new Set());
        service.waiters.get(id).add(wake);
      });
    }
    return { ...view };
  }

  async cancel(id) {
    const view = this.service.jobs.get(id);
    if (view?.status === 'running') this.service.end(id, 'canceled');
    return view && { ...view };
  }

  async list() {
    return [...this.service.jobs.values()].reverse().map(view => ({ ...view }));
  }

  setupReport() {
    return 'hosted';
  }

  close() {}
}

let users = 0;
/** A user no other test has, as every server of this process shares one ledger. */
const newUser = () => `user-${++users}`;

async function connect(options) {
  const server = createMcpServer({ definitions, repeatTiming: TIMING, ...options });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

const ARGS = { url: 'https://example.com', wait_seconds: 20 };

function call(client, args = ARGS, options) {
  return client.callTool({ name: 'fake_make', arguments: args }, undefined, options);
}

/** A call the client cancels once its job has started, which sends notifications/cancelled. */
async function callAndCancel(client, until, args = ARGS) {
  const controller = new AbortController();
  const pending = call(client, args, { signal: controller.signal });
  await until();
  controller.abort('the user stopped it');
  await assert.rejects(pending);
}

const CONTINUED = /^This call continued job (\S+), which an identical call started \d+ seconds? ago, instead of starting a second job\. For a separate run, (change an argument|give another out_dir)\.\n\n## Fake make: /;

test('an identical call after one its client cancelled continues that job on any server of the process, instead of starting a second', async () => {
  const service = new Service();
  const user = newUser();
  // As MakersMCP-Server makes a server for each request, each with a backend for the user.
  const first = await connect({ backend: service.backend(user) });
  const second = await connect({ backend: service.backend(user) });
  try {
    await callAndCancel(first.client, () => until(() => service.started.length === 1));
    const again = call(second.client);
    await sleep(100);
    service.end('job1');
    const result = await again;
    assert.equal(service.started.length, 1);
    assert.equal(result.structuredContent.job_id, 'job1');
    assert.equal(result.structuredContent.status, 'done');
    assert.equal(result.structuredContent.continued, true);
    assert.deepEqual(CONTINUED.exec(text(result))?.slice(1), ['job1', 'change an argument'], text(result));
  } finally {
    await first.close();
    await second.close();
  }
});

test('an identical call continues a job an earlier call still waits for once retryAfterMs have passed, and calls sent side by side start their own', async () => {
  const service = new Service();
  const session = await connect({ backend: service.backend(newUser()) });
  try {
    const first = call(session.client);
    const beside = call(session.client);
    await until(() => service.started.length === 2);
    await sleep(TIMING.retryAfterMs + 50);
    const repeat = call(session.client);
    await sleep(100);
    assert.equal(service.started.length, 2);
    service.end('job1');
    service.end('job2');
    const results = await Promise.all([first, beside, repeat]);
    assert.deepEqual(results.map(result => result.structuredContent.job_id), ['job1', 'job2', 'job2']);
    assert.deepEqual(results.map(result => result.structuredContent.continued), [undefined, undefined, true]);
  } finally {
    await session.close();
  }
});

test('an identical call after an answered one starts its own job, and so do one with other arguments, one of another user and one through a backend with no identity', async () => {
  const service = new Service();
  const user = newUser();
  const session = await connect({ backend: service.backend(user) });
  const other = await connect({ backend: service.backend(newUser()) });
  const nobody = await connect({ backend: service.backend(undefined) });
  try {
    // Answered with the job still running: the client has its job_id.
    const answered = await call(session.client, { ...ARGS, wait_seconds: 0 });
    assert.equal(answered.structuredContent.status, 'running');
    const after = await call(session.client, { ...ARGS, wait_seconds: 0 });
    assert.equal(after.structuredContent.job_id, 'job2');

    await callAndCancel(session.client, () => until(() => service.started.length === 3));
    for (const [client, args] of [[session.client, { ...ARGS, url: 'https://example.com/other' }], [other.client, ARGS]]) {
      const result = await call(client, { ...args, wait_seconds: 0 });
      assert.equal(result.structuredContent.continued, undefined);
    }
    assert.equal(service.started.length, 5);

    await callAndCancel(nobody.client, () => until(() => service.started.length === 6));
    const unkeyed = await call(nobody.client, { ...ARGS, wait_seconds: 0 });
    assert.equal(unkeyed.structuredContent.job_id, 'job7');
    assert.equal(unkeyed.structuredContent.continued, undefined);
  } finally {
    await session.close();
    await other.close();
    await nobody.close();
  }
});

test('a continued job that failed or was canceled is replaced by one new job', async () => {
  for (const status of ['failed', 'canceled']) {
    const service = new Service();
    const session = await connect({ backend: service.backend(newUser()) });
    try {
      await callAndCancel(session.client, () => until(() => service.started.length === 1));
      service.end('job1', status);
      const again = call(session.client);
      await until(() => service.started.length === 2);
      service.end('job2');
      const result = await again;
      assert.equal(result.structuredContent.job_id, 'job2', status);
      assert.equal(result.structuredContent.status, 'done', status);
      // A new job, as if no earlier call had been made.
      assert.equal(result.structuredContent.continued, undefined, status);
      assert.doesNotMatch(text(result), /continued/);
    } finally {
      await session.close();
    }
  }
});

// MakersMCP-Server's wait ends in an error when the API gives no word of a job for the whole wait
// and its process no longer keeps the job as last seen running, as once a list_jobs saw it end: it
// is not known whether the job still runs. Its start gave the job, but the call ended without the
// job's result, so an identical call continues it, as often as the wait fails, instead of starting
// a second job that uses up another of the jobs of any 24 hours.
test('an identical call after one whose wait ended in an error continues that job, instead of starting a second', async () => {
  const service = new Service();
  const session = await connect({ backend: service.backend(newUser()) });
  try {
    service.waitFails = true;
    for (let n = 0; n < 2; n++) {
      const failed = await call(session.client);
      assert.equal(failed.isError, true);
      assert.equal(text(failed), 'makersmcp.com could not say how job job1 is doing. It is not known whether the job still runs: call wait_for_job again in a minute, never the tool that started it.');
    }
    assert.equal(service.started.length, 1);
    service.waitFails = false;
    const again = call(session.client);
    await sleep(100);
    service.end('job1');
    const result = await again;
    assert.equal(service.started.length, 1);
    assert.equal(result.structuredContent.job_id, 'job1');
    assert.equal(result.structuredContent.status, 'done');
    assert.equal(result.structuredContent.continued, true);
    assert.deepEqual(CONTINUED.exec(text(result))?.slice(1), ['job1', 'change an argument'], text(result));
    // Neither the note nor continued's description says the earlier call's answer did not reach the client, as this one's error
    // named the job.
    const { tools } = await session.client.listTools();
    const listed = tools.find(tool => tool.name === 'fake_make');
    assert.equal(listed.outputSchema.properties.continued.description, 'True when this call continued the job an identical call started, instead of starting another.');
  } finally {
    await session.close();
  }
});

// A start that ended in an error gave no job, so the call leaves the ledger nothing to continue.
test('a call whose start ended in an error leaves the ledger no job to continue', async () => {
  const { startLedger, callKey } = await import('../dist/repeats.js');
  const service = new Service();
  const user = newUser();
  const session = await connect({ backend: service.backend(user) });
  try {
    service.startFails = true;
    const failed = await call(session.client);
    assert.equal(failed.isError, true);
    assert.equal(text(failed), 'It is not known whether Fake make started. Check list_jobs before you start it again.');
    const { wait_seconds: _wait, ...input } = ARGS;
    assert.equal(startLedger.records.has(callKey(user, 'fake_make', input)), false);
    assert.equal(service.started.length, 0);
  } finally {
    await session.close();
  }
});

test('locally, the same call after one its client cancelled waits for that job, and one sent too soon beside a waiting call is told the job is its own', async () => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'makersmcp-repeats-'));
  const fakekit = path.join(fixtures, 'fakekit');
  const session = await connect({ kitPaths: { fakekit, otherkit: fakekit }, outDir });
  const slow = { url: 'https://slow.example.com', wait_seconds: 20 };
  const jobs = async () => (await session.client.callTool({ name: 'list_jobs', arguments: {} })).structuredContent.jobs;
  try {
    // The kit takes three seconds; the client gives up on the call well before.
    await callAndCancel(session.client, () => sleep(300), slow);
    const again = await call(session.client, slow);
    assert.equal(again.structuredContent.status, 'done', text(again));
    assert.equal(again.structuredContent.continued, true);
    assert.equal(CONTINUED.exec(text(again))?.[2], 'give another out_dir', text(again));
    assert.equal((await jobs()).length, 1);

    // A call still waiting: the same call at once is refused for the folder, and after retryAfterMs it continues the job.
    const waiting = call(session.client, slow);
    await sleep(100);
    const soon = await call(session.client, slow);
    assert.equal(soon.isError, true);
    assert.match(text(soon), /That is the job an identical call started \d+ s ago: wait for it with wait_for_job \(job_id job_\w+\), and do not call fake_make again for it\.$/);
    await sleep(TIMING.retryAfterMs);
    const later = await call(session.client, slow);
    const first = await waiting;
    assert.equal(later.structuredContent.continued, true, text(later));
    assert.equal(later.structuredContent.job_id, first.structuredContent.job_id);
    assert.equal((await jobs()).length, 2);
  } finally {
    await session.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

// A service that keeps answers for the jobs a call may continue, as MakersMCP-Server keeps the
// answers of its Kits/Start, follows the ledger's times and its bound from the package's main
// entry instead of copying them.
test('the package exports the ledger\'s times and the most calls it keeps, and the ledger keeps no more, the oldest going first', async () => {
  const makersmcp = await import('../dist/server.js');
  assert.deepEqual({ ...makersmcp.REPEAT_TIMING }, { retryAfterMs: 10_000, unansweredWindowMs: 10 * 60_000 });
  assert.ok(Object.isFrozen(makersmcp.REPEAT_TIMING));
  assert.equal(makersmcp.MAX_REPEAT_RECORDS, 1000);
  const { StartLedger } = await import('../dist/repeats.js');
  const ledger = new StartLedger();
  const view = id => ({ id, kit: 'fakekit', tool: 'fake_make', title: 'Fake make', status: 'running', exitCode: null, elapsedSeconds: 0 });
  const records = [];
  for (let n = 0; n < makersmcp.MAX_REPEAT_RECORDS + 5; n++) {
    const record = ledger.start(`key-${n}`, async () => view(`job_${n}`), n);
    ledger.attach(record);
    records.push(record);
  }
  await Promise.all(records.map(record => record.started));
  const keys = [...ledger.records.keys()];
  assert.equal(keys.length, makersmcp.MAX_REPEAT_RECORDS);
  assert.deepEqual([keys[0], keys.at(-1)], ['key-5', `key-${makersmcp.MAX_REPEAT_RECORDS + 4}`]);
});
