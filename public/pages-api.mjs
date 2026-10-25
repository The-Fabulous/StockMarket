import { categories, createDemoData } from './seed.mjs';

// Browser-only demo. This adapter is not a shared service or a security boundary.
export function createBrowserApi({ local = localStorage, session = sessionStorage, locks = globalThis.navigator?.locks, now = Date.now } = {}) {
  const databaseKey = 'stockmarket-pages-database-v1';
  const sessionKey = 'stockmarket-pages-session-v1';
  let initialData;
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const text = (value, min, max, label) => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(`${label}: от ${min} до ${max} символов.`);
    return value.trim();
  };
  const integer = (value, min, max, label) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}: число от ${min} до ${max}.`);
    return value;
  };
  function load() {
    let stored;
    try { stored = local.getItem(databaseKey); } catch { /* Browsing works without storage. */ }
    if (stored) {
      try { const data = JSON.parse(stored); if (Array.isArray(data.users) && Array.isArray(data.orders)) return data; } catch {}
      fail('Демо-данные повреждены. Очисти данные этого сайта в браузере.', 500);
    }
    initialData ??= createDemoData(now());
    return structuredClone(initialData);
  }
  function save(data) {
    try { local.setItem(databaseKey, JSON.stringify(data)); }
    catch { fail('Браузер не сохранил данные. Разреши хранение данных для этого сайта и попробуй ещё раз.', 500); }
  }
  const publicUser = (user) => user ? { id: user.id, name: user.name, login: user.login } : null;
  function userFrom(data) { let id; try { id = session.getItem(sessionKey); } catch {} return data.users.find(user => user.id === id) || null; }
  function requireUser(data) { const user = userFrom(data); if (!user) fail('Войди, чтобы продолжить.', 401); return user; }
  function signIn(user) { try { session.setItem(sessionKey, user.id); } catch { fail('Разреши хранение данных в браузере, чтобы войти.', 500); } }
  const orderView = (order) => ({ ...order, status: order.status === 'open' && order.deadline <= now() ? 'expired' : order.status });
  async function passwordHash(password, salt) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 210000, hash: 'SHA-256' }, key, 256);
    return [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function dispatch(path, input) {
    const data = load();
    if (path === '/me' && input === undefined) return { user: publicUser(userFrom(data)) };
    if (path === '/orders' && input === undefined) return { orders: data.orders.map(orderView), categories };
    if (path === '/logout') { try { session.removeItem(sessionKey); } catch {} return { ok: true }; }
    if (path === '/login' || path === '/register') {
      const login = text(input?.login, 3, 32, 'Логин').toLowerCase();
      if (!/^[a-z0-9_.-]+$/.test(login)) fail('В логине используй латинские буквы, цифры, точку, дефис или подчёркивание.');
      const password = text(input.password, 8, 128, 'Пароль');
      let user = data.users.find(user => user.login === login);
      if (path === '/register') {
        if (user) fail('Этот логин уже занят.', 409);
        const name = text(input.name, 2, 50, 'Имя');
        const salt = crypto.randomUUID();
        user = { id: crypto.randomUUID(), login, name, salt, hash: await passwordHash(password, salt) };
        data.users.push(user); save(data);
      } else {
        const demo = login === 'demo' && password === 'stockmarket';
        if (!demo && (!user?.hash || await passwordHash(password, user.salt) !== user.hash)) fail('Неверный логин или пароль.', 401);
        save(data);
      }
      signIn(user); return { user: publicUser(user) };
    }
    if (path === '/orders' && input !== undefined) {
      const user = requireUser(data);
      const title = text(input.title, 5, 100, 'Название');
      const description = text(input.description, 20, 4000, 'Описание');
      if (!categories.includes(input.category)) fail('Выбери категорию.');
      const budget = integer(input.budget, 100, 10000000, 'Бюджет');
      const deliveryDays = integer(input.deliveryDays, 1, 365, 'Срок');
      const auctionDays = integer(input.auctionDays, 1, 30, 'Длительность аукциона');
      const order = { id: crypto.randomUUID(), title, description, category: input.category, budget, deliveryDays, tags: [input.category], ownerId: user.id, ownerName: user.name, createdAt: now(), deadline: now() + auctionDays * 86400000, status: 'open', bids: [] };
      data.orders.unshift(order); save(data); return { order: orderView(order) };
    }
    const match = /^\/orders\/([^/]+)\/(bids|accept)$/.exec(path);
    if (match) {
      const user = requireUser(data), order = data.orders.find(order => order.id === match[1]);
      if (!order) fail('Заказ не найден.', 404);
      if (match[2] === 'accept') {
        if (order.ownerId !== user.id) fail('Выбрать исполнителя может только заказчик.', 403);
        if (order.status !== 'open') fail('Исполнитель уже выбран.', 409);
        if (!order.bids.some(bid => bid.id === input.bidId)) fail('Предложение не найдено.', 404);
        order.status = 'assigned'; order.acceptedBidId = input.bidId;
      } else {
        if (order.status !== 'open' || order.deadline <= now()) fail('Аукцион уже завершён.', 409);
        if (order.ownerId === user.id) fail('Нельзя делать ставку на свой заказ.', 403);
        const amount = integer(input.amount, 1, 10000000, 'Ставка');
        const current = order.bids.at(-1)?.amount ?? order.budget;
        if (amount >= current) fail(`Предложи цену ниже ${current.toLocaleString('ru-RU')} ₽.`, 409);
        const comment = input.comment ? text(input.comment, 1, 500, 'Комментарий') : 'Готов выполнить проект по указанной цене.';
        order.bids.push({ id: crypto.randomUUID(), userId: user.id, name: user.name, amount, comment, createdAt: now() });
      }
      save(data); return { order: orderView(order) };
    }
    fail('Действие не поддерживается.', 404);
  }
  let queue = Promise.resolve();
  return (path, input) => {
    if (input === undefined) return dispatch(path, input);
    const operation = () => locks ? locks.request('stockmarket-pages-write', () => dispatch(path, input)) : dispatch(path, input);
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  };
}
