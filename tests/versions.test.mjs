import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const { version, mcpName } = read('package.json');

test('every manifest carries the version in package.json', () => {
  assert.equal(read('plugin.json').version, version);
  assert.equal(read('.claude-plugin/marketplace.json').plugins[0].version, version);
  assert.equal(read('.codex-plugin/plugin.json').version, version);
  const server = read('server.json');
  assert.equal(server.version, version);
  assert.equal(server.packages[0].version, version);
  assert.equal(server.name, mcpName);
});

// A release commit moves the lockfile's root with the other version fields, as npm install writes it from package.json (kit
// lessons 9.5).
test('the lockfile\'s root carries the version in package.json', () => {
  const lock = read('package-lock.json');
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
});

test('the MCP configs and the README run the release in package.json', () => {
  for (const file of ['mcp.json', '.mcp.json']) {
    assert.deepEqual(read(file).mcpServers.makersmcp.args, ['-y', `makersmcp@${version}`], file);
  }
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const pinned = [...readme.matchAll(/makersmcp@([\w.-]*\w)/g)].map(match => match[1]);
  assert.ok(pinned.length > 0);
  assert.deepEqual([...new Set(pinned)], [version]);
  assert.doesNotMatch(readme, /npx -y makersmcp(?!@)/, 'every npx in the README pins the version');
});

test('server.json, which the MCP Registry gets, names only settings makersmcp reads, none secret or needed, and the hosted endpoint', () => {
  const server = read('server.json');
  // The registry takes a description of at most 100 characters.
  assert.ok(server.description.length <= 100, `${server.description.length} characters`);
  const code = ['index.ts', 'setup.ts'].map(file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')).join('\n');
  const settings = server.packages[0].environmentVariables;
  assert.deepEqual(settings.map(setting => setting.name), ['MAKERSMCP_OUT', 'MAKERSMCP_KITS', 'MAKERSMCP_KIT_PATHS', 'CHROME_PATH', 'FFMPEG_PATH', 'FFPROBE_PATH']);
  for (const setting of settings) {
    assert.ok(code.includes(`'${setting.name}'`), `makersmcp reads ${setting.name}`);
    assert.equal(setting.isSecret, false, setting.name);
    assert.equal(setting.isRequired, false, setting.name);
  }
  // mcp.makersmcp.com signs in with OAuth, so the remote takes no header.
  assert.deepEqual(server.remotes, [{ type: 'streamable-http', url: 'https://mcp.makersmcp.com/v1' }]);
});
