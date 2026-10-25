import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, sep } from 'node:path';
import { once } from 'node:events';

test('StockMarket: аккаунты, заказы, аукционы и сохранение', async t => {
  const testRoot = fileURLToPath(new URL('../.local/', import.meta.url));
  await mkdir(testRoot, { recursive: true });
  const dataDir = await mkdtemp(join(testRoot, 'stockmarket-test-'));
  let child, base;
  async function start() {
    child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: '0', STOCKMARKET_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    base = await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server readiness timeout')), 10000);
      child.once('error', e => { clearTimeout(timeout); reject(e); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Early exit ${code}: ${stderr}`)); });
      child.stdout.on('data', data => { const url = /http:\/\/127\.0\.0\.1:\d+/.exec(String(data)); if (url) { clearTimeout(timeout); resolveReady(url[0]); } });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
  async function request(path, data, cookie, headers = {}) {
    const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  let owner, bidder, second, order;
  try {
    await start();
    await t.test('Гость видит данные, а чувствительные файлы недоступны', async () => {
      assert.equal((await fetch(base)).status, 200);
      assert.deepEqual((await request('/api/me')).body, { user: null });
      const listing = await request('/api/orders'); assert.equal(listing.body.orders.length, 6);
      assert.ok(!JSON.stringify(listing.body).includes('hash'));
      assert.equal((await request('/.local/database.json')).status, 404);
      assert.equal((await request('/api/orders', {})).status, 401);
    });
    await t.test('Регистрация, повторы логина и защищённая сессия', async () => {
      owner = await request('/api/register', { name: 'Заказчик', login: 'test-owner', password: 'password123' });
      bidder = await request('/api/register', { name: 'Исполнитель', login: 'test-bidder', password: 'password123' });
      second = await request('/api/register', { name: 'Второй участник', login: 'test-second', password: 'password123' });
      assert.equal(owner.status, 200); assert.ok(owner.cookie); assert.equal(bidder.status, 200);
      assert.equal((await request('/api/me', undefined, owner.cookie)).body.user.name, 'Заказчик');
      assert.equal((await request('/api/register', { name: 'Повтор', login: 'test-owner', password: 'password123' })).status, 409);
      assert.equal((await request('/api/login', { login: 'test-owner', password: 'incorrect-password' })).status, 401);
      assert.equal((await request('/api/login', { login: 'test-owner', password: 'password123' }, null, { Origin: 'https://other-site.example' })).status, 403);
      const disk = JSON.parse(await readFile(join(dataDir, 'database.json'), 'utf8'));
      assert.ok(disk.users.find(u => u.login === 'test-owner').hash);
      assert.ok(!JSON.stringify(disk).includes('password123'));
    });
    const project = { title: 'Тестовый проект', description: 'Разработать полезный сайт с проверкой результатов.', category: 'Разработка', budget: 5000, deliveryDays: 7, auctionDays: 3 };
    await t.test('Создание заказа и проверка полей', async () => {
      assert.equal((await request('/api/orders', { ...project, budget: -100 }, owner.cookie)).status, 400);
      const result = await request('/api/orders', project, owner.cookie); assert.equal(result.status, 201); order = result.body.order;
      assert.equal(order.ownerId, owner.body.user.id); assert.equal(order.budget, 5000);
    });
    await t.test('Только допустимые ставки, строгое снижение и запрет своих заказов', async () => {
      const route = `/api/orders/${order.id}/bids`;
      assert.equal((await request(route, { amount: 4000 })).status, 401);
      assert.equal((await request(route, { amount: 4000 }, owner.cookie)).status, 403);
      for (const amount of [5000, 6000]) assert.equal((await request(route, { amount }, bidder.cookie)).status, 409);
      for (const amount of [0, -100, 10.5]) assert.equal((await request(route, { amount }, bidder.cookie)).status, 400);
      const results = await Promise.all([request(route, { amount: 4800 }, bidder.cookie), request(route, { amount: 4700 }, second.cookie)]);
      assert.ok(results.every(r => [201, 409].includes(r.status)));
      const listing = (await request('/api/orders')).body.orders; order = listing.find(o => o.id === order.id);
      assert.equal(order.bids.at(-1).amount, 4700);
      assert.ok(order.bids.every((b, i) => b.amount < (i ? order.bids[i - 1].amount : order.budget)));
    });
    await t.test('Только заказчик выбирает исполнителя; закрытый заказ не принимает ставки', async () => {
      const route = `/api/orders/${order.id}/accept`, data = { bidId: order.bids[0].id };
      assert.equal((await request(route, data, bidder.cookie)).status, 403);
      assert.equal((await request(route, { bidId: 'missing' }, owner.cookie)).status, 404);
      const accepted = await request(route, data, owner.cookie); assert.equal(accepted.body.order.status, 'assigned');
      assert.equal((await request(`/api/orders/${order.id}/bids`, { amount: 1000 }, bidder.cookie)).status, 409);
      assert.equal((await request(route, data, owner.cookie)).status, 409);
    });
    await t.test('Выход завершает сессию', async () => {
      assert.equal((await request('/api/logout', {}, bidder.cookie)).status, 200);
      assert.equal((await request('/api/me', undefined, bidder.cookie)).body.user, null);
    });
    await t.test('После перезапуска остаются аккаунты и история, сессии сбрасываются', async () => {
      await stop(); await start();
      const listing = (await request('/api/orders')).body.orders;
      assert.equal(listing.find(o => o.id === order.id).status, 'assigned');
      assert.equal(listing.find(o => o.id === order.id).bids.at(-1).amount, 4700);
      assert.equal((await request('/api/me', undefined, owner.cookie)).body.user, null);
      assert.equal((await request('/api/login', { login: 'test-owner', password: 'password123' })).status, 200);
      assert.equal((await request('/api/login', { login: 'demo', password: 'stockmarket' })).status, 200);
    });
  } finally {
    await stop();
    const testPath = resolve(dataDir), allowed = resolve(testRoot) + sep;
    if (!testPath.startsWith(allowed) || !testPath.split(sep).at(-1).startsWith('stockmarket-test-')) throw new Error('Unexpected test cleanup path');
    await rm(testPath, { recursive: true, force: true });
  }
});
