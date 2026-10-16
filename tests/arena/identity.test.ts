import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createIdentityTokens, IDENTITY_TTL } from '../../src/lib/arena/identity.ts';
test('remembered registration identity survives restart and rejects tampering and expiry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arena-identity-')), id = 'a'.repeat(24), now = Date.parse('2026-10-16T08:00:00Z');
  try {
    const a = createIdentityTokens(dir), b = createIdentityTokens(dir); const tokens = await Promise.all([a.issue(id, now), b.issue(id, now)]);
    assert.equal((await b.verify(tokens[0], now))?.playerId, id); assert.equal((await a.verify(tokens[1], now))?.playerId, id);
    const restart = createIdentityTokens(dir); assert.equal((await restart.verify(tokens[0], now + 10000))?.playerId, id);
    const [data, sig] = tokens[0].split('.'), forged = Buffer.from(JSON.stringify({ playerId: 'b'.repeat(24), expiresAt: now + IDENTITY_TTL * 1000 })).toString('base64url');
    assert.equal(await restart.verify(forged + '.' + sig, now), null); assert.equal(await restart.verify(data + '.wrong', now), null); assert.equal(await restart.verify(tokens[0], now + IDENTITY_TTL * 1000), null);
    assert.deepEqual(await readdir(dir), ['.identity-key']); assert.equal((await readFile(path.join(dir, '.identity-key'))).length, 32);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
