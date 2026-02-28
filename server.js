const express = require('express');
const app = express();

// CORS — before routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

const TOKEN = process.env.BOT_TOKEN;
const GAME_URL = 'https://constarik.github.io/susgenes/';
const BOT_URL = `https://api.telegram.org/bot${TOKEN}`;

const PACKAGES = {
  pack500:  { credits: 500,  stars: 50,  label: '500⭐' },
  pack1500: { credits: 1500, stars: 100, label: '1500⭐' },
  pack5000: { credits: 5000, stars: 250, label: '5000⭐' }
};

const receipts = new Map();

async function sendTg(method, body) {
  const r = await fetch(`${BOT_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

// --- Create invoice link for Mini App ---
app.post('/create-invoice', async (req, res) => {
  try {
    const { userId, packId } = req.body;
    const pack = PACKAGES[packId];
    if (!pack) return res.status(400).json({ error: 'Invalid pack' });

    const payload = JSON.stringify({ userId, packId, ts: Date.now() });
    const result = await sendTg('createInvoiceLink', {
      title: `${pack.label} Game Credits`,
      description: `Get ${pack.credits} credits for sus.genes`,
      payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: pack.label, amount: pack.stars }]
    });

    if (result.ok) {
      res.json({ invoiceLink: result.result });
    } else {
      console.error('createInvoiceLink error:', result);
      res.status(500).json({ error: result.description });
    }
  } catch (e) {
    console.error('create-invoice error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Webhook: bot commands + payments ---
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;

  // Pre-checkout: approve payment
  if (update.pre_checkout_query) {
    await sendTg('answerPreCheckoutQuery', {
      pre_checkout_query_id: update.pre_checkout_query.id,
      ok: true
    });
    return;
  }

  // Successful payment: confirm to user
  if (update.message?.successful_payment) {
    const payment = update.message.successful_payment;
    const userId = update.message.from.id;
    let packData;
    try { packData = JSON.parse(payment.invoice_payload); } catch(e) { packData = {}; }
    const pack = PACKAGES[packData.packId];
    const credits = pack ? pack.credits : 0;

    // Store receipt for potential refunds
    receipts.set(payment.telegram_payment_charge_id, {
      userId, packId: packData.packId, credits, ts: Date.now()
    });
    console.log(`Payment: user=${userId} pack=${packData.packId} credits=${credits} charge=${payment.telegram_payment_charge_id}`);

    await sendTg('sendMessage', {
      chat_id: userId,
      text: `✅ Payment successful\\!\n\n\\+${credits}⭐ credits added\\.\nOpen the game to see your updated balance\\.`,
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: '🎮 Play Now', web_app: { url: GAME_URL } }
        ]]
      }
    });
    return;
  }

  // Bot commands
  const msg = update.message;
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

  if (text === '/paysupport') {
    await sendTg('sendMessage', {
      chat_id: chatId,
      text: 'For payment support, contact @constrik'
    });
  }

  if (text === '/refund') {
    // Find last payment for this user
    let lastCharge = null;
    for (const [chargeId, r] of receipts) {
      if (r.userId === chatId) lastCharge = { chargeId, ...r };
    }
    if (lastCharge) {
      const result = await sendTg('refundStarPayment', {
        user_id: chatId,
        telegram_payment_charge_id: lastCharge.chargeId
      });
      if (result.ok) {
        receipts.delete(lastCharge.chargeId);
        await sendTg('sendMessage', {
          chat_id: chatId,
          text: `✅ Refunded ${lastCharge.credits}⭐ pack. Stars returned to your account.`
        });
      } else {
        await sendTg('sendMessage', {
          chat_id: chatId,
          text: `❌ Refund failed: ${result.description || 'unknown error'}`
        });
      }
    } else {
      await sendTg('sendMessage', {
        chat_id: chatId,
        text: 'No recent payment found to refund.'
      });
    }
  }
});

// --- Health check ---
app.get('/', (req, res) => {
  res.json({ status: 'ok', bot: 'susgenes', packages: Object.keys(PACKAGES) });
});

// --- Packages info for client ---
app.get('/packages', (req, res) => {
  const list = Object.entries(PACKAGES).map(([id, p]) => ({
    id, credits: p.credits, stars: p.stars, label: p.label
  }));
  res.json(list);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot server on port ${PORT}`));
