// Edite esta lista para mudar os produtos, preços e unidades do seu pai.
// "id" é o número que o cliente vai digitar no WhatsApp para escolher o item.
export const MENU = [
  { id: 1, name: 'Pão Francês (unidade)', price: 0.75 },
  { id: 2, name: 'Pão de Forma', price: 8.5 },
  { id: 3, name: 'Pão Doce (unidade)', price: 3.5 },
  { id: 4, name: 'Broa de Milho', price: 5.5 },
  { id: 5, name: 'Rosca de Canela', price: 12.0 },
];

export function formatMoney(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function buildMenuText() {
  const lines = MENU.map(
    (item) => `${item.id}. ${item.name} - ${formatMoney(item.price)}`
  );
  return (
    '🥖 *Cardápio de hoje*\n\n' +
    lines.join('\n') +
    '\n\nDigite o *número* do item que deseja (ex: "1").\n' +
    'Para pedir mais de um item, digite os números separados por vírgula (ex: "1,3").'
  );
}

export function findItem(id) {
  return MENU.find((item) => item.id === id);
}
