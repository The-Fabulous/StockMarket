import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createBrowserApi } from '../public/pages-api.mjs';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values };
}
const denied = (status) => error => error.status === status;

test('GitHub Pages: точка входа и ресурсы работают в подпапке репозитория', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-mode="demo"/);
  for (const asset of ['favicon.svg', 'styles.css', 'app.js']) {
    assert.ok(html.includes(`./public/${asset}`));
    assert.equal(new URL(`./public/${asset}`, 'https://the-fabulous.github.io/StockMarket/').pathname, `/StockMarket/public/${asset}`);
    assert.ok(existsSync(new URL(`../public/${asset}`, import.meta.url)));
  }
  assert.ok(existsSync(new URL('../.nojekyll', import.meta.url)));
});

test('Браузерное демо: просмотр, вход, ставки и сохранение без сервера', async () => {
  const local = memoryStorage(), session = memoryStorage();
  const api = createBrowserApi({ local, session, locks: null });
  assert.equal((await api('/me')).user, null);
  assert.equal((await api('/orders')).orders.length, 6);
  await assert.rejects(api('/orders/project-1/bids', { amount: 30000 }), denied(401));
  await assert.rejects(api('/login', { login: 'demo', password: 'incorrect' }), denied(401));
  assert.equal((await api('/login', { login: 'demo', password: 'stockmarket' })).user.login, 'demo');
  await assert.rejects(api('/orders/project-1/bids', { amount: 36000 }), denied(409));
  await assert.rejects(api('/orders/project-1/bids', { amount: 0 }), denied(400));
  const results = await Promise.allSettled([api('/orders/project-1/bids', { amount: 34000 }), api('/orders/project-1/bids', { amount: 35000 })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  const reloaded = createBrowserApi({ local, session, locks: null });
  assert.equal((await reloaded('/orders')).orders[0].bids.at(-1).amount, 34000);
  assert.equal((await reloaded('/me')).user.id, 'demo');
  await reloaded('/logout', {}); assert.equal((await reloaded('/me')).user, null);
  const anotherBrowser = createBrowserApi({ local: memoryStorage(), session: memoryStorage(), locks: null });
  assert.equal((await anotherBrowser('/orders')).orders[0].bids.at(-1).amount, 36000);
});

test('Браузерное демо: регистрация, свой заказ, выбор исполнителя и завершение', async () => {
  const local = memoryStorage(), session = memoryStorage();
  let currentTime = Date.now();
  const api = createBrowserApi({ local, session, locks: null, now: () => currentTime });
  await api('/register', { login: 'customer', password: 'test-password-123', name: 'Заказчик' });
  assert.ok(![...local.values.values()].join('').includes('test-password-123'));
  await assert.rejects(api('/register', { login: 'customer', password: 'test-password-123', name: 'Повтор' }), denied(409));
  const { order } = await api('/orders', { title: 'Новый лендинг', description: 'Создать адаптивный сайт для небольшого кафе.', category: 'Дизайн', budget: 5000, deliveryDays: 3, auctionDays: 1 });
  await assert.rejects(api(`/orders/${order.id}/bids`, { amount: 4000 }), denied(403));
  await api('/login', { login: 'demo', password: 'stockmarket' });
  const bid = await api(`/orders/${order.id}/bids`, { amount: 4000 });
  const bidId = bid.order.bids[0].id;
  await assert.rejects(api(`/orders/${order.id}/accept`, { bidId }), denied(403));
  currentTime += 2 * 86400000;
  await assert.rejects(api(`/orders/${order.id}/bids`, { amount: 3000 }), denied(409));
  await api('/login', { login: 'customer', password: 'test-password-123' });
  const accepted = await api(`/orders/${order.id}/accept`, { bidId });
  assert.equal(accepted.order.status, 'assigned'); assert.equal(accepted.order.acceptedBidId, bidId);
});

test('Браузерное демо: невозможность сохранения не выдаёт успешную ставку', async () => {
  const local = memoryStorage(), session = memoryStorage();
  const api = createBrowserApi({ local, session, locks: null });
  await api('/login', { login: 'demo', password: 'stockmarket' });
  local.setItem = () => { throw new Error('Storage full'); };
  await assert.rejects(api('/orders/project-1/bids', { amount: 30000 }), denied(500));
  assert.equal((await api('/orders')).orders[0].bids.at(-1).amount, 36000);
});
