# 🥖 Bot de Pedidos da Padaria (WhatsApp + MongoDB)

Bot de WhatsApp que recebe pedidos de pão e salva no MongoDB, feito para rodar no Render.

## Como funciona

1. Cliente manda qualquer mensagem → bot envia o cardápio numerado.
2. Cliente escolhe os itens digitando os números (ex: `1,3`).
3. Bot pergunta a quantidade de cada item.
4. Cliente pode adicionar mais itens ou digitar `fechar`.
5. Bot pede o endereço de entrega.
6. Cliente confirma (`1`) ou cancela (`2`).
7. Pedido confirmado é salvo no MongoDB e um aviso é enviado para o número do admin (seu pai), se configurado.

A qualquer momento, o cliente pode digitar `cancelar` para reiniciar a conversa.

## 1. Criar o banco MongoDB (grátis)

1. Crie uma conta em https://www.mongodb.com/cloud/atlas/register
2. Crie um **cluster gratuito (M0)**.
3. Em "Database Access", crie um usuário e senha.
4. Em "Network Access", libere o acesso de qualquer IP (`0.0.0.0/0`) — necessário porque o Render usa IPs dinâmicos.
5. Clique em "Connect" > "Drivers" e copie a *connection string*, algo como:
   ```
   mongodb+srv://usuario:senha@cluster0.xxxxx.mongodb.net/padaria-bot
   ```

## 2. Colocar o código no GitHub

1. Crie um repositório novo no GitHub.
2. Suba esta pasta inteira para o repositório (exceto `node_modules`, que já está no `.gitignore`).

## 3. Deploy no Render

1. Acesse https://render.com e crie uma conta.
2. Clique em **New > Web Service** e conecte seu repositório do GitHub.
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Em **Environment**, adicione as variáveis (veja `.env.example`):
   - `MONGODB_URI` → a connection string do passo 1
   - `ADMIN_NUMBER` → número do seu pai (com DDI+DDD, sem espaços/símbolos, ex: `5565999999999`)
5. Clique em **Create Web Service**.

⚠️ **Importante sobre o plano gratuito do Render:** ele "dorme" depois de ~15 minutos sem receber requisições HTTP, o que derruba a conexão do WhatsApp. Para o bot ficar online 24 horas por dia (recomendado para uso real), use o plano pago **Starter** (a partir de ~US$7/mês). No plano free, o bot vai reconectar sozinho quando alguém acessar o site, mas pode demorar/perder mensagens enquanto "dormia".

## 4. Conectar o WhatsApp (escanear o QR code)

1. Depois do deploy, abra a URL do seu serviço no Render seguida de `/qr` (ex: `https://padaria-bot.onrender.com/qr`).
2. Escaneie o QR code com o WhatsApp do número que vai atender os pedidos:
   **WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho**
3. Pronto! A sessão fica salva no MongoDB, então não vai pedir escanear de novo (mesmo que o Render reinicie o serviço).

## 5. Painel de pedidos do dia

Acesse `https://SEU-APP.onrender.com/pedidos` para ver os pedidos de hoje: total do dia, pendentes, e um botão para marcar cada pedido como **entregue** ou **cancelar**.

O painel é protegido por senha (HTTP Basic Auth). Configure a senha na variável `ADMIN_PASSWORD` no Render — quando o navegador pedir usuário/senha, pode colocar qualquer usuário e a senha que você definiu.

## 6. Editar o cardápio

Edite o arquivo `src/menu.js` — cada item tem `id`, `name` e `price`. Depois de editar, suba a alteração pro GitHub e o Render atualiza sozinho (deploy automático).

## 7. Ver os pedidos salvos (alternativa)

Os pedidos também ficam salvos na coleção `orders` do MongoDB, então dá pra visualizar direto pelo **MongoDB Atlas > Browse Collections** se preferir.

## Rodando localmente (para testar antes de subir pro Render)

```bash
npm install
cp .env.example .env
# edite o .env com sua MONGODB_URI
npm start
```

Depois acesse `http://localhost:3000/qr` no navegador para escanear o QR code.

## Avisos importantes

- Este bot usa uma biblioteca **não-oficial** (Baileys) que se conecta como se fosse o WhatsApp Web. Isso é gratuito e simples, mas não é suportado oficialmente pelo WhatsApp/Meta — em teoria existe risco (baixo, mas real) de o número ser bloqueado se enviar muitas mensagens automatizadas rapidamente. Para uso pessoal/pequeno negócio como este, é uma prática comum e geralmente segura, mas vale saber do risco.
- Recomendo usar um número de WhatsApp dedicado ao bot (não o número pessoal do seu pai), caso ele use o WhatsApp normal também para conversas pessoais.
