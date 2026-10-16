import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { arenaDataDirectory } from './store.ts';

export const IDENTITY_COOKIE = 'arena_identity';
export const IDENTITY_TTL = 30 * 24 * 60 * 60;
type Identity = { playerId: string; expiresAt: number };
/** A site identity ticket, not a QQ/WeChat/Camp credential. Key survives image restarts in the existing data mount. */
export function createIdentityTokens(directory = arenaDataDirectory()) {
  let pending: Promise<Buffer> | undefined;
  const key = () => pending ||= (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 }); const file = path.join(directory, '.identity-key');
    try { const data = await readFile(file); if (data.length !== 32) throw Error('invalid identity key'); return data; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const value = randomBytes(32), temp = file + '.' + randomBytes(12).toString('hex') + '.tmp'; await writeFile(temp, value, { flag: 'wx', mode: 0o600 }); try { await link(temp, file); return value; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; const winner = await readFile(file); if (winner.length !== 32) throw Error('invalid identity key'); return winner; } finally { await unlink(temp).catch(() => {}); } }
  })().catch(e => { pending = undefined; throw e; });
  return {
    async issue(playerId: string, now = Date.now()) { if (!/^[a-f0-9]{24}$/.test(playerId)) throw Error('invalid player'); const data = Buffer.from(JSON.stringify({ playerId, expiresAt: now + IDENTITY_TTL * 1000 })).toString('base64url'); return data + '.' + createHmac('sha256', await key()).update(data).digest('base64url'); },
    async verify(value?: string, now = Date.now()): Promise<Identity | null> {
      if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
      const [data, sig] = value.split('.'), actual = Buffer.from(sig, 'base64url'), expected = createHmac('sha256', await key()).update(data).digest();
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      try { const parsed = JSON.parse(Buffer.from(data, 'base64url').toString()); return /^[a-f0-9]{24}$/.test(parsed.playerId) && Number.isSafeInteger(parsed.expiresAt) && parsed.expiresAt > now && parsed.expiresAt <= now + IDENTITY_TTL * 1000 + 60_000 ? { playerId: parsed.playerId, expiresAt: parsed.expiresAt } : null; } catch { return null; }
    },
  };
}
