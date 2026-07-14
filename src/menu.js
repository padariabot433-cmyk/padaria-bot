import { MenuItem } from './db.js';

// Cardápio inicial — usado só pra popular o banco na primeira vez que o bot
// rodar (se a coleção "menu_items" estiver vazia). Depois disso, o cardápio
// é editado pelo painel (/site) e vive no MongoDB.
const DEFAULT_MENU = [
  { id: 1, name: 'Pão Francês (pacote)', price: 0.75 },
  { id: 2, name: 'Pão de Forma (pacote)', price: 8.5 },
  { id: 3, name: 'Pão Doce (pacote)', price: 3.5 },
  { id: 4, name: 'Broa de Milho (pacote)', price: 5.5 },
  { id: 5, name: 'Rosca de Canela (pacote)', price: 12.0 },
];

// Cache curtinho pra não bater no banco a cada mensagem do WhatsApp.
// É invalidado na hora quando o painel salva uma mudança (veja menuRoutes.js).
let cachedMenu = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

export function invalidateMenuCache() {
  cachedMenu = null;
  cachedAt = 0;
}

export async function ensureMenuSeeded() {
  const existingCount = await MenuItem.countDocuments();
  if (existingCount === 0) {
    await MenuItem.insertMany(DEFAULT_MENU.map((item) => ({ ...item, active: true })));
  }
}

export async function getMenu() {
  const now = Date.now();
  if (cachedMenu && now - cachedAt < CACHE_TTL_MS) {
    return cachedMenu;
  }

  await ensureMenuSeeded();
  const items = await MenuItem.find({ active: true }).sort({ id: 1 }).lean();

  cachedMenu = items;
  cachedAt = now;
  return items;
}

export function formatMoney(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function buildMenuTextFromList(menu) {
  const lines = menu.map(
    (item) => `${item.id}. ${item.name} - ${formatMoney(item.price)}`
  );
  return (
    '🥖 *Cardápio*\n\n' +
    lines.join('\n') +
    '\n\nDigite o *número* do item que deseja (ex: "1").\n' +
    'Para pedir mais de um item, digite os números separados por vírgula (ex: "1,3").\n\n' +
    '_A qualquer momento, digite *cancelar* para interromper o pedido._'
  );
}

export function findItemInMenu(menu, id) {
  return menu.find((item) => item.id === id);
}