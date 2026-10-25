import http from 'node:http';
import { randomBytes, randomUUID, scryptSync, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.STOCKMARKET_DATA_DIR || join(root, '.local');
mkdirSync(dataDir, { recursive: true });
const dataPath = join(dataDir, 'database.json');
const derive = promisify(scrypt);
const sessions = new Map();
const attempts = new Map();
import { categories, createDemoData } from './public/seed.mjs';
const passwordRecord = (password) => { const salt = randomBytes(16).toString('hex'); return { salt, hash: scryptSync(password, salt, 64).toString('hex') }; };

function seed() {
  const data = createDemoData();
  Object.assign(data.users.find(user => user.id === 'demo'), passwordRecord('stockmarket'));
  return data;
}
let db = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, 'utf8')) : seed();
function persist() { const tmp = `${dataPath}.tmp`; writeFileSync(tmp, JSON.stringify(db, null, 2)); renameSync(tmp, dataPath); }
if (!existsSync(dataPath)) persist();
function json(res, status, payload, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(payload)); }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function currentUser(req) {
  const token = /(?:^|;\s*)sm_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) { sessions.delete(token); return null; }
  return db.users.find(u => u.id === session.id) || null;
}
function publicUser(u) { return u ? { id: u.id, name: u.name, login: u.login } : null; }
function requireUser(req) { const user = currentUser(req); if (!user) fail('Войдите, чтобы продолжить.', 401); return user; }
async function body(req) {
  let input = ''; for await (const part of req) { input += part; if (input.length > 20000) fail('Слишком много данных.', 413); }
  try { return JSON.parse(input || '{}'); } catch { fail('Некорректный запрос.'); }
}
function str(value, min, max, label) { if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`${label}: от ${min} до ${max} символов.`); return value.trim(); }
function integer(value, min, max, label) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}: число от ${min} до ${max}.`); return value; }
function orderView(order) { return { ...order, status: order.status === 'open' && order.deadline <= Date.now() ? 'expired' : order.status }; }
function sessionCookie(user) { const token = randomBytes(32).toString('hex'); sessions.set(token, { id: user.id, expires: Date.now() + 7 * 86400000 }); return `sm_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`; }

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) fail('Недопустимый источник запроса.', 403);
      if (!req.headers['content-type']?.startsWith('application/json')) fail('Ожидается JSON.', 415);
    }
    if (url.pathname === '/api/me' && req.method === 'GET') return json(res, 200, { user: publicUser(currentUser(req)) });
    if (url.pathname === '/api/orders' && req.method === 'GET') return json(res, 200, { orders: db.orders.map(orderView), categories });
    if (['/api/login', '/api/register'].includes(url.pathname) && req.method === 'POST') {
      const key = req.socket.remoteAddress;
      const attempt = attempts.get(key) || { count: 0, expires: Date.now() + 600000 };
      if (attempt.expires < Date.now()) { attempt.count = 0; attempt.expires = Date.now() + 600000; }
      if (++attempt.count > 30) fail('Слишком много попыток. Попробуйте через 10 минут.', 429);
      attempts.set(key, attempt);
      const input = await body(req);
      const login = str(input.login, 3, 32, 'Логин').toLowerCase();
      if (!/^[a-z0-9_.-]+$/.test(login)) fail('В логине используйте латинские буквы, цифры, точку, дефис или подчёркивание.');
      const password = str(input.password, 8, 128, 'Пароль');
      let user = db.users.find(u => u.login === login);
      if (url.pathname === '/api/register') {
        if (user) fail('Этот логин уже занят.', 409);
        const name = str(input.name, 2, 50, 'Имя');
        const salt = randomBytes(16).toString('hex');
        const hash = (await derive(password, salt, 64)).toString('hex');
        if (db.users.some(u => u.login === login)) fail('Этот логин уже занят.', 409);
        user = { id: randomUUID(), login, name, salt, hash }; db.users.push(user); persist();
      } else {
        const testHash = await derive(password, user?.salt || 'unknown-user', 64);
        if (!user?.hash || !timingSafeEqual(testHash, Buffer.from(user.hash, 'hex'))) fail('Неверный логин или пароль.', 401);
      }
      attempts.delete(key);
      return json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = /(?:^|;\s*)sm_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1]; sessions.delete(token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'sm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }
    if (url.pathname === '/api/orders' && req.method === 'POST') {
      const user = requireUser(req), input = await body(req);
      const title = str(input.title, 5, 100, 'Название'), description = str(input.description, 20, 4000, 'Описание');
      if (!categories.includes(input.category)) fail('Выберите категорию.');
      const budget = integer(input.budget, 100, 10000000, 'Бюджет'), deliveryDays = integer(input.deliveryDays, 1, 365, 'Срок');
      const auctionDays = integer(input.auctionDays, 1, 30, 'Длительность аукциона');
      const order = { id: randomUUID(), title, description, category: input.category, budget, deliveryDays, tags: [input.category], ownerId: user.id, ownerName: user.name, createdAt: Date.now(), deadline: Date.now() + auctionDays * 86400000, status: 'open', bids: [] };
      db.orders.unshift(order); persist(); return json(res, 201, { order: orderView(order) });
    }
    const bidRoute = /^\/api\/orders\/([^/]+)\/bids$/.exec(url.pathname);
    if (bidRoute && req.method === 'POST') {
      const user = requireUser(req), input = await body(req), order = db.orders.find(o => o.id === bidRoute[1]);
      if (!order) fail('Заказ не найден.', 404);
      if (order.status !== 'open' || order.deadline <= Date.now()) fail('Аукцион уже завершён.', 409);
      if (order.ownerId === user.id) fail('Нельзя делать ставку на свой заказ.', 403);
      const amount = integer(input.amount, 1, 10000000, 'Ставка');
      const current = order.bids.at(-1)?.amount ?? order.budget;
      if (amount >= current) fail(`Предложите цену ниже ${current.toLocaleString('ru-RU')} ₽.`, 409);
      const comment = input.comment ? str(input.comment, 1, 500, 'Комментарий') : 'Готов выполнить проект по указанной цене.';
      order.bids.push({ id: randomUUID(), userId: user.id, name: user.name, amount, comment, createdAt: Date.now() });
      persist(); return json(res, 201, { order: orderView(order) });
    }
    const acceptRoute = /^\/api\/orders\/([^/]+)\/accept$/.exec(url.pathname);
    if (acceptRoute && req.method === 'POST') {
      const user = requireUser(req), input = await body(req), order = db.orders.find(o => o.id === acceptRoute[1]);
      if (!order) fail('Заказ не найден.', 404);
      if (order.ownerId !== user.id) fail('Выбрать исполнителя может только заказчик.', 403);
      if (order.status !== 'open') fail('Исполнитель уже выбран.', 409);
      if (!order.bids.some(b => b.id === input.bidId)) fail('Предложение не найдено.', 404);
      order.status = 'assigned'; order.acceptedBidId = input.bidId; persist(); return json(res, 200, { order: orderView(order) });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Маршрут не найден.' });
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Метод не поддерживается.' });
    const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
    const file = files[url.pathname];
    if (!file) return json(res, 404, { error: 'Страница не найдена.' });
    const content = readFileSync(resolve(root, 'public', file[0]));
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : 'Не удалось сохранить изменения. Попробуйте ещё раз.' }); if (!error.status) console.error(error); }
});
const port = Number(process.env.PORT || 3210);
server.listen(port, '127.0.0.1', () => console.log(`StockMarket: http://127.0.0.1:${server.address().port}`));
