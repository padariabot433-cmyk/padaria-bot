import mongoose from 'mongoose';
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';

// Guardamos cada "chave" da sessão do WhatsApp como um documento no MongoDB.
// Isso substitui o "useMultiFileAuthState" (que salva em arquivos no disco),
// já que no Render o disco é apagado a cada novo deploy/restart.
const authSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    value: mongoose.Schema.Types.Mixed,
  },
  { collection: 'whatsapp_auth' }
);

const AuthDoc = mongoose.models.AuthDoc || mongoose.model('AuthDoc', authSchema);

async function writeData(id, data) {
  const value = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
  await AuthDoc.updateOne({ _id: id }, { $set: { value } }, { upsert: true });
}

async function readData(id) {
  const doc = await AuthDoc.findOne({ _id: id }).lean();
  if (!doc) return null;
  return JSON.parse(JSON.stringify(doc.value), BufferJSON.reviver);
}

async function removeData(id) {
  await AuthDoc.deleteOne({ _id: id });
}

export async function useMongoAuthState() {
  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData('creds', creds),
  };
}
