import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Defina a variável de ambiente MONGODB_URI');
  }
  await mongoose.connect(uri);
  console.log('✅ Conectado ao MongoDB');
  return mongoose.connection;
}

const orderItemSchema = new mongoose.Schema(
  {
    productId: Number,
    name: String,
    price: Number,
    quantity: { type: Number, default: 1 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema({
  customerJid: { type: String, required: true }, // identificador do WhatsApp do cliente
  customerName: String,
  items: [orderItemSchema],
  total: Number,
  status: {
    type: String,
    enum: ['pendente', 'devendo', 'ok', 'confirmado', 'entregue', 'cancelado'],
    default: 'pendente',
  },
  createdAt: { type: Date, default: Date.now },
});

export const Order = mongoose.model('Order', orderSchema);

const menuItemSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    active: { type: Boolean, default: true },
  },
  { collection: 'menu_items' }
);

export const MenuItem = mongoose.model('MenuItem', menuItemSchema);

const customerSchema = new mongoose.Schema({
  jid: { type: String, required: true, unique: true },
  name: String,
  updatedAt: { type: Date, default: Date.now },
});

export const Customer = mongoose.model('Customer', customerSchema);

const pendingItemSchema = new mongoose.Schema(
  { id: Number, name: String, price: Number },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    jid: { type: String, required: true, unique: true },
    step: { type: String, default: 'inicio' },
    cart: [orderItemSchema],
    customerName: String,
    pendingItems: [pendingItemSchema],
    pendingIndex: Number,
    lastOrderCart: [orderItemSchema],
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'whatsapp_sessions' }
);

export const Session = mongoose.model('Session', sessionSchema);
