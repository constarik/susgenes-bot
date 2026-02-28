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

// === REFERRAL SYSTEM ===
// referee_id -> { referrerId, refereeClaimed }
const referrals = new Map();
// referrer_id -> [{ refereeId, claimed }]
const referrerBonuses = new Map();

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
    // Handle referral
    const refMatch = text.match(/\/start\s+ref_(\d+)/);
    if (refMatch) {
      const referrerId = parseInt(refMatch[1]);
      const refereeId = chatId;
      if (referrerId && referrerId !== refereeId && !referrals.has(refereeId)) {
        referrals.set(refereeId, { referrerId, refereeClaimed: false });
        if (!referrerBonuses.has(referrerId)) referrerBonuses.set(referrerId, []);
        referrerBonuses.get(referrerId).push({ refereeId, claimed: false });
        console.log(`Referral: ${referrerId} -> ${refereeId}`);
        // Notify referrer
        sendTg('sendMessage', {
          chat_id: referrerId,
          text: '🎉 A friend joined via your link\\!\nOpen the game to claim your \\+100⭐ bonus\\.',
          parse_mode: 'MarkdownV2',
          reply_markup: { inline_keyboard: [[ { text: '🎮 Claim Bonus', web_app: { url: GAME_URL } } ]] }
        });
      }
    }
    await sendTg('sendMessage', {
      chat_id: chatId,
      text: '🧬 *sus\\.genes* — Bayesian Betting Game\n\nObserve 8 entities on a grid\\. Each has hidden genes: Aggression, Herding, Greed\\.\nWatch their behavior, deduce the genotype, place your bets\\.\n\n🎯 Early bets pay ×5, late bets ×1\\.25\\.\nCan you read the genes?',
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

  if (text === '/stats') {
    try {
      const result = await sendTg('getStarTransactions', { offset: 0, limit: 100 });
      if (result.ok) {
        const txs = result.result.transactions || [];
        let totalIn = 0, totalOut = 0, count = 0;
        for (const tx of txs) {
          if (tx.amount > 0) { totalIn += tx.amount; count++; }
          else { totalOut += Math.abs(tx.amount); }
        }
        const net = totalIn - totalOut;
        await sendTg('sendMessage', {
          chat_id: chatId,
          text: `📊 *sus\\.genes — Bot Stats*\n\n` +
                `💰 Total earned: ${totalIn} Stars\n` +
                `↩️ Refunded: ${totalOut} Stars\n` +
                `📈 Net revenue: ${net} Stars\n` +
                `🧾 Transactions: ${txs.length} \\(${count} payments\\)`,
          parse_mode: 'MarkdownV2'
        });
      } else {
        await sendTg('sendMessage', { chat_id: chatId, text: '❌ Failed to get stats: ' + (result.description || 'unknown') });
      }
    } catch(e) {
      console.error('stats error:', e);
      await sendTg('sendMessage', { chat_id: chatId, text: '❌ Error fetching stats' });
    }
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

// --- Referral bonus check ---
app.get('/referral-bonus', (req, res) => {
  const userId = parseInt(req.query.userId);
  if (!userId) return res.json({ bonus: 0 });

  let bonus = 0, type = null, count = 0;

  // Check if user is a referee with unclaimed bonus
  const ref = referrals.get(userId);
  if (ref && !ref.refereeClaimed) {
    bonus += 100;
    type = 'referee';
  }

  // Check if user is a referrer with unclaimed bonuses
  const bList = referrerBonuses.get(userId);
  if (bList) {
    const unclaimed = bList.filter(b => !b.claimed);
    if (unclaimed.length > 0) {
      bonus += unclaimed.length * 100;
      count = unclaimed.length;
      type = type ? 'both' : 'referrer';
    }
  }

  res.json({ bonus, type, count });
});

// --- Claim referral bonus ---
app.post('/claim-referral', (req, res) => {
  const uid = parseInt(req.body.userId);
  if (!uid) return res.json({ claimed: 0 });

  let totalClaimed = 0;

  const ref = referrals.get(uid);
  if (ref && !ref.refereeClaimed) {
    ref.refereeClaimed = true;
    totalClaimed += 100;
  }

  const bList = referrerBonuses.get(uid);
  if (bList) {
    for (const b of bList) {
      if (!b.claimed) { b.claimed = true; totalClaimed += 100; }
    }
  }

  console.log(`Referral claim: user=${uid} amount=${totalClaimed}`);
  res.json({ claimed: totalClaimed });
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
