import express from 'express';
import { MenuItem } from './db.js';
import { invalidateMenuCache, ensureMenuSeeded } from './menu.js';

export const menuRouter = express.Router();

menuRouter.get('/', async (req, res) => {
  try {
    await ensureMenuSeeded();
    const items = await MenuItem.find().sort({ id: 1 });
    res.json(items);
  } catch (error) {
    console.error('Erro ao listar cardápio:', error);
    res.status(500).json({ error: error.message });
  }
});

menuRouter.post('/', async (req, res) => {
  try {
    const { name, price } = req.body;
    if (!name || price === undefined || price === null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: 'Informe nome e preço válidos.' });
    }

    const last = await MenuItem.findOne().sort({ id: -1 });
    const nextId = last ? last.id + 1 : 1;

    const item = await MenuItem.create({
      id: nextId,
      name: String(name).trim(),
      price: Number(price),
      active: true,
    });

    invalidateMenuCache();
    res.status(201).json(item);
  } catch (error) {
    console.error('Erro ao criar item do cardápio:', error);
    res.status(500).json({ error: error.message });
  }
});

menuRouter.patch('/:id', async (req, res) => {
  try {
    const { name, price, active } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (price !== undefined) {
      if (Number.isNaN(Number(price))) {
        return res.status(400).json({ error: 'Preço inválido.' });
      }
      updates.price = Number(price);
    }
    if (active !== undefined) updates.active = Boolean(active);

    const item = await MenuItem.findOneAndUpdate({ id: Number(req.params.id) }, updates, { new: true });
    if (!item) {
      return res.status(404).json({ error: 'Item não encontrado.' });
    }

    invalidateMenuCache();
    res.json(item);
  } catch (error) {
    console.error('Erro ao editar item do cardápio:', error);
    res.status(500).json({ error: error.message });
  }
});

menuRouter.delete('/:id', async (req, res) => {
  try {
    const item = await MenuItem.findOneAndDelete({ id: Number(req.params.id) });
    if (!item) {
      return res.status(404).json({ error: 'Item não encontrado.' });
    }

    invalidateMenuCache();
    res.json({ deleted: true });
  } catch (error) {
    console.error('Erro ao excluir item do cardápio:', error);
    res.status(500).json({ error: error.message });
  }
});