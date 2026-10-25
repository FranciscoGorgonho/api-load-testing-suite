// API de e-commerce simulada, com modelo de capacidade realista.
//
// - WORKERS requisições são processadas em paralelo; as demais entram em fila.
// - Fila acima de QUEUE_LIMIT => 503 (load shedding), como um gateway real.
// - CHAOS_ERROR_RATE / CHAOS_LATENCY_MS injetam falhas para validar os gates.
//
// Sem dependências: `node mock-api/server.mjs`

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3333);
const WORKERS = Number(process.env.MOCK_WORKERS ?? 20);
const QUEUE_LIMIT = Number(process.env.MOCK_QUEUE_LIMIT ?? 150);
const CHAOS_ERROR_RATE = Number(process.env.CHAOS_ERROR_RATE ?? 0);
const CHAOS_LATENCY_MS = Number(process.env.CHAOS_LATENCY_MS ?? 0);

// Tempo de serviço base por rota (ms). O checkout é deliberadamente mais caro.
const SERVICE_TIME = {
  login: 90,
  listProducts: 35,
  productDetail: 25,
  search: 60,
  createCart: 30,
  addItem: 40,
  createOrder: 140,
};

const products = Array.from({ length: 120 }, (_, i) => ({
  id: i + 1,
  name: `Produto ${i + 1}`,
  category: ['eletronicos', 'casa', 'moda', 'livros'][i % 4],
  price: Math.round((19.9 + ((i * 37) % 900)) * 100) / 100,
  stock: 1_000_000,
}));
const users = new Map(
  Array.from({ length: 200 }, (_, i) => [`user${i + 1}@shop.test`, 'Senha@123']),
);
const sessions = new Map(); // token -> email
const carts = new Map(); // cartId -> { items, owner }
const orders = new Map(); // idempotencyKey -> order

// ---------- modelo de capacidade ----------
let inFlight = 0;
const queue = [];

function acquire() {
  if (inFlight < WORKERS) {
    inFlight++;
    return Promise.resolve(true);
  }
  if (queue.length >= QUEUE_LIMIT) return Promise.resolve(false);
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next(true);
  else inFlight--;
}

const jitter = (base) => base * (0.7 + Math.random() * 0.6);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- helpers HTTP ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function authUser(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  return sessions.get(token);
}

// ---------- rotas ----------
const routes = [
  ['GET', /^\/health$/, 'health', async () => [200, { status: 'ok', inFlight, queued: queue.length }]],

  ['POST', /^\/auth\/login$/, 'login', async (req) => {
    const body = await readJson(req);
    if (!body?.email || users.get(body.email) !== body.password) return [401, { error: 'invalid_credentials' }];
    const token = randomUUID();
    sessions.set(token, body.email);
    return [200, { accessToken: token, expiresIn: 300 }];
  }],

  ['GET', /^\/products$/, 'listProducts', async (_req, _m, url) => {
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const size = Math.min(50, Number(url.searchParams.get('size') ?? 20));
    const items = products.slice((page - 1) * size, page * size);
    return [200, { page, size, total: products.length, items }];
  }],

  ['GET', /^\/products\/(\d+)$/, 'productDetail', async (_req, m) => {
    const product = products.find((p) => p.id === Number(m[1]));
    return product ? [200, product] : [404, { error: 'not_found' }];
  }],

  ['GET', /^\/search$/, 'search', async (_req, _m, url) => {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const items = products.filter((p) => p.name.toLowerCase().includes(q) || p.category === q).slice(0, 20);
    return [200, { q, items }];
  }],

  ['POST', /^\/cart$/, 'createCart', async (req) => {
    const owner = authUser(req);
    if (!owner) return [401, { error: 'unauthorized' }];
    const id = randomUUID();
    carts.set(id, { owner, items: [] });
    return [201, { cartId: id }];
  }],

  ['POST', /^\/cart\/([\w-]+)\/items$/, 'addItem', async (req, m) => {
    const owner = authUser(req);
    const cart = carts.get(m[1]);
    if (!owner) return [401, { error: 'unauthorized' }];
    if (!cart || cart.owner !== owner) return [404, { error: 'cart_not_found' }];
    const body = await readJson(req);
    const product = products.find((p) => p.id === body?.productId);
    if (!product || !(body.quantity > 0)) return [422, { error: 'invalid_item' }];
    cart.items.push({ productId: product.id, quantity: body.quantity, price: product.price });
    const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
    return [200, { cartId: m[1], items: cart.items.length, total: Math.round(total * 100) / 100 }];
  }],

  ['POST', /^\/orders$/, 'createOrder', async (req) => {
    const owner = authUser(req);
    if (!owner) return [401, { error: 'unauthorized' }];
    const key = req.headers['idempotency-key'];
    if (!key) return [400, { error: 'idempotency_key_required' }];
    if (orders.has(key)) return [200, orders.get(key)]; // replay idempotente
    const body = await readJson(req);
    const cart = carts.get(body?.cartId);
    if (!cart || cart.owner !== owner || cart.items.length === 0) return [422, { error: 'invalid_cart' }];
    const total = Math.round(cart.items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
    const order = { orderId: randomUUID(), status: 'CONFIRMED', total };
    orders.set(key, order);
    carts.delete(body.cartId);
    return [201, order];
  }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = routes.find(([method, re]) => method === req.method && re.test(url.pathname));
  if (!route) return send(res, 404, { error: 'route_not_found' });
  const [, re, name, handler] = route;

  if (name === 'health') return send(res, ...(await handler()));

  if (!(await acquire())) return send(res, 503, { error: 'overloaded' }, { 'Retry-After': '1' });
  try {
    await sleep(jitter(SERVICE_TIME[name]) + CHAOS_LATENCY_MS);
    if (Math.random() < CHAOS_ERROR_RATE) return send(res, 500, { error: 'chaos_injected' });
    const [status, body] = await handler(req, url.pathname.match(re), url);
    send(res, status, body);
  } catch (err) {
    send(res, 500, { error: 'internal', detail: String(err) });
  } finally {
    release();
  }
});

server.listen(PORT, () => {
  console.log(`mock e-commerce API em http://localhost:${PORT} (workers=${WORKERS}, queueLimit=${QUEUE_LIMIT})`);
  if (CHAOS_ERROR_RATE > 0 || CHAOS_LATENCY_MS > 0) {
    console.log(`⚠ CHAOS ATIVO: ${CHAOS_ERROR_RATE * 100}% de erro, +${CHAOS_LATENCY_MS}ms de latência`);
  }
});
