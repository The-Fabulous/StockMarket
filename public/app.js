const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (value) => `${Number(value).toLocaleString('ru-RU')} ₽`;
const plural = (number, forms) => `${number} ${forms[number % 100 >= 11 && number % 100 <= 14 ? 2 : number % 10 === 1 ? 0 : number % 10 >= 2 && number % 10 <= 4 ? 1 : 2]}`;
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  bookmark: '<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4Z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8V5l14-3v3m4 6h-6v5h6"/><path d="M17 13.5h.01"/>',
  trend: '<path d="m3 6 7 7 4-4 7 9m-7 0h7v-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sort: '<path d="M4 6h16M7 12h10m-7 6h4"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`; }
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const storage = { get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Browser storage is optional. */ } } };
const storedFavorites = storage.get('sm-favorites', []);
const state = { user: null, orders: [], categories: [], view: 'all', category: 'Все', query: '', sort: 'new', favorites: new Set(Array.isArray(storedFavorites) ? storedFavorites : []), selectedId: null, authMode: 'login', afterAuth: null };
let toastTimeout;
const browserDemo = document.documentElement.dataset.mode === 'demo' || location.hostname.endsWith('.github.io');
const demoApi = browserDemo ? import(new URL('./pages-api.mjs', document.currentScript.src)).then(module => module.createBrowserApi()) : null;
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimeout); toastTimeout = setTimeout(() => el.classList.remove('show'), 4200); }
async function api(path, data) {
  if (demoApi) return (await demoApi)(path, data);
  let response;
  try { response = await fetch(`/api${path}`, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
  catch { throw new Error('Сервер недоступен. Проверь, что StockMarket запущен.'); }
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'Не удалось выполнить действие.'); error.status = response.status; throw error; }
  return result;
}
function initials(name) { return name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }
function relativeTime(time) { const mins = Math.max(0, Math.floor((Date.now() - time) / 60000)); if (mins < 1) return 'только что'; if (mins < 60) return `${mins} мин назад`; if (mins < 1440) return `${Math.floor(mins / 60)} ч назад`; return `${Math.floor(mins / 1440)} дн назад`; }
function timeLeft(order) { if (order.status === 'assigned') return 'Исполнитель выбран'; const ms = order.deadline - Date.now(); if (ms <= 0) return 'Приём завершён'; if (ms < 3600000) return `${Math.max(1, Math.ceil(ms / 60000))} мин осталось`; if (ms < 86400000) return `${Math.ceil(ms / 3600000)} ч осталось`; return `${Math.ceil(ms / 86400000)} дн осталось`; }
const categoryClass = (c) => ({ 'Дизайн': 'design', 'Тексты': 'copy', 'Видео и аудио': 'video', 'Маркетинг': 'marketing' }[c] || '');
const currentPrice = (o) => o.bids.at(-1)?.amount ?? o.budget;
const discount = (o) => Math.round((1 - currentPrice(o) / o.budget) * 100);
const active = (o) => o.status === 'open' && o.deadline > Date.now();
function showDialog(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
function auth(after = null) { state.afterAuth = after; $('#auth-error').textContent = ''; showDialog('auth-dialog'); }
function updateAccount() { $('#account-name').textContent = state.user?.name || 'Войти'; $('#account-avatar').textContent = state.user ? initials(state.user.name) : 'Г'; $('#profile-name').textContent = state.user?.name || ''; $('#profile-login').textContent = state.user ? `@${state.user.login}` : ''; }

function renderFilters() {
  $('#side-categories').innerHTML = state.categories.map(c => `<button data-category="${escapeHTML(c)}" class="${state.category === c ? 'active' : ''}"><span class="category-dot"></span>${escapeHTML(c)}</button>`).join('');
  $('#filter-chips').innerHTML = ['Все', ...state.categories].map(c => `<button data-category="${escapeHTML(c)}" class="${state.category === c ? 'active' : ''}" aria-pressed="${state.category === c}">${escapeHTML(c)}</button>`).join('');
  $('#create-category').innerHTML = state.categories.map(c => `<option>${escapeHTML(c)}</option>`).join('');
}
function renderStats() {
  const open = state.orders.filter(active);
  $('#stat-orders').textContent = open.length;
  $('#nav-count').textContent = open.length;
  $('#favorite-count').textContent = state.favorites.size;
  const total = open.reduce((sum, o) => sum + o.budget, 0);
  $('#stat-budget').textContent = total >= 1000000 ? `${(total / 1000000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} млн ₽` : money(total);
  $('#stat-bids').textContent = state.orders.reduce((sum, o) => sum + o.bids.length, 0);
  const withBids = open.filter(o => o.bids.length);
  $('#stat-saving').textContent = withBids.length ? `↘ ${Math.round(withBids.reduce((sum, o) => sum + discount(o), 0) / withBids.length)}%` : '0%';
}
function renderCards() {
  let orders = state.orders.filter(o => {
    if (state.view === 'all' && !active(o)) return false;
    if (state.view === 'favorites' && !state.favorites.has(o.id)) return false;
    if (state.view === 'bids' && (!state.user || !o.bids.some(b => b.userId === state.user.id))) return false;
    if (state.view === 'mine' && o.ownerId !== state.user?.id) return false;
    if (state.category !== 'Все' && o.category !== state.category) return false;
    return `${o.title} ${o.description} ${o.tags.join(' ')}`.toLowerCase().includes(state.query.toLowerCase());
  });
  orders.sort({ new: (a, b) => b.createdAt - a.createdAt, budget: (a, b) => b.budget - a.budget, ending: (a, b) => a.deadline - b.deadline, activity: (a, b) => b.bids.length - a.bids.length }[state.sort]);
  $('#result-count').textContent = orders.length;
  if (!orders.length) {
    const isAuth = !state.user && ['mine', 'bids'].includes(state.view);
    const isFiltered = state.query || state.category !== 'Все';
    $('#orders-grid').innerHTML = `<div class="empty-state">${icon(isAuth ? 'users' : 'search')}<h3>${isAuth ? 'Здесь будет твоя работа' : 'Пока ничего не нашлось'}</h3><p>${isAuth ? 'Войди, чтобы увидеть свои заказы и предложения.' : isFiltered ? 'Попробуй другое название или выбери другую категорию.' : state.view === 'favorites' ? 'Нажми на закладку у понравившегося проекта, чтобы сохранить его здесь.' : 'Начни с первого проекта — вся история появится здесь.'}</p>${isAuth ? '<button class="button dark" data-action="login">Войти в аккаунт</button>' : isFiltered ? '<button class="button outline" data-action="reset">Сбросить фильтры</button>' : ''}</div>`;
    return;
  }
  $('#orders-grid').innerHTML = orders.map(o => {
    const saved = state.favorites.has(o.id);
    const bidders = [...new Map(o.bids.map(b => [b.userId, b])).values()].slice(-3);
    return `<article class="order-card"><div class="card-top"><span class="category-badge ${categoryClass(o.category)}">${escapeHTML(o.category)}</span><button class="icon-button bookmark-button ${saved ? 'saved' : ''}" data-favorite="${o.id}" aria-label="${saved ? 'Убрать из избранного' : 'В избранное'}: ${escapeHTML(o.title)}" aria-pressed="${saved}">${icon('bookmark')}</button></div><button class="card-title" data-order="${o.id}">${escapeHTML(o.title)}</button><p class="order-description">${escapeHTML(o.description)}</p><div class="tags">${o.tags.map(t => `<span>${escapeHTML(t)}</span>`).join('')}</div><div class="price-row"><div><span class="price-label">${o.bids.length ? 'Текущая цена' : 'Стартовый бюджет'}</span><strong class="price-value">${money(currentPrice(o))}</strong>${o.bids.length ? `<span class="original-price">${money(o.budget)}</span>` : ''}</div>${o.bids.length ? `<span class="discount">↘ ${discount(o)}%</span>` : '<span class="discount">Новый</span>'}</div><div class="card-meta"><span>${icon('activity')}${plural(o.bids.length, ['предложение', 'предложения', 'предложений'])}</span><span>${icon('clock')}${timeLeft(o)}</span></div><div class="card-bottom"><div class="bidder-stack">${bidders.length ? bidders.map(b => `<span class="mini-avatar" title="${escapeHTML(b.name)}">${escapeHTML(initials(b.name))}</span>`).join('') : '<span class="empty-bid-label">Будь первым</span>'}</div><button data-order="${o.id}">Посмотреть заказ <span>↗</span></button></div></article>`;
  }).join('');
}
function renderActivity() {
  const bids = state.orders.flatMap(o => o.bids.map(b => ({ ...b, order: o }))).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  $('#activity-feed').innerHTML = bids.map(b => `<div class="activity-item"><span class="avatar activity-avatar">${escapeHTML(initials(b.name))}</span><div><strong class="activity-name">${escapeHTML(b.name)}</strong><button class="activity-project" data-order="${b.order.id}">${escapeHTML(b.order.title)}</button><div class="activity-price"><span>${money(b.amount)} ↘</span><small>${relativeTime(b.createdAt)}</small></div></div></div>`).join('') || '<p class="no-history">Здесь появятся первые предложения.</p>';
}
function render() { renderStats(); renderCards(); renderActivity(); updateAccount(); }
function setView(view) {
  state.view = view; state.category = 'Все';
  const names = { all: 'Все заказы', favorites: 'Избранное', bids: 'Мои предложения', mine: 'Мои заказы' };
  $('#breadcrumb-current').textContent = names[view];
  $('#page-title').innerHTML = `${view === 'all' ? 'Биржа заказов' : names[view]}<span class="title-dot">.</span>`;
  $('#page-subtitle').textContent = { all: 'Найди свой проект. Предложи свою цену. Начни создавать.', favorites: 'Проекты, к которым хочется вернуться.', bids: 'Твои ставки и проекты, в которых ты участвуешь.', mine: 'Твои задачи, предложения и будущие исполнители.' }[view];
  $('#hero').hidden = view !== 'all';
  $('#list-title').innerHTML = `${view === 'all' ? 'Открытые заказы' : names[view]} <span id="result-count">0</span>`;
  $$('.nav-item').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'); });
  closeMenu(); renderFilters(); render();
}
function priceChart(o) {
  const prices = [o.budget, ...o.bids.map(b => b.amount)];
  const min = Math.min(...prices) * .9, max = o.budget * 1.04;
  const points = prices.map((p, i) => [12 + i * 376 / Math.max(prices.length - 1, 1), 105 - (p - min) / (max - min) * 95]);
  const path = points.reduce((s, p, i) => i ? `${s} H ${p[0]} V ${p[1]}` : `M ${p[0]} ${p[1]}`, '');
  return `<div class="chart-wrap"><div class="chart-caption"><span>От стартового бюджета к текущей цене</span><span>↘ ${discount(o)}%</span></div><svg class="price-chart" viewBox="0 0 400 120" preserveAspectRatio="none" role="img" aria-label="Цена снизилась с ${money(o.budget)} до ${money(currentPrice(o))}"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#c4df9d" stop-opacity=".45"/><stop offset="100%" stop-color="#c4df9d" stop-opacity=".04"/></linearGradient></defs><path d="M12 30H388M12 65H388M12 100H388" stroke="#e8efde" stroke-width="1" stroke-dasharray="4 4"/><path d="${path} L ${points.at(-1)[0]} 118 H12 Z" fill="url(#chart-fill)"/><path d="${path}" fill="none" stroke="#8bad5b" stroke-width="2"/>${points.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#8bad5b" stroke="#fff" stroke-width="2"/>`).join('')}</svg><div class="chart-labels"><span>Старт · ${money(o.budget)}</span><span>Сейчас · ${money(currentPrice(o))}</span></div></div>`;
}
function openOrder(id, preserve = false) {
  const o = state.orders.find(o => o.id === id); if (!o) return;
  state.selectedId = id;
  const oldAmount = preserve ? $('#bid-form [name=amount]')?.value : null;
  const oldComment = preserve ? $('#bid-form [name=comment]')?.value : null;
  const oldFocused = preserve && $('#detail-dialog').contains(document.activeElement) ? document.activeElement.name : null;
  const own = o.ownerId === state.user?.id;
  const selected = o.bids.find(b => b.id === o.acceptedBidId);
  const available = active(o);
  $('#detail-content').innerHTML = `<div class="detail-top"><span>Биржа заказов / ${escapeHTML(o.category)}</span><button class="icon-button" data-close="detail-dialog" aria-label="Закрыть заказ">${icon('close')}</button></div><div class="detail-body"><section class="detail-main"><span class="category-badge ${categoryClass(o.category)}">${escapeHTML(o.category)}</span><h2>${escapeHTML(o.title)}</h2><div class="detail-owner"><span class="avatar">${escapeHTML(initials(o.ownerName))}</span><span>${escapeHTML(o.ownerName)} · заказчик</span>${o.example ? '<span class="example-pill">Пример заказа</span>' : ''}</div><h3>О проекте</h3><p class="detail-description">${escapeHTML(o.description)}</p><div class="tags">${o.tags.map(t => `<span>${escapeHTML(t)}</span>`).join('')}</div><h3>Как менялась цена</h3>${priceChart(o)}<div class="history-heading"><h3>История предложений</h3><span>${plural(o.bids.length, ['ставка', 'ставки', 'ставок'])}</span></div><div class="bid-history">${[...o.bids].reverse().map((b, index) => `<div class="bid-item"><span class="avatar">${escapeHTML(initials(b.name))}</span><div><div class="bid-name">${escapeHTML(b.name)}${b.userId === state.user?.id ? ' · ты' : ''}</div><div class="bid-date">${new Date(b.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div><p class="bid-comment">${escapeHTML(b.comment)}</p></div><div class="bid-amount">${money(b.amount)}${b.id === o.acceptedBidId ? '<span class="best-label">ИСПОЛНИТЕЛЬ ВЫБРАН</span>' : index === 0 ? '<span class="best-label">МИНИМАЛЬНАЯ ЦЕНА</span>' : ''}${own && o.status !== 'assigned' ? `<button class="accept-button" data-accept="${b.id}">Выбрать исполнителя</button>` : ''}</div></div>`).join('') || '<p class="no-history">Предложений пока нет. Твоя ставка может стать первой.</p>'}</div></section><aside class="detail-sidebar"><div class="bid-box"><span class="price-label">${o.bids.length ? 'Текущее предложение' : 'Стартовый бюджет'}</span><strong class="price-value">${money(currentPrice(o))}</strong>${o.bids.length ? `<p class="original-budget">Стартовый бюджет: <span>${money(o.budget)}</span></p><span class="discount">↘ На ${discount(o)}% ниже бюджета</span>` : ''}<div class="order-facts"><div><span>На выполнение</span><strong>${plural(o.deliveryDays, ['день', 'дня', 'дней'])}</strong></div><div><span>Аукцион</span><strong>${timeLeft(o)}</strong></div></div><p class="bid-explanation">${own ? 'Сравни предложения и выбери исполнителя в истории ставок.' : 'Предложи цену ниже текущей. Расскажи, почему тебе стоит доверить проект.'}</p>${selected ? `<div class="assigned-notice">Исполнитель: <strong>${escapeHTML(selected.name)}</strong><br>Стоимость работы: ${money(selected.amount)}</div>` : !available ? '<div class="assigned-notice">Приём предложений завершён. Заказчик может выбрать исполнителя из истории.</div>' : own ? '<div class="assigned-notice">Это твой заказ. Здесь появятся предложения исполнителей.</div>' : !state.user ? '<button class="button dark full-width" data-action="login">Войти и предложить цену ↗</button>' : currentPrice(o) <= 1 ? '<div class="assigned-notice">Достигнута минимальная цена — 1 ₽.</div>' : `<form id="bid-form"><label>Твоё предложение, ₽<input name="amount" type="number" min="1" max="${currentPrice(o) - 1}" step="1" value="${Math.max(1, currentPrice(o) - Math.max(1, Math.round(currentPrice(o) * .05)))}" required></label><label>Пара слов о твоём подходе<textarea name="comment" rows="3" maxlength="500" placeholder="Опыт, похожие задачи, что входит в стоимость"></textarea></label><p class="form-error" id="bid-error" role="alert"></p><button class="button dark full-width" type="submit">Предложить свою цену <span>↘</span></button></form>`}</div><p class="bid-help">Заказчик выбирает исполнителя сам. Самая низкая ставка не гарантирует победу. Предлагай комфортную для себя цену.</p></aside></div>`;
  if (oldAmount !== null && $('#bid-form')) { $('#bid-form [name=amount]').value = oldAmount; $('#bid-form [name=comment]').value = oldComment || ''; }
  if (oldFocused) $(`#bid-form [name="${oldFocused}"]`)?.focus({ preventScroll: true });
  showDialog('detail-dialog');
}
function replaceOrder(order) { const i = state.orders.findIndex(o => o.id === order.id); if (i < 0) state.orders.unshift(order); else state.orders[i] = order; render(); }
function closeMenu() { $('#sidebar').classList.remove('open'); $('#mobile-menu').setAttribute('aria-expanded', 'false'); }
function createOrder() { if (!state.user) return auth(createOrder); $('#create-error').textContent = ''; showDialog('create-dialog'); }

document.addEventListener('click', async event => {
  const target = event.target.closest('button, a'); if (!target) return;
  if (target.dataset.close) $(`#${target.dataset.close}`).close();
  if (target.dataset.order) openOrder(target.dataset.order);
  if (target.dataset.view) setView(target.dataset.view);
  if (target.dataset.category) { state.category = target.dataset.category; closeMenu(); renderFilters(); renderCards(); }
  if (target.dataset.favorite) { const id = target.dataset.favorite; state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); storage.set('sm-favorites', [...state.favorites]); renderStats(); renderCards(); }
  if (target.dataset.action === 'login') auth();
  if (target.dataset.action === 'reset') { state.query = ''; state.category = 'Все'; $('#search').value = ''; renderFilters(); renderCards(); }
  if (target.classList.contains('brand')) { event.preventDefault(); setView('all'); }
  if (target.dataset.auth) {
    state.authMode = target.dataset.auth; const registering = state.authMode === 'register';
    $$('[data-auth]').forEach(b => b.classList.toggle('active', b.dataset.auth === state.authMode));
    $('#name-label').hidden = !registering; $('#auth-form [name=name]').required = registering;
    $('#auth-title').textContent = registering ? 'Начнём с знакомства.' : 'Привет, это твой рынок.';
    $('#auth-subtitle').textContent = registering ? 'Создай аккаунт, чтобы публиковать задачи и предлагать свою цену.' : 'Войди, чтобы находить проекты и оставлять предложения.';
    $('#auth-submit').innerHTML = `${registering ? 'Создать аккаунт' : 'Войти'} <span>↗</span>`;
    $('#auth-form [name=password]').autocomplete = registering ? 'new-password' : 'current-password';
    $('#auth-error').textContent = '';
  }
  if (target.dataset.accept) {
    target.disabled = true;
    try { const { order } = await api(`/orders/${state.selectedId}/accept`, { bidId: target.dataset.accept }); replaceOrder(order); openOrder(order.id); }
    catch (e) { target.textContent = e.message; target.disabled = false; }
  }
});
$('#auth-dialog').addEventListener('close', () => { try { sessionStorage.setItem('sm-welcomed', '1'); } catch {} });
$('#detail-dialog').addEventListener('close', () => { state.selectedId = null; });
$$('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); }));
$('#account-button').addEventListener('click', () => state.user ? showDialog('account-dialog') : auth());
$('#create-order').addEventListener('click', createOrder);
$('#how-button').addEventListener('click', () => showDialog('how-dialog'));
$('#explore-button').addEventListener('click', () => { $('#market').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#search').focus({ preventScroll: true }); });
$('#mobile-menu').addEventListener('click', () => { const isOpen = $('#sidebar').classList.toggle('open'); $('#mobile-menu').setAttribute('aria-expanded', String(isOpen)); });
document.addEventListener('click', e => { if (!$('#sidebar').contains(e.target) && !$('#mobile-menu').contains(e.target)) closeMenu(); });
$('#search').addEventListener('input', e => { state.query = e.target.value.trim(); renderCards(); });
$('#sort').addEventListener('change', e => { state.sort = e.target.value; renderCards(); });
document.addEventListener('keydown', e => { if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('dialog[open]')) { e.preventDefault(); $('#search').focus(); } if (e.key === 'Escape') closeMenu(); });
$('#toggle-password').addEventListener('click', () => { const input = $('#auth-form [name=password]'); input.type = input.type === 'password' ? 'text' : 'password'; $('#toggle-password').setAttribute('aria-label', input.type === 'password' ? 'Показать пароль' : 'Скрыть пароль'); });
$('#fill-demo').addEventListener('click', () => { $('[data-auth=login]').click(); $('#auth-form [name=login]').value = 'demo'; $('#auth-form [name=password]').value = 'stockmarket'; $('#auth-submit').focus(); });
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = $('#auth-submit'); submit.disabled = true; $('#auth-error').textContent = '';
  try {
    const result = await api(`/${state.authMode}`, Object.fromEntries(new FormData(event.target)));
    state.user = result.user; $('#auth-form [name=password]').value = ''; $('#auth-dialog').close(); render();
    if (state.selectedId) openOrder(state.selectedId, true);
    const next = state.afterAuth; state.afterAuth = null; if (next) next();
    toast(`С возвращением, ${state.user.name}!`);
  } catch (e) { $('#auth-error').textContent = e.message; } finally { submit.disabled = false; }
});
$('#logout-button').addEventListener('click', async () => {
  try { await api('/logout', {}); state.user = null; $('#account-dialog').close(); render(); if (state.selectedId) openOrder(state.selectedId); toast('Ты вышел из аккаунта. Можно продолжить как гость.'); }
  catch (e) { $('#profile-login').textContent = e.message; }
});
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = $('button[type=submit]', event.target); submit.disabled = true; $('#create-error').textContent = '';
  const input = Object.fromEntries(new FormData(event.target)); ['budget', 'deliveryDays', 'auctionDays'].forEach(k => { input[k] = Number(input[k]); });
  try { const { order } = await api('/orders', input); replaceOrder(order); event.target.reset(); $('#create-dialog').close(); setView('mine'); openOrder(order.id); }
  catch (e) { $('#create-error').textContent = e.message; } finally { submit.disabled = false; }
});
$('#detail-content').addEventListener('submit', async event => {
  if (event.target.id !== 'bid-form') return;
  event.preventDefault(); const submit = $('button[type=submit]', event.target); submit.disabled = true; $('#bid-error').textContent = '';
  const input = Object.fromEntries(new FormData(event.target)); input.amount = Number(input.amount);
  try { const { order } = await api(`/orders/${state.selectedId}/bids`, input); replaceOrder(order); openOrder(order.id); }
  catch (e) { const error = $('#bid-error'); if (error) error.textContent = e.message; } finally { if (submit.isConnected) submit.disabled = false; }
});

