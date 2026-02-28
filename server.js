const express = require('express');
const app = express();
app.use(express.json());

const TOKEN = process.env.BOT_TOKEN;
const GAME_URL = 'https://constarik.github.io/susgenes/';
const BOT_URL = `https://api.telegram.org/bot${TOKEN}`;

async function sendTg(method, body) {
  const r = await fetch(`${BOT_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const msg = req.body.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const text = msg.text || '';

  if (text === '/start' || text.startsWith('/start ')) {
    await sendTg('sendMessage', {
      chat_id: chatId,
      text: '🧬 *sus\\.genes* — Bayesian Betting Game\n\nObserve 8 entities on a grid\\. Each has hidden genes: Aggression, Herding, Greed\\.\nWatch their behavior, deduce the genotype, place your bets\\.\n\n🎯 Early bets pay ×6, late bets ×1\\.25\\.\nCan you read the genes?',
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 Play Now', web_app: { url: GAME_URL } }
        ]]
      }
    });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'susgenes' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot server on port ${PORT}`));
