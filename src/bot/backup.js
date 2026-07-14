import cron from 'node-cron';
import { Order } from '../core/db.js';

export function startWeeklyBackup(sock) {
  const admin = process.env.ADMIN_NUMBER;
  if (!admin) {
    console.log('⚠️ ADMIN_NUMBER não definido — backup semanal desativado.');
    return;
  }

  const adminJid = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;

  cron.schedule(
    '0 6 * * 1',
    async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const orders = await Order.find({ createdAt: { $gte: since } }).sort({ createdAt: 1 });
        const buffer = Buffer.from(JSON.stringify(orders, null, 2), 'utf8');

        await sock.sendMessage(adminJid, {
          document: buffer,
          fileName: `pedidos-backup-${new Date().toISOString().slice(0, 10)}.json`,
          mimetype: 'application/json',
          caption: `📦 Backup automático: ${orders.length} pedido(s) dos últimos 7 dias.`,
        });

        console.log(`✅ Backup semanal enviado (${orders.length} pedidos).`);
      } catch (err) {
        console.error('Erro ao enviar backup semanal:', err);
      }
    },
    { timezone: 'America/Cuiaba' }
  );

  console.log('⏰ Backup semanal agendado (segundas às 6h).');
}
