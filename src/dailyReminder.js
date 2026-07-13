import cron from 'node-cron';

const MESSAGE =
  'Bom dia! ☀️ Vai fazer um pedido de pão hoje? Me manda um oi que eu já mostro o cardápio! 🥖';

export function startDailyReminder(sock) {
  const raw = process.env.CUSTOMER_NUMBERS || '';
  const numbers = raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

  if (numbers.length === 0) {
    console.log('⚠️ Nenhum número em CUSTOMER_NUMBERS — lembrete diário desativado.');
    return;
  }

  // Todo dia às 8h, horário de Cuiabá
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log(`📨 Enviando lembrete diário para ${numbers.length} cliente(s)...`);
      for (const number of numbers) {
        const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
        try {
          await sock.sendMessage(jid, { text: MESSAGE });
        } catch (err) {
          console.error(`Erro ao enviar lembrete para ${jid}:`, err);
        }
      }
    },
    { timezone: 'America/Cuiaba' }
  );

  console.log(`⏰ Lembrete diário agendado para 8h (${numbers.length} número(s)).`);
}