let refreshBusy = false;
async function refresh() {
  if (document.hidden || refreshBusy) return;
  refreshBusy = true;
  try {
    const { orders } = await api('/orders');
    const before = state.orders.find(o => o.id === state.selectedId);
    const after = orders.find(o => o.id === state.selectedId);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    state.orders = orders; render();
    if (state.selectedId && changed && !$('#bid-form button[type=submit]')?.disabled) openOrder(state.selectedId, true);
  } catch { /* Existing content remains available; mutations report their own errors. */ }
  finally { refreshBusy = false; }
}
async function init() {
  $('#year').textContent = new Date().getFullYear();
  if (browserDemo) {
    $('.local-badge').textContent = 'Браузерное демо';
    $('.auth-note').textContent = 'Демо-аккаунты и проекты сохраняются только в этом браузере.';
    if (!$('.demo-banner')) {
      const banner = document.createElement('p');
      banner.className = 'demo-banner';
      banner.textContent = 'Демо-версия: аккаунты, заказы и ставки сохраняются только в этом браузере и не видны другим посетителям.';
      $('.page-heading').after(banner);
    }
  }
  try {
    const [me, listing] = await Promise.all([api('/me'), api('/orders')]);
    state.user = me.user; state.orders = listing.orders; state.categories = listing.categories;
    renderFilters(); render();
    let welcomed = false; try { welcomed = sessionStorage.getItem('sm-welcomed') === '1'; } catch {}
    if (!state.user && !welcomed) auth();
    setInterval(refresh, 15000);
  } catch (e) { $('#orders-grid').innerHTML = `<div class="empty-state error-banner"><h3>Не удалось загрузить проекты</h3><p>${escapeHTML(e.message)}</p><button class="button outline" id="retry">Попробовать ещё раз</button></div>`; $('#retry').addEventListener('click', init); }
}
init();
