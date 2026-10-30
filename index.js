require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws'); // PumpPortal WebSocket for real-time discovery

// ==================== KONFIGURASI ====================
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || ''; // Channel untuk Hermes monitor
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

// Multi Birdeye API keys for rotation (10 keys)
const BIRDEYE_KEYS = [
  process.env.BIRDEYE_API_KEY,
  process.env.BIRDEYE_API_KEY_2,
  process.env.BIRDEYE_API_KEY_3,
  process.env.BIRDEYE_API_KEY_4,
  process.env.BIRDEYE_API_KEY_5,
  process.env.BIRDEYE_API_KEY_6,
  process.env.BIRDEYE_API_KEY_7,
  process.env.BIRDEYE_API_KEY_8,
  process.env.BIRDEYE_API_KEY_9,
  process.env.BIRDEYE_API_KEY_10,
].filter(Boolean);

let birdeyeKeyIndex = 0;

const PRICE_HIGH = parseFloat(process.env.PRICE_HIGH || '0.0001');
const PRICE_LOW = parseFloat(process.env.PRICE_LOW || '0.00005');

// Major coins filter - exclude tokens with price > $1 (not memecoins)
const MAX_MEMECOIN_PRICE = 1.0; // Memecoins rarely exceed $1
const MAX_MEMECOIN_MARKET_CAP = 100000000; // $100M max (exclude major coins like BTC/ETH/SOL)

// Known major coin addresses (always exclude)
const MAJOR_COIN_BLACKLIST = [
  'So11111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // ETH (Wormhole)
  'A7bdiYdS5GgdwjLhcNp8AZnh3WAr8UYRpkFgXAx6mLxS', // ETH (Portal)
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', // BTC (Portal)
  'cbbtcf3aa2a8a7c4c91987fa4cfc438fc5c87e8f13893cddf5a670d4e8ca9e65', // cbBTC
];

// Kriteria KEDUA (opsional): untuk pump yang lebih moderat, minta bukti dump yang JAUH
// lebih dalam sebelum dianggap sinyal valid. Kalau harga ternyata terus naik sampai
// menyentuh PRICE_HIGH (kriteria 1), otomatis "naik kelas" dan ikut aturan kriteria 1
// (dump ke PRICE_LOW yang lebih dangkal), karena kriteria 1 dianggap lebih kuat/prioritas.
// Kosongkan PRICE_HIGH_2 untuk menonaktifkan (cuma pakai 1 kriteria seperti sebelumnya).
const PRICE_HIGH_2 = process.env.PRICE_HIGH_2 ? parseFloat(process.env.PRICE_HIGH_2) : null;
const PRICE_LOW_2 = process.env.PRICE_LOW_2 ? parseFloat(process.env.PRICE_LOW_2) : null;

const LIQUIDITY_MIN_USD = parseFloat(process.env.LIQUIDITY_MIN_USD || '10000');
const MIN_LIQUIDITY_FOR_SIGNAL_USD = parseFloat(process.env.MIN_LIQUIDITY_FOR_SIGNAL_USD || '2000');
const MIN_MARKET_CAP_USD = parseFloat(process.env.MIN_MARKET_CAP_USD || '10000');
const MIN_VOLUME_1H_USD = parseFloat(process.env.MIN_VOLUME_1H_USD || '1000');
const RUGCHECK_MAX_RISK_SCORE = parseFloat(process.env.RUGCHECK_MAX_RISK_SCORE || '50');

const MIN_HOLDER_COUNT = parseInt(process.env.MIN_HOLDER_COUNT || '600', 10);
const ENABLE_HOLDER_CHECK = (process.env.ENABLE_HOLDER_CHECK ?? 'false') === 'true';

const MIN_AVG_TRADE_SIZE_USD = parseFloat(process.env.MIN_AVG_TRADE_SIZE_USD || '15');

// Bundle buys % dari Solana Tracker (API terpisah, perlu daftar akun sendiri, gratis
// 2.500 request/bulan). Kalau SOLANATRACKER_API_KEY kosong, cek ini otomatis dilewati
// (tidak mengganggu apa pun) — cuma jadi KETERANGAN tambahan, tidak memblokir sinyal.
const SOLANATRACKER_API_KEY = process.env.SOLANATRACKER_API_KEY || '';
const BUNDLE_WARNING_PCT = parseFloat(process.env.BUNDLE_WARNING_PCT || '65');

const EXCLUDE_DEX_IDS = (process.env.EXCLUDE_DEX_IDS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const DEFAULT_SCAM_KEYWORDS = [
  'openai', 'chatgpt', 'gpt-5', 'gpt5', 'robinhood', 'tesla', 'elonmusk', 'elon musk', 'spacex',
  'apple inc', 'nvidia', 'microsoft', 'google', 'amazon', 'meta platforms', 'facebook',
  'trump', 'binance', 'coinbase', 'blackrock', 'jpmorgan', 'visa', 'mastercard',
  'paypal', 'netflix', 'disney', 'nike', 'samsung', 'twitter', 'anthropic', 'claude ai', 'claude',
];
const EXTRA_SCAM_KEYWORDS = (process.env.EXTRA_SCAM_KEYWORDS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const SCAM_KEYWORDS = [...DEFAULT_SCAM_KEYWORDS, ...EXTRA_SCAM_KEYWORDS];

const MIN_TOKEN_AGE_MINUTES = parseFloat(process.env.MIN_TOKEN_AGE_MINUTES || '20');
const MAX_TOKEN_AGE_MINUTES = parseFloat(process.env.MAX_TOKEN_AGE_MINUTES || '60');

// Dua interval discovery TERPISAH: Birdeye (mahal secara CU, jarang) vs GeckoTerminal
// (gratis tanpa batas CU, bisa lebih sering) — supaya koin yang baru mulai ramai
// terdeteksi lebih cepat tanpa membebani jatah gratis Birdeye.
// GECKO: Default 30 detik (0.5 menit), minimum 15 detik untuk safety rate limit
const BIRDEYE_DISCOVER_INTERVAL_MS = parseInt(process.env.DISCOVER_INTERVAL_MINUTES || '45', 10) * 60 * 1000;
const GECKO_DISCOVER_INTERVAL_SECONDS = parseFloat(process.env.GECKO_DISCOVER_INTERVAL_SECONDS || '30');
const GECKO_DISCOVER_INTERVAL_MS = Math.max(GECKO_DISCOVER_INTERVAL_SECONDS * 1000, 15000); // Minimum 15s

const CHECK_INTERVAL_MS = process.env.CHECK_INTERVAL_SECONDS
  ? parseFloat(process.env.CHECK_INTERVAL_SECONDS) * 1000
  : parseFloat(process.env.CHECK_INTERVAL_MINUTES || '1') * 60 * 1000;

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5', 10);

// Jalur cepat KHUSUS untuk koin yang sudah "armed" (pernah tembus PRICE_HIGH/PRICE_HIGH_2,
// tinggal tunggu dump). Dicek jauh lebih sering daripada siklus umum, karena koin volatil
// bisa jatuh puluhan persen dalam hitungan detik — polling umum (20 detik) terlalu lambat
// untuk menangkap momen persis itu. Jumlah koin "armed" biasanya sedikit, jadi aman dicek
// sesering ini tanpa membebani API.
const FAST_CHECK_INTERVAL_MS = parseInt(process.env.FAST_CHECK_INTERVAL_SECONDS || '5', 10) * 1000;

// Jalur SUPER CEPAT khusus koin armed yang bundle buys-nya sudah terbukti tinggi —
// hipotesis: bundle tinggi = wallet terkoordinasi, lebih rawan dump instan/serentak,
// jadi diberi prioritas pengecekan tercepat. Bundle % sekarang dicek SEJAK koin armed
// (bukan nunggu sampai mau dump), supaya prioritas ini bisa langsung berlaku.
const HIGH_RISK_FAST_CHECK_INTERVAL_MS = parseInt(process.env.HIGH_RISK_FAST_CHECK_INTERVAL_SECONDS || '2', 10) * 1000;

const MOMENTUM_WINDOW = parseInt(process.env.MOMENTUM_WINDOW || '5', 10);
const MOMENTUM_FLAT_THRESHOLD_PCT = parseFloat(process.env.MOMENTUM_FLAT_THRESHOLD_PCT || '3');

const TOP_N = parseInt(process.env.TOP_N || '50', 10);
const GECKO_PAGES = parseInt(process.env.GECKO_PAGES || '1', 10);

const STATE_DIR = process.env.STATE_DIR || __dirname;
const STATE_FILE = path.join(STATE_DIR, 'state.json');

console.log('gmgn-alert-bot — versi 2026-10-29-v41 (Jupiter Price API + Smart Cleanup)');
console.log(`Discovery Birdeye: tiap ${(BIRDEYE_DISCOVER_INTERVAL_MS / 60000).toFixed(0)} menit. Discovery GeckoTerminal: tiap ${(GECKO_DISCOVER_INTERVAL_MS / 1000).toFixed(0)} detik. Cek harga: tiap ${(CHECK_INTERVAL_MS / 1000).toFixed(0)} detik.`);

if (!BOT_TOKEN || !CHAT_ID || !BIRDEYE_API_KEY) {
  console.error('❌ TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, dan BIRDEYE_API_KEY wajib diisi di environment variables (lihat .env.example).');
  process.exit(1);
}

// ==================== STATE ====================
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      watchlist: raw.watchlist || [],
      prices: raw.prices || {},
      birdeyeAddresses: raw.birdeyeAddresses || [],
      geckoAddresses: raw.geckoAddresses || [],
      signalsSent: raw.signalsSent || 0,
      signalsSentToday: raw.signalsSentToday || 0,
      lastResetDate: raw.lastResetDate || new Date().toISOString().split('T')[0],
    };
  } catch {
    return { 
      watchlist: [], 
      prices: {}, 
      birdeyeAddresses: [], 
      geckoAddresses: [], 
      signalsSent: 0,
      signalsSentToday: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
    };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== ANTREAN KHUSUS BIRDEYE & RUGCHECK ====================
function makeThrottledQueue(minSpacingMs) {
  let queue = Promise.resolve();
  return function throttled(fn) {
    const run = queue.then(async () => {
      const result = await fn();
      await sleep(minSpacingMs);
      return result;
    });
    queue = run.catch(() => {});
    return run;
  };
}
const throttledBirdeye = makeThrottledQueue(1100);
const throttledRugCheck = makeThrottledQueue(300);

// ==================== HELIUS HEALTH CHECK (MONITOR KEY EXPIRATION) ====================
async function checkHeliusHealth() {
  const keys = [
    { name: 'Key #1', key: process.env.HELIUS_API_KEY },
    { name: 'Key #2', key: process.env.HELIUS_API_KEY_2 },
    { name: 'Key #3', key: process.env.HELIUS_API_KEY_3 }
  ].filter(k => k.key); // Hanya cek key yang ada
  
  if (keys.length === 0) {
    console.log('⚠️ Tidak ada Helius API key untuk dicek');
    return;
  }
  
  let expiredCount = 0;
  let expiredKeys = [];
  
  for (const {name, key} of keys) {
    try {
      const response = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getHealth'
          })
        }
      );
      
      if (response.status === 401) {
        expiredCount++;
        expiredKeys.push(name);
        console.log(`❌ ${name} EXPIRED (401 Unauthorized)`);
      } else if (response.ok) {
        console.log(`✅ ${name} masih aktif`);
      } else {
        console.log(`⚠️ ${name} status tidak jelas: ${response.status}`);
      }
      
    } catch (error) {
      console.log(`⚠️ Error cek ${name}: ${error.message}`);
    }
  }
  
  // Kirim notifikasi Telegram jika ada key expired
  if (expiredCount > 0) {
    const workingKeys = keys.length - expiredCount;
    const emoji = workingKeys === 0 ? '🚨' : '⚠️';
    
    const message = 
      `${emoji} HELIUS API KEY EXPIRED\n\n` +
      `Key yang expired: ${expiredKeys.join(', ')}\n` +
      `Key yang masih kerja: ${workingKeys}/${keys.length}\n\n` +
      (workingKeys > 0 
        ? `✅ Bot masih jalan pakai key lainnya\n\n` 
        : `🚨 URGENT: Semua key mati! Bot tidak bisa detect!\n\n`) +
      `Tindakan:\n` +
      `1. Buka dashboard.helius.dev\n` +
      `2. Generate key baru\n` +
      `3. Update Railway env var: ${expiredKeys.join(', ').replace('#', '')}\n` +
      `4. Railway akan auto-restart`;
    
    await sendTelegramMessage(message);
  }
}

// Jalankan health check tiap 5 menit
setInterval(checkHeliusHealth, 5 * 60 * 1000);
console.log('🏥 Helius health check: aktif (tiap 5 menit)\n');

// ==================== MOMENTUM ====================
function computeMomentum(recentPrices) {
  if (!recentPrices || recentPrices.length < 2) {
    return { label: 'data belum cukup', pct: null, seconds: null };
  }
  const oldest = recentPrices[0];
  const newest = recentPrices[recentPrices.length - 1];
  const pct = ((newest.price - oldest.price) / oldest.price) * 100;
  const seconds = Math.max(1, Math.round((newest.t - oldest.t) / 1000));

  let label;
  if (pct <= -MOMENTUM_FLAT_THRESHOLD_PCT) label = '📉 Masih turun';
  else if (pct >= MOMENTUM_FLAT_THRESHOLD_PCT) label = '📈 Mulai naik';
  else label = '➡️ Mulai stabil';

  return { label, pct, seconds };
}

// ==================== TELEGRAM ====================
async function sendTelegramAlert({ symbol, name, address, price, volume1h, marketCap, liquidityUsd, pairUrl, dexId, momentum, tierLabel, clusterWarning, bundleWarning, bundlePercentage, bundleDataMissing, lpBurnedByGraduation, heliusBundleCheck, heliusBundleData }) {
  // Increment signal counter (persist to state.json)
  // Check if date changed (midnight passed) - reset daily counter
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  if (state.lastResetDate !== today) {
    console.log(`📅 Date changed: ${state.lastResetDate} → ${today}. Resetting daily counter.`);
    state.signalsSentToday = 0;
    state.lastResetDate = today;
  }
  
  // Increment both counters
  state.signalsSent = (state.signalsSent || 0) + 1;
  state.signalsSentToday = (state.signalsSentToday || 0) + 1;
  saveState(state);
  const mcText = marketCap != null ? `$${Number(marketCap).toLocaleString('en-US')}` : 'Data tidak tersedia';
  const risky = liquidityUsd == null || liquidityUsd < LIQUIDITY_MIN_USD;
  const riskLine = risky ? `\n⚠️ RISIKO LIKUIDITAS TINGGI` : '';
  const clusterLine = clusterWarning ? `\n⚠️ Hati-hati: terdeteksi cluster wallet (mirip pola diagram gelembung mencurigakan)` : '';
  
  // Helius Bundle Detection (NEW - blockchain-level)
  let heliusBundleLine = '';
  if (heliusBundleCheck === 'detected' && heliusBundleData) {
    heliusBundleLine = `\n⚠️ BUNDLE DETECTED (Helius): ${heliusBundleData.bundlePercentage}% (${heliusBundleData.bundledSlots} bundled slots, concentration: ${heliusBundleData.slotConcentration})`;
  } else if (heliusBundleCheck === 'clean' && heliusBundleData) {
    heliusBundleLine = `\n✅ Bundle Check (Helius): Clean (${heliusBundleData.uniqueSlots} unique slots)`;
  } else if (heliusBundleCheck === 'pending') {
    heliusBundleLine = `\n🔍 Bundle Check (Helius): Analyzing... (results in 30s)`;
  }
  
  // Solana Tracker fallback (deprecated, only if Helius unavailable)
  const bundleLine = bundleWarning && !heliusBundleCheck ? `\n⚠️ Bundle buys tinggi (Solana Tracker): ${bundlePercentage.toFixed(1)}%` : '';
  const bundleMissingLine = bundleDataMissing && !heliusBundleCheck ? `\n⚠️ Data Bundle tidak tersedia (API gagal)` : '';

  // Warning khusus untuk PumpSwap dan LP tidak aman
  const dexLower = (dexId || '').toLowerCase();
  const isPumpSwap = dexLower.includes('pumpswap') || dexLower.includes('pump_swap');
  const pumpSwapLine = isPumpSwap ? `\n⚠️ Token PumpSwap: baru graduate dari bonding curve, perlu extra validasi` : '';
  
  // LP Lock status
  let lpLine = '';
  if (lpBurnedByGraduation) {
    // Graduated token: LP auto-burned by Pump.fun
    lpLine = `\n✅ LP BURNED: Token graduated from Pump.fun (LP 100% burned to incinerator)`;
  }

  const momentumLine = momentum && momentum.pct != null
    ? `\nMomentum: ${momentum.label} (${momentum.pct.toFixed(1)}% dalam ${momentum.seconds}d terakhir)`
    : `\nMomentum: data belum cukup`;

  const tierLine = tierLabel ? ` (kriteria ${tierLabel})` : '';
  const text =
    `🚨 <b>Sinyal Ditemukan</b>${tierLine}\n\n` +
    `Koin: <b>${escapeHtml(symbol)}</b> (${escapeHtml(name)})\n` +
    `CA: <code>${address}</code>\n` +
    `Harga sekarang: $${price}\n` +
    `Volume 1 Jam: $${Number(volume1h).toLocaleString('en-US')}\n` +
    `Market Cap: ${mcText}` +
    riskLine +
    clusterLine +
    heliusBundleLine +
    bundleLine +
    bundleMissingLine +
    pumpSwapLine +
    lpLine +
    momentumLine + `\n` +
    (pairUrl ? `Chart: ${pairUrl}` : '');

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  // Kirim ke chat pribadi
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) {
    console.error('Gagal kirim notifikasi Telegram (chat pribadi):', await res.text());
  }
  
  // Kirim ke channel juga (kalau CHANNEL_ID ada)
  if (CHANNEL_ID) {
    const resChannel = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHANNEL_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!resChannel.ok) {
      console.error('Gagal kirim notifikasi Telegram (channel):', await resChannel.text());
    }
  }
  
  // Kirim ke Hermes middleware untuk monitoring
  try {
    const hermesData = {
      symbol,
      name,
      ca: address,
      price,
      volume1h,
      marketCap,
      liquidityUsd,
      pairUrl,
      dexId,
      criteria: tierLabel,
      clusterWarning,
      bundleWarning,
      bundlePercentage,
      bundleDataMissing,
      lpWarning,
      lpWarningReason,
      momentum,
      timestamp: new Date().toISOString()
    };
    
    // Add signal directly to integrated queue
    addSignalToQueue(hermesData);
    console.log('✅ Signal added to integrated queue for Hermes poller');
  } catch (err) {
    console.error('Error adding signal to queue:', err.message);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function isBrandImpersonation(symbol, name) {
  const text = `${symbol || ''} ${name || ''}`.toLowerCase();
  return SCAM_KEYWORDS.some((kw) => text.includes(kw));
}

// ==================== RUGCHECK ====================
async function checkRugCheckSafety(address) {
  return throttledRugCheck(async () => {
    try {
      const url = `https://api.rugcheck.xyz/v1/tokens/${address}/report`;
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) return { safe: true, reason: 'RugCheck tidak tersedia untuk token ini (dilewati)', clusterWarning: false };
      const json = await res.json();

      // Deteksi cluster/insider wallet (fungsi mirip diagram gelembung GMGN) — MASIH
      // TAHAP PENGUMPULAN DATA. Sengaja HANYA jadi keterangan di notifikasi, TIDAK
      // memblokir sinyal, sampai ada bukti data yang cukup untuk dijadikan filter keras.
      let clusterWarning = false;
      const risks = json?.risks || [];
      const clusterKeywords = ['insider', 'cluster', 'bundle', 'bundled', 'sniper'];
      if (json?.graphInsidersDetected) clusterWarning = true;
      const clusterRisk = risks.find((r) => {
        const t = `${r?.name || ''} ${r?.description || ''}`.toLowerCase();
        return clusterKeywords.some((kw) => t.includes(kw));
      });
      if (clusterRisk) clusterWarning = true;

      if (json?.rugged === true) {
        return { safe: false, reason: 'RugCheck: token sudah terdeteksi rugged', clusterWarning };
      }
      const riskScore = json?.score_normalised ?? null;
      if (riskScore != null && riskScore >= RUGCHECK_MAX_RISK_SCORE) {
        return { safe: false, reason: `RugCheck: skor risiko ${riskScore}/100 (ambang ${RUGCHECK_MAX_RISK_SCORE})`, clusterWarning };
      }
      const dangerousAuthority = risks.some((r) => {
        const t = `${r?.name || ''} ${r?.description || ''}`.toLowerCase();
        return (t.includes('mint authority') || t.includes('freeze authority')) && r?.level === 'danger';
      });
      if (dangerousAuthority) {
        return { safe: false, reason: 'RugCheck: mint/freeze authority masih aktif', clusterWarning };
      }

      // ==================== LIQUIDITY LOCK/BURN CHECK ====================
      // Cek apakah LP token di-lock atau di-burn (indikator keamanan likuiditas).
      // LP aman jika: top holder LP < 10% (tersebar/burned) ATAU mintAuthority LP = null.
      const markets = json?.markets || [];
      let lpWarning = false;
      let lpWarningReason = null;

      if (markets.length > 0) {
        const mainMarket = markets[0]; // pair dengan likuiditas terbesar
        const lpHolders = mainMarket?.lp?.holders || [];
        const mintLPAccount = mainMarket?.mintLPAccount;

        // Cek 1: Apakah LP mintAuthority masih aktif (bisa mint LP sewaktu-waktu = bahaya)
        const lpMintAuthorityActive = mintLPAccount?.mintAuthority != null;

        // Cek 2: Apakah LP terkonsentrasi di satu wallet (>10% = creator bisa rug)
        const topLPHolderPct = lpHolders.length > 0 ? (lpHolders[0]?.pct || 0) : 0;
        const lpConcentrated = topLPHolderPct > 10;

        // Opsi C: jika LP data tidak lengkap atau berisiko, beri WARNING (tidak blokir sinyal)
        if (lpHolders.length === 0) {
          lpWarning = true;
          lpWarningReason = 'Data LP tidak tersedia dari RugCheck';
        } else if (lpMintAuthorityActive && lpConcentrated) {
          lpWarning = true;
          lpWarningReason = `LP mint authority aktif + ${topLPHolderPct.toFixed(1)}% LP dipegang 1 wallet`;
        } else if (lpConcentrated) {
          lpWarning = true;
          lpWarningReason = `${topLPHolderPct.toFixed(1)}% LP dipegang 1 wallet (belum di-lock/burn)`;
        }
      } else {
        lpWarning = true;
        lpWarningReason = 'Tidak ada data market dari RugCheck';
      }

      return { safe: true, reason: null, clusterWarning, lpWarning, lpWarningReason };
    } catch (err) {
      return { safe: true, reason: `RugCheck error (dilewati): ${err.message}`, clusterWarning: false };
    }
  });
}

// ==================== BIRDEYE: TOKEN SECURITY (LP LOCK CHECK) ====================
// REMOVED: getBirdeyeTokenSecurity() - Always failed (0% success rate)
// Replaced by: lpBurnedByGraduation detection (PumpPortal graduation event)

// ==================== BIRDEYE: jumlah holder (opsional) ====================
async function getHolderCount(address) {
  return throttledBirdeye(async () => {
    try {
      const url = `https://public-api.birdeye.so/defi/token_overview?address=${address}`;
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'x-chain': 'solana', 'X-API-KEY': BIRDEYE_API_KEY },
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.data?.holder ?? null;
    } catch {
      return null;
    }
  });
}

// ==================== SOLANA TRACKER: persentase bundle buys ====================
// REMOVED: getBundlePercentage() - Always failed (0/3 success rate from 4 signals)
// Replaced by: Helius Bundle Check (blockchain-level, more accurate)

// ==================== SUMBER DISCOVERY 1: BIRDEYE ====================
async function getBirdeyeCandidates() {
  return throttledBirdeye(async () => {
    // Try each key until one works (rotate on error)
    let lastError = null;
    
    for (let attempt = 0; attempt < BIRDEYE_KEYS.length; attempt++) {
      const apiKey = BIRDEYE_KEYS[birdeyeKeyIndex];
      
      try {
        // Birdeye doesn't support max_market_cap filter, so we fetch and filter client-side
        const url = `https://public-api.birdeye.so/defi/tokenlist?sort_by=v24hUSD&sort_type=desc&offset=0&limit=${TOP_N}`;
        const res = await fetch(url, {
          headers: { accept: 'application/json', 'x-chain': 'solana', 'X-API-KEY': apiKey },
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          lastError = new Error(`Birdeye key #${birdeyeKeyIndex + 1} error ${res.status}: ${errorText}`);
          
          // Rotate to next key on error
          birdeyeKeyIndex = (birdeyeKeyIndex + 1) % BIRDEYE_KEYS.length;
          console.log(`⚠️  ${lastError.message}`);
          console.log(`🔄 Switching to Birdeye key #${birdeyeKeyIndex + 1}...`);
          continue;
        }
        
        const json = await res.json();
        const tokens = (json?.data?.tokens || []);
        
        // Filter out major coins (market cap > $100M or blacklisted)
        const addresses = tokens
          .filter(t => {
            // Filter by market cap (exclude major coins)
            if (t.mc && t.mc > MAX_MEMECOIN_MARKET_CAP) return false;
            
            // Filter blacklist
            if (MAJOR_COIN_BLACKLIST.includes(t.address)) return false;
            
            return true;
          })
          .map(t => t.address)
          .filter(Boolean);
        
        console.log(`✅ Birdeye key #${birdeyeKeyIndex + 1}: ${tokens.length} tokens fetched, ${addresses.length} after filtering (excluded ${tokens.length - addresses.length} major coins)`);
        
        // Rotate to next key for next call (spread load)
        birdeyeKeyIndex = (birdeyeKeyIndex + 1) % BIRDEYE_KEYS.length;
        
        return addresses;
        
      } catch (err) {
        lastError = err;
        birdeyeKeyIndex = (birdeyeKeyIndex + 1) % BIRDEYE_KEYS.length;
        console.log(`⚠️  Birdeye key #${birdeyeKeyIndex} fetch error: ${err.message}`);
        console.log(`🔄 Switching to Birdeye key #${birdeyeKeyIndex + 1}...`);
      }
    }
    
    // All keys failed
    throw new Error(`All ${BIRDEYE_KEYS.length} Birdeye keys failed. Last error: ${lastError?.message}`);
  });
}

// ==================== SUMBER DISCOVERY 3: DEXSCREENER TOKEN PROFILES (TERCEPAT!) ====================
// ==================== SUMBER DISCOVERY: DEXSCREENER ====================
// REMOVED: getDexScreenerLatestPairs() - Redundant + rate limit 429
// Already have: Multi-Helius (0-5s), PumpPortal (0-10s), Gecko (15min)
// DexScreener 10min interval was too slow and caused rate limit errors

// ==================== SUMBER DISCOVERY 2: GECKOTERMINAL ====================
async function fetchGeckoPage(page) {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?duration=1h&page=${page}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 429) return { retry: true };
  if (!res.ok) return { retry: false, addrs: null, status: res.status };
  const json = await res.json();
  const addrs = (json?.data || []).map((p) => p.attributes?.address).filter(Boolean);
  return { retry: false, addrs };
}

async function getGeckoTerminalTrendingPools() {
  const allAddresses = [];
  for (let page = 1; page <= GECKO_PAGES; page++) {
    let result = await fetchGeckoPage(page);
    if (result.retry) {
      // Kena rate limit (kemungkinan IP Railway dipakai bersama pengguna lain) —
      // tunggu lebih lama lalu coba sekali lagi sebelum menyerah untuk siklus ini.
      console.error(`GeckoTerminal halaman ${page} kena rate limit (429), tunggu 8 detik lalu coba ulang sekali...`);
      await sleep(8000);
      result = await fetchGeckoPage(page);
    }
    if (result.retry || result.addrs == null) {
      console.error(`GeckoTerminal halaman ${page} gagal (${result.status || 429}), lanjut dengan yang sudah ada.`);
      break;
    }
    if (result.addrs.length === 0) break;
    allAddresses.push(...result.addrs);
    await sleep(2500);
  }
  return allAddresses;
}
async function resolvePoolToTokenAddress(pairAddress) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const p = json?.pair || (json?.pairs && json.pairs[0]);
    return p?.baseToken?.address || null;
  } catch {
    return null;
  }
}

// ==================== GABUNGKAN WATCHLIST DARI TIGA SUMBER ====================
function rebuildWatchlist() {
  const addresses = Array.from(new Set([
    ...state.birdeyeAddresses, 
    ...state.geckoAddresses
  ]));
  const newPrices = {};
  for (const addr of addresses) {
    newPrices[addr] = state.prices[addr] || { maxPrice: 0 };
  }
  state.watchlist = addresses;
  state.prices = newPrices;
  saveState(state);
  console.log(`Watchlist gabungan diperbarui: ${addresses.length} koin unik (Birdeye: ${state.birdeyeAddresses.length}, Gecko: ${state.geckoAddresses.length}).`);
}

async function refreshBirdeyeWatchlist() {
  console.log(`\n[${new Date().toISOString()}] Refresh watchlist dari Birdeye (volume 24 jam)...`);
  try {
    state.birdeyeAddresses = await getBirdeyeCandidates();
    console.log(`Birdeye: ${state.birdeyeAddresses.length} koin.`);
  } catch (err) {
    console.error('Gagal ambil daftar dari Birdeye:', err.message);
  }
  rebuildWatchlist();
}

async function refreshGeckoWatchlist() {
  console.log(`\n[${new Date().toISOString()}] Refresh watchlist dari GeckoTerminal (volume 1 jam)...`);
  try {
    const poolAddrs = await getGeckoTerminalTrendingPools();
    const geckoAddresses = [];
    for (const poolAddr of poolAddrs) {
      const tokenAddr = await resolvePoolToTokenAddress(poolAddr);
      if (tokenAddr) geckoAddresses.push(tokenAddr);
      await sleep(150);
    }
    state.geckoAddresses = geckoAddresses;
    console.log(`GeckoTerminal: ${geckoAddresses.length} koin.`);
  } catch (err) {
    console.error('Gagal ambil trending dari GeckoTerminal (dilewati):', err.message);
  }
  rebuildWatchlist();
}

// REMOVED: refreshDexScreenerWatchlist() - Redundant discovery layer
// Using: Multi-Helius + PumpPortal + Gecko only

// ==================== JUPITER PRICE API (Batch price fetching) ====================
async function getJupiterPrices(addresses) {
  if (!addresses || addresses.length === 0) return {};
  
  // Jupiter v3 supports up to 100 addresses per request
  const MAX_BATCH = 100;
  const batches = [];
  for (let i = 0; i < addresses.length; i += MAX_BATCH) {
    batches.push(addresses.slice(i, i + MAX_BATCH));
  }
  
  const allResults = {};
  
  for (const batch of batches) {
    try {
      const url = `https://api.jup.ag/price/v3?ids=${batch.join(',').trim()}`;
      const res = await fetch(url);
      
      if (!res.ok) {
        console.error(`Jupiter API error: ${res.status}`);
        continue;
      }
      
      const data = await res.json();
      Object.assign(allResults, data);
    } catch (err) {
      console.error('Jupiter API fetch error:', err.message);
    }
  }
  
  return allResults;
}

// Fetch token data from Birdeye (for signal checks when DexScreener unavailable)
async function getBirdeyeTokenData(address) {
  try {
    const url = `https://public-api.birdeye.so/defi/token_overview?address=${address}`;
    const res = await fetch(url, {
      headers: { 
        accept: 'application/json', 
        'x-chain': 'solana', 
        'X-API-KEY': BIRDEYE_API_KEY 
      },
    });
    
    if (!res.ok) return null;
    const json = await res.json();
    const data = json.data;
    if (!data) return null;
    
    return {
      address,
      symbol: data.symbol || '?',
      name: data.name || '?',
      price: data.price || 0,
      liquidity: data.liquidity || 0,
      marketCap: data.mc || 0,
      volume24h: data.v24hUSD || 0,
      volume1h: data.v1hUSD || 0,
      priceChange24h: data.priceChange24hPercent || 0,
    };
  } catch (err) {
    console.error(`Birdeye fetch error for ${address.substring(0,8)}:`, err.message);
    return null;
  }
}

// ==================== TAHAP 1: snapshot harga (gate STABIL saja) ====================
async function getTokenSnapshot(address, skipAgeCheck = false) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  const pairs = (json?.pairs || []).filter((p) => p.chainId === 'solana');
  if (pairs.length === 0) return null;

  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  const p = pairs[0];

  const dexId = (p.dexId || '').toLowerCase();
  if (EXCLUDE_DEX_IDS.length > 0 && EXCLUDE_DEX_IDS.some((ex) => dexId.includes(ex))) return null;

  if (!p.pairCreatedAt) return null;
  const ageMinutes = (Date.now() - p.pairCreatedAt) / 60000;
  // Skip age check for tokens already in watchlist (called from signal detection)
  if (!skipAgeCheck && (ageMinutes < MIN_TOKEN_AGE_MINUTES || ageMinutes > MAX_TOKEN_AGE_MINUTES)) return null;

  const priceNum = parseFloat(p.priceUsd);
  if (!p.priceUsd || Number.isNaN(priceNum)) return null;

  const symbol = p.baseToken?.symbol || '?';
  const name = p.baseToken?.name || '?';
  if (isBrandImpersonation(symbol, name)) return null;

  return { address, symbol, name, price: priceNum, pair: p };
}

// ==================== TAHAP 2: filter kualitas (gate FLUKTUATIF — dicek cuma saat sinyal) ====================
async function checkQualityGates(snapshot) {
  const { address, symbol, name, pair: p } = snapshot;

  const liquidityUsd = p.liquidity?.usd ?? null;
  if (liquidityUsd == null || liquidityUsd < MIN_LIQUIDITY_FOR_SIGNAL_USD) {
    return { pass: false, reason: `likuiditas $${liquidityUsd ?? 0} (min $${MIN_LIQUIDITY_FOR_SIGNAL_USD})` };
  }

  const marketCap = p.marketCap ?? p.fdv ?? null;
  if (MIN_MARKET_CAP_USD > 0 && (marketCap == null || marketCap < MIN_MARKET_CAP_USD)) {
    return { pass: false, reason: `market cap ${marketCap ?? 'tidak ada'} (min $${MIN_MARKET_CAP_USD})` };
  }

  const volume1h = p.volume?.h1 || 0;
  if (volume1h < MIN_VOLUME_1H_USD) {
    return { pass: false, reason: `volume 1h $${volume1h} (min $${MIN_VOLUME_1H_USD})` };
  }

  const txnsH1 = p.txns?.h1;
  const txnCount = txnsH1 ? (txnsH1.buys || 0) + (txnsH1.sells || 0) : 0;
  
  // Skip txn check for Birdeye source (doesn't provide txn counts)
  if (snapshot.source !== 'birdeye' && txnCount === 0) {
    return { pass: false, reason: 'volume ada tapi transaksi 0 (data tidak konsisten)' };
  }
  
  // Calculate avg trade size only if txn data available
  if (txnCount > 0) {
    const avgTradeSize = volume1h / txnCount;
    if (avgTradeSize < MIN_AVG_TRADE_SIZE_USD) {
      return { pass: false, reason: `rata-rata transaksi $${avgTradeSize.toFixed(2)} dari ${txnCount}x (min $${MIN_AVG_TRADE_SIZE_USD})` };
    }
  }

  const cached = state.prices[address] || {};
  state.prices[address] = state.prices[address] || { maxPrice: 0 };

  if (cached.rugcheckSafe === undefined) {
    const rc = await checkRugCheckSafety(address);
    state.prices[address].rugcheckSafe = rc.safe;
    state.prices[address].clusterWarning = rc.clusterWarning || false;

    // LP check: Skip Birdeye for graduated tokens (LP auto-burned by Pump.fun)
    if (cached.isGraduated && cached.lpBurned) {
      // Graduated token: LP already burned to incinerator
      state.prices[address].lpBurnedByGraduation = true;
      console.log(`✅ LP check skipped for graduated token ${address}: LP auto-burned`);
    }
    // Note: LP check from Birdeye removed (0% success rate)
    // Only graduation-based LP detection is reliable

    if (!rc.safe) return { pass: false, reason: `RugCheck: ${rc.reason}` };
  } else if (cached.rugcheckSafe === false) {
    return { pass: false, reason: 'RugCheck: sudah pernah ditandai tidak aman' };
  }

  if (ENABLE_HOLDER_CHECK) {
    if (cached.holderCount === undefined) {
      const holderCount = await getHolderCount(address);
      if (holderCount == null) return { pass: false, reason: 'holder tidak terbaca dari Birdeye' };
      state.prices[address].holderCount = holderCount;
      if (holderCount < MIN_HOLDER_COUNT) return { pass: false, reason: `${holderCount} holder (min ${MIN_HOLDER_COUNT})` };
    } else if (cached.holderCount != null && cached.holderCount < MIN_HOLDER_COUNT) {
      return { pass: false, reason: `${cached.holderCount} holder (min ${MIN_HOLDER_COUNT})` };
    }
  }

  // Bundle check - removed SolanaTracker (always failed)
  // Use Helius bundle check instead (set via analyzeHeliusBundle)
  const bundlePercentage = state.prices[address].bundlePercentage;
  const bundleWarning = bundlePercentage != null && bundlePercentage > BUNDLE_WARNING_PCT;
  
  // Warning jika bundle data tidak tersedia (API gagal setelah retry)
  const bundleDataMissing = bundlePercentage === undefined;

  return {
    pass: true,
    alertData: {
      address, symbol, name, price: snapshot.price, volume1h, marketCap, liquidityUsd, pairUrl: p.url,
      dexId: p.dexId,
      clusterWarning: state.prices[address].clusterWarning || false,
      bundleWarning, bundlePercentage, bundleDataMissing,
      heliusBundleCheck: state.prices[address].heliusBundleCheck, // pending/clean/detected/failed
      heliusBundleData: state.prices[address].heliusBundleData, // Helius analysis result
      lpBurnedByGraduation: state.prices[address].lpBurnedByGraduation || false,
    },
  };
}

// ==================== SIKLUS CEK HARGA (paralel per batch) ====================
const inFlight = new Set(); // cegah token yang sama diproses 2 loop (umum & cepat) bersamaan
async function processOneToken(addr) {
  if (inFlight.has(addr)) return;
  inFlight.add(addr);
  try {
    await processOneTokenInner(addr);
  } finally {
    inFlight.delete(addr);
  }
}
async function processOneTokenInner(addr) {
  let snapshot;
  try {
    // Try DexScreener first, fallback to Birdeye if banned
    snapshot = await getTokenSnapshot(addr, true);
    
    // If DexScreener fails (likely banned), try Birdeye
    if (!snapshot) {
      console.log(`📡 DexScreener failed for ${addr.substring(0,8)}, trying Birdeye...`);
      const birdeyeData = await getBirdeyeTokenData(addr);
      if (birdeyeData) {
        // Convert Birdeye format to snapshot format
        snapshot = {
          address: addr,
          symbol: birdeyeData.symbol,
          name: birdeyeData.name,
          price: birdeyeData.price,
          pair: {
            liquidity: { usd: birdeyeData.liquidity },
            marketCap: birdeyeData.marketCap,
            fdv: birdeyeData.marketCap,
            volume: { 
              h1: birdeyeData.volume1h,
              h24: birdeyeData.volume24h
            },
            txns: { h1: { buys: 1, sells: 1 } }, // Birdeye doesn't provide txn counts, use placeholder
            priceUsd: birdeyeData.price.toString(),
            baseToken: {
              symbol: birdeyeData.symbol,
              name: birdeyeData.name
            }
          },
          source: 'birdeye'
        };
        console.log(`✅ Birdeye data retrieved: liq=$${birdeyeData.liquidity} vol1h=$${birdeyeData.volume1h}`);
      }
    }
  } catch (err) {
    console.error(`Gagal ambil data ${addr}:`, err.message);
    return;
  }
  if (!snapshot) return;

  const entry = state.prices[addr] || { maxPrice: 0 };
  state.prices[addr] = entry; // tulis balik SEGERA — supaya referensi konsisten dipakai
                               // fungsi lain (mis. checkQualityGates) di siklus yang sama,
                               // menghindari data bundle/rugcheck "tidak terlihat" sesaat
  if (snapshot.price > entry.maxPrice) entry.maxPrice = snapshot.price;

  // Penanda PERMANEN (tidak pernah direset oleh sinyal manapun) — apakah token ini
  // PERNAH mencapai level kriteria 1 sepanjang riwayatnya. Sekali pernah, kriteria 2
  // dimatikan SELAMANYA untuk token ini — supaya pantulan lemah sisa tenaga habis
  // pasca-pump besar (misal setelah kriteria 1 sudah terkirim) tidak dianggap sinyal
  // kriteria 2 yang baru. Kriteria 2 murni cuma untuk token yang BELUM PERNAH sama
  // sekali menyentuh level kriteria 1.
  entry.allTimeMaxPrice = Math.max(entry.allTimeMaxPrice || 0, snapshot.price);
  const pernahCapaiTier1 = entry.allTimeMaxPrice >= PRICE_HIGH;

  // Tandai kalau harga pernah "singgah" di zona kriteria 2 (antara PRICE_HIGH_2 dan
  // PRICE_HIGH) sebelum menembus PRICE_HIGH. Kalau harga melompat LANGSUNG dari bawah
  // PRICE_HIGH_2 ke atas PRICE_HIGH tanpa pernah tersampel di zona ini, itu indikasi
  // pump instan/bundled (bukan kenaikan bertahap) — kriteria 1 tidak akan diaktifkan.
  if (PRICE_HIGH_2 != null && snapshot.price >= PRICE_HIGH_2 && snapshot.price < PRICE_HIGH) {
    entry.touchedTier2Zone = true;
  }

  entry.recentPrices = entry.recentPrices || [];
  entry.recentPrices.push({ price: snapshot.price, t: Date.now() });
  if (entry.recentPrices.length > MOMENTUM_WINDOW) {
    entry.recentPrices = entry.recentPrices.slice(-MOMENTUM_WINDOW);
  }

  // Kalau PRICE_HIGH_2 tidak diset, syarat "singgah dulu" tidak berlaku (perilaku lama).
  const passedThroughTier2Zone = PRICE_HIGH_2 == null || entry.touchedTier2Zone === true;

  // Kriteria 1 diprioritaskan kalau tersentuh SECARA BERTAHAP; kriteria 2 HANYA berlaku
  // kalau token ini belum pernah sama sekali menyentuh level kriteria 1 sepanjang riwayatnya.
  const sudahMelambungTier1 = entry.maxPrice >= PRICE_HIGH && passedThroughTier2Zone;
  const sudahMelambungTier2 = PRICE_HIGH_2 != null && entry.maxPrice >= PRICE_HIGH_2 && !pernahCapaiTier1;

  // Begitu armed (kriteria mana pun), langsung cek bundle % kalau belum pernah — supaya
  // token berisiko tinggi bisa segera masuk jalur super cepat, bukan nunggu momen dump.
  // REMOVED: SolanaTracker bundle check (always failed)
  // Using: Helius bundle check instead (analyzeHeliusBundle)

  let dumpThreshold = null;
  let tierLabel = null;
  if (sudahMelambungTier1) {
    dumpThreshold = PRICE_LOW;
    tierLabel = '1';
  } else if (sudahMelambungTier2) {
    dumpThreshold = PRICE_LOW_2;
    tierLabel = '2';
  }

  const sudahTurun = dumpThreshold != null && snapshot.price <= dumpThreshold;

  if (dumpThreshold != null && sudahTurun) {
    const quality = await checkQualityGates(snapshot);
    if (quality.pass) {
      const momentum = computeMomentum(entry.recentPrices);
      console.log(`🚨 Sinyal (kriteria ${tierLabel}): ${snapshot.symbol} (${addr}) — puncak $${entry.maxPrice} → sekarang $${snapshot.price} — momentum: ${momentum.label}`);
      await sendTelegramAlert({ ...quality.alertData, momentum, tierLabel });
      entry.maxPrice = snapshot.price;
      entry.recentPrices = [];
      entry.touchedTier2Zone = false;
      entry.signalSent = true; // Mark signal sent for cleanup
    } else {
      console.log(`Sinyal tertunda (kriteria ${tierLabel}): ${snapshot.symbol} (${addr}) — ${quality.reason}`);
    }
  }

  state.prices[addr] = entry;
}

// Cari token yang sudah "armed" (tinggal tunggu dump) — cek murni dari data di memori,
// tanpa panggilan API, jadi ringan dipanggil tiap beberapa detik.
function getArmedAddresses() {
  return state.watchlist.filter((addr) => {
    const entry = state.prices[addr];
    if (!entry) return false;
    const pernahCapaiTier1 = (entry.allTimeMaxPrice || 0) >= PRICE_HIGH;
    const armedTier1 = entry.maxPrice >= PRICE_HIGH;
    const armedTier2 = PRICE_HIGH_2 != null && entry.maxPrice >= PRICE_HIGH_2 && !pernahCapaiTier1;
    return armedTier1 || armedTier2;
  });
}

function getHighRiskArmedAddresses(armedAddresses) {
  return armedAddresses.filter((addr) => {
    const pct = state.prices[addr]?.bundlePercentage;
    return pct != null && pct > BUNDLE_WARNING_PCT;
  });
}

let isFastChecking = false;
async function fastCheckArmedTokens() {
  if (isFastChecking) return;
  const armed = getArmedAddresses();
  if (armed.length === 0) return;
  isFastChecking = true;
  try {
    await Promise.all(armed.map((addr) => processOneToken(addr)));
    saveState(state);
  } finally {
    isFastChecking = false;
  }
}

let isHighRiskChecking = false;
async function highRiskCheckArmedTokens() {
  if (isHighRiskChecking) return;
  const highRisk = getHighRiskArmedAddresses(getArmedAddresses());
  if (highRisk.length === 0) return;
  isHighRiskChecking = true;
  try {
    await Promise.all(highRisk.map((addr) => processOneToken(addr)));
    saveState(state);
  } finally {
    isHighRiskChecking = false;
  }
}

let isChecking = false;
async function checkPricesOnce() {
  if (isChecking) {
    console.log('Siklus cek harga sebelumnya masih berjalan, lewati siklus ini.');
    return;
  }
  isChecking = true;
  try {
    await checkPricesOnceInner();
  } finally {
    isChecking = false;
  }
}
async function checkPricesOnceInner() {
  if (state.watchlist.length === 0) {
    console.log('Watchlist masih kosong, tunggu refresh pertama selesai...');
    return;
  }
  console.log(`[${new Date().toISOString()}] Cek harga ${state.watchlist.length} koin di watchlist (Jupiter batch API)...`);

  // Fetch ALL prices in one Jupiter API call (up to 100 tokens)
  const jupiterPrices = await getJupiterPrices(state.watchlist);
  
  // Update price tracking for each token
  for (const addr of state.watchlist) {
    const jupData = jupiterPrices[addr];
    if (!jupData || !jupData.usdPrice) {
      // Token not found in Jupiter, skip (might be too new or delisted)
      continue;
    }
    
    // Update price tracking in state
    const entry = state.prices[addr] || { maxPrice: 0 };
    state.prices[addr] = entry;
    
    const currentPrice = jupData.usdPrice;
    
    // Filter out major coins (price > $1 = not memecoin)
    if (currentPrice > MAX_MEMECOIN_PRICE) {
      continue; // Skip SOL, BTC, ETH, USDC, etc.
    }
    
    // Update maxPrice if current price is higher
    if (currentPrice > entry.maxPrice) {
      entry.maxPrice = currentPrice;
    }
    
    // Track all-time max price (for tier logic)
    entry.allTimeMaxPrice = Math.max(entry.allTimeMaxPrice || 0, currentPrice);
    
    // Update recent prices for momentum calculation
    entry.recentPrices = entry.recentPrices || [];
    entry.recentPrices.push({ price: currentPrice, t: Date.now() });
    if (entry.recentPrices.length > MOMENTUM_WINDOW) {
      entry.recentPrices = entry.recentPrices.slice(-MOMENTUM_WINDOW);
    }
    
    // Store Jupiter liquidity data (bonus!)
    if (jupData.liquidity != null) {
      entry.jupiterLiquidity = jupData.liquidity;
    }
    
    // Mark if price crossed tier 2 zone (for tier 1 eligibility)
    if (PRICE_HIGH_2 != null && currentPrice >= PRICE_HIGH_2 && currentPrice < PRICE_HIGH) {
      entry.touchedTier2Zone = true;
    }
    
    // Check if token is armed (crossed threshold)
    const pernahCapaiTier1 = entry.allTimeMaxPrice >= PRICE_HIGH;
    const passedThroughTier2Zone = PRICE_HIGH_2 == null || entry.touchedTier2Zone === true;
    const sudahMelambungTier1 = entry.maxPrice >= PRICE_HIGH && passedThroughTier2Zone;
    const sudahMelambungTier2 = PRICE_HIGH_2 != null && entry.maxPrice >= PRICE_HIGH_2 && !pernahCapaiTier1;
    
    let dumpThreshold = null;
    let tierLabel = null;
    if (sudahMelambungTier1) {
      dumpThreshold = PRICE_LOW;
      tierLabel = '1';
    } else if (sudahMelambungTier2) {
      dumpThreshold = PRICE_LOW_2;
      tierLabel = '2';
    }
    
    const sudahTurun = dumpThreshold != null && currentPrice <= dumpThreshold;
    
    // If dump detected, call full check with DexScreener for complete data
    if (dumpThreshold != null && sudahTurun) {
      console.log(`🔍 DUMP DETECTED: ${addr.substring(0,8)}... maxPrice=$${entry.maxPrice} current=$${currentPrice} threshold=$${dumpThreshold}`);
      // Call existing processOneToken for full quality check
      await processOneToken(addr);
    }
  }

  saveState(state);
}

// ==================== SMART WATCHLIST CLEANUP ====================
async function cleanupWatchlist() {
  const now = Date.now();
  const removed = [];
  const initialCount = state.watchlist.length;
  
  state.watchlist = state.watchlist.filter(addr => {
    const priceData = state.prices[addr];
    if (!priceData) {
      // No price data at all = remove
      removed.push(`${addr.substring(0, 8)}... (no data)`);
      return false;
    }
    
    // FILTER 0: Remove major coins (price > $1)
    const currentPrice = priceData.recentPrices && priceData.recentPrices.length > 0 
      ? priceData.recentPrices[priceData.recentPrices.length - 1].price 
      : 0;
    if (currentPrice > MAX_MEMECOIN_PRICE) {
      removed.push(`${addr.substring(0, 8)}... (major coin $${currentPrice.toFixed(2)})`);
      return false;
    }
    
    // FILTER 0.5: Remove blacklisted addresses
    if (MAJOR_COIN_BLACKLIST.includes(addr)) {
      removed.push(`${addr.substring(0, 8)}... (blacklisted)`);
      return false;
    }
    
    const age = now - (priceData.discoveredAt || now);
    const ageMinutes = age / 60000;
    
    // KEEP if:
    // 1. Fresh (<30 min) - give chance to pump
    if (ageMinutes < 30) return true;
    
    // 2. Has pumped (maxPrice >0) AND not too old (<120 min) - wait for dump signal
    if (priceData.maxPrice > 0 && ageMinutes < 120) return true;
    
    // REMOVE if:
    // 3. Old (>60 min) AND never pumped (maxPrice = 0) - dead token
    if (ageMinutes > 60 && priceData.maxPrice === 0) {
      removed.push(`${addr.substring(0, 8)}... (${ageMinutes.toFixed(0)}min, never pumped)`);
      return false;
    }
    
    // 4. Very old (>120 min) - max age limit
    if (ageMinutes > 120) {
      removed.push(`${addr.substring(0, 8)}... (${ageMinutes.toFixed(0)}min, too old)`);
      return false;
    }
    
    // 5. Already sent signal - job done
    if (priceData.signalSent) {
      removed.push(`${addr.substring(0, 8)}... (signal sent)`);
      return false;
    }
    
    return true; // Keep by default
  });
  
  if (removed.length > 0) {
    console.log(`🧹 Cleanup: removed ${removed.length}/${initialCount} tokens (${state.watchlist.length} remaining)`);
    removed.slice(0, 5).forEach(r => console.log(`  - ${r}`));
    if (removed.length > 5) {
      console.log(`  ... and ${removed.length - 5} more`);
    }
    saveState(state);
  }
}

// ==================== IN-MEMORY SIGNAL QUEUE ====================
const signalQueue = [];
const MAX_QUEUE_SIZE = 1000;

function addSignalToQueue(signalData) {
  signalQueue.push({
    ...signalData,
    _id: Date.now(),
    receivedAtWIB: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
  });
  
  // Trim queue if too large
  if (signalQueue.length > MAX_QUEUE_SIZE) {
    signalQueue.splice(0, signalQueue.length - MAX_QUEUE_SIZE);
  }
}

// ==================== INTEGRATED MIDDLEWARE HTTP SERVER ====================
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // GET /signals - Hermes poller endpoint
  if (req.method === 'GET' && req.url === '/signals') {
    const response = {
      success: true,
      count: signalQueue.length,
      signals: [...signalQueue],
      timestamp: new Date().toISOString()
    };
    
    // Clear queue after sending
    signalQueue.length = 0;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    return;
  }
  
  // POST /signal - External signal receiver (optional, for compatibility)
  if (req.method === 'POST' && req.url === '/signal') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const signalData = JSON.parse(body);
        addSignalToQueue(signalData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          queueSize: signalQueue.length 
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }
  
  // GET /health - Health check
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      queueSize: signalQueue.length,
      timestamp: new Date().toISOString() 
    }));
    return;
  }
  
  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🚀 Bot + Middleware integrated server running on port ${PORT}`);
  console.log(`📡 Endpoints: GET /signals, POST /signal, GET /health`);
});

// ==================== HELIUS BUNDLE ANALYSIS ====================
async function analyzeHeliusBundleBuys(tokenMint, launchTimestamp) {
  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  
  if (!HELIUS_API_KEY) {
    console.log('⚠️ HELIUS_API_KEY not set, skip bundle analysis');
    return null;
  }
  
  try {
    const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
    
    // Get first 100 signatures for this token
    const sigResponse = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [tokenMint, { limit: 100 }]
      })
    });
    
    // Check HTTP status before parsing JSON
    if (!sigResponse.ok) {
      const status = sigResponse.status;
      const statusText = sigResponse.statusText;
      
      if (status === 401) {
        console.error(`⚠️ Helius 401 Unauthorized for ${tokenMint.substring(0, 8)}... - API key issue or token not accessible`);
        return { isBundled: false, reason: 'Helius 401: API key issue or restricted token' };
      } else if (status === 429) {
        console.error(`⚠️ Helius rate limit (429) for ${tokenMint.substring(0, 8)}...`);
        return { isBundled: false, reason: 'Helius rate limit exceeded' };
      } else {
        console.error(`⚠️ Helius HTTP ${status} (${statusText}) for ${tokenMint.substring(0, 8)}...`);
        return { isBundled: false, reason: `Helius HTTP ${status}` };
      }
    }
    
    const sigData = await sigResponse.json();
    if (!sigData.result || sigData.result.length === 0) {
      return { isBundled: false, reason: 'No transactions yet' };
    }
    
    // Token too new, not enough transactions for analysis
    if (sigData.result.length < 10) {
      return { isBundled: false, reason: 'Too few transactions (< 10), token very new' };
    }
    
    // Analyze transaction patterns from signatures (no Enhanced API needed)
    const signatures = sigData.result.slice(0, 50);
    
    // Group by slot to detect bundling
    const slotGroups = {};
    const wallets = new Set();
    
    signatures.forEach(sig => {
      const slot = sig.slot;
      if (!slotGroups[slot]) slotGroups[slot] = [];
      slotGroups[slot].push(sig);
    });
    
    // Simple bundle detection: multiple transactions in same slot
    const bundledSlots = Object.entries(slotGroups).filter(([_, sigs]) => sigs.length > 1);
    const totalTxs = signatures.length;
    const uniqueSlots = Object.keys(slotGroups).length;
    
    // If many txs in few slots = likely bundled
    const slotConcentration = (totalTxs / uniqueSlots);
    const isBundled = bundledSlots.length > 3 || slotConcentration > 2;
    
    return {
      isBundled,
      bundlePercentage: ((bundledSlots.length / Object.keys(slotGroups).length) * 100).toFixed(1),
      uniqueSlots,
      totalTxs,
      bundledSlots: bundledSlots.length,
      slotConcentration: slotConcentration.toFixed(2),
      slotsWithMultipleTxs: bundledSlots.map(([slot, sigs]) => ({
        slot,
        count: sigs.length
      }))
    };
    
  } catch (error) {
    console.error('❌ Helius bundle analysis error:', error.message);
    return null;
  }
}

// ==================== MULTI-HELIUS ENHANCED WEBSOCKET (3x REDUNDANCY + 5 DEX) ====================
function setupMultiHeliusEnhancedWebSocket() {
  const HELIUS_KEYS = [
    process.env.HELIUS_API_KEY,      // Key 1 (primary)
    process.env.HELIUS_API_KEY_2,    // Key 2
    process.env.HELIUS_API_KEY_3,    // Key 3
    process.env.HELIUS_API_KEY_4,    // Key 4 (Babeh08)
    process.env.HELIUS_API_KEY_5,    // Key 5 (Babeh083)
    process.env.HELIUS_API_KEY_6,    // Key 6 (Babeh084)
    process.env.HELIUS_API_KEY_7,    // Key 7 (Babeh085)
    process.env.HELIUS_API_KEY_8,    // Key 8 (Babeh086)
    process.env.HELIUS_API_KEY_9,    // Key 9 (Babeh088)
    process.env.HELIUS_API_KEY_10    // Key 10 (Babeh089)
  ].filter(key => key); // Remove undefined keys
  
  if (HELIUS_KEYS.length === 0) {
    console.log('⚠️ No HELIUS_API_KEY set, skipping Helius WebSocket discovery');
    return;
  }
  
  console.log(`🔥 Starting ${HELIUS_KEYS.length} Helius WebSocket connection(s)...`);
  
  // DEX Programs to monitor (5 major Solana DEXs)
  const DEX_PROGRAMS = [
    { name: 'Raydium AMM v4', address: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8' },
    { name: 'Orca Whirlpool', address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc' },
    { name: 'Meteora DLMM', address: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo' },
    { name: 'Phoenix', address: 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY' },
    { name: 'Lifinity', address: 'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S' }
  ];
  
  const WebSocket = require('ws');
  
  // Create WebSocket connection for each API key
  HELIUS_KEYS.forEach((apiKey, keyIndex) => {
    const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${apiKey}`;
    let ws;
    let reconnectTimeout;
    
    function connect() {
      ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        console.log(`✅ Helius WebSocket #${keyIndex + 1} connected`);
        
        // Subscribe to ALL DEX programs
        DEX_PROGRAMS.forEach((dex, dexIndex) => {
          const subscriptionId = keyIndex * 100 + dexIndex + 1;
          
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: subscriptionId,
            method: 'transactionSubscribe',
            params: [
              {
                accountInclude: [dex.address],
                failed: false
              },
              {
                commitment: 'confirmed',
                encoding: 'jsonParsed',
                transactionDetails: 'full',
                showRewards: false,
                maxSupportedTransactionVersion: 0
              }
            ]
          }));
        });
        
        console.log(`📡 WebSocket #${keyIndex + 1}: Subscribed to ${DEX_PROGRAMS.length} DEX programs`);
      });
      
      ws.on('message', async (data) => {
        try {
          const response = JSON.parse(data);
          
          // Skip subscription confirmation
          if (response.result !== undefined && !response.params) return;
          
          // Parse transaction notification
          const tx = response.params?.result?.transaction;
          if (!tx) return;
          
          // Extract token mints from transaction
          const mints = extractTokenMintsFromTransaction(tx);
          
          // Process each detected token
          for (const mint of mints) {
            // Skip if already in watchlist
            if (state.watchlist.includes(mint)) continue;
            
            console.log(`\n${'='.repeat(60)}`);
            console.log(`⚡ HELIUS DISCOVERY #${keyIndex + 1} (DEX ACTIVITY)`);
            console.log(`${'='.repeat(60)}`);
            console.log(`🪙 Token Mint: ${mint}`);
            console.log(`⏱️ Detected: ${new Date().toISOString()}`);
            console.log(`📊 Source: Multi-DEX (${DEX_PROGRAMS.length} programs)`);
            console.log(`🔑 Connection: #${keyIndex + 1}`);
            console.log(`${'='.repeat(60)}\n`);
            
            // Add to watchlist immediately
            state.watchlist.push(mint);
            state.prices[mint] = {
              maxPrice: 0,
              source: `helius-multi-${keyIndex + 1}`,
              discoveredAt: Date.now(),
              symbol: 'Unknown',
              name: 'Unknown'
            };
            
            console.log(`✅ Added to watchlist (MULTI-DEX): ${mint}`);
            console.log(`📊 Total watchlist: ${state.watchlist.length} tokens`);
          }
          
        } catch (e) {
          console.log(`⚠️ Helius WS #${keyIndex + 1} message error:`, e.message);
        }
      });
      
      ws.on('error', (err) => {
        console.log(`❌ Helius WebSocket #${keyIndex + 1} error: ${err.message}`);
      });
      
      ws.on('close', () => {
        console.log(`🔌 Helius WebSocket #${keyIndex + 1} closed, reconnecting in 5s...`);
        reconnectTimeout = setTimeout(connect, 5000);
      });
    }
    
    // Helper: Extract token mints from transaction
    function extractTokenMintsFromTransaction(tx) {
      const mints = new Set();
      
      try {
        const accounts = tx.meta?.postTokenBalances || [];
        for (const acc of accounts) {
          if (acc.mint) mints.add(acc.mint);
        }
        
        const preAccounts = tx.meta?.preTokenBalances || [];
        for (const acc of preAccounts) {
          if (acc.mint) mints.add(acc.mint);
        }
      } catch (e) {
        // Ignore parse errors
      }
      
      return Array.from(mints);
    }
    
    connect();
  });
  
  console.log(`🎯 Multi-Helius system: ${HELIUS_KEYS.length} connections × ${DEX_PROGRAMS.length} DEXs = ${HELIUS_KEYS.length * DEX_PROGRAMS.length} subscriptions`);
  console.log(`⚡ Expected detection: 0-3 seconds!\n`);
}

// ==================== OLD SINGLE HELIUS WEBSOCKET (REPLACED) ====================
function setupHeliusEnhancedWebSocket() {
  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  
  if (!HELIUS_API_KEY) {
    console.log('⚠️ HELIUS_API_KEY not set, skipping Helius WebSocket discovery');
    return;
  }
  
  const WebSocket = require('ws');
  const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  let ws;
  let reconnectTimeout;
  
  function connect() {
    ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
      console.log('✅ Helius Enhanced WebSocket connected');
      
      // Subscribe to Raydium AMM program transactions
      const raydiumProgram = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
      
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'transactionSubscribe',
        params: [
          {
            accountInclude: [raydiumProgram],
            failed: false
          },
          {
            commitment: 'confirmed',
            encoding: 'jsonParsed',
            transactionDetails: 'full',
            showRewards: false,
            maxSupportedTransactionVersion: 0
          }
        ]
      }));
      
      console.log('📡 Subscribed to Raydium DEX transactions (Helius)');
    });
    
    ws.on('message', async (data) => {
      try {
        const response = JSON.parse(data);
        
        // Skip subscription confirmation
        if (response.result) return;
        
        // Parse transaction notification
        const tx = response.params?.result?.transaction;
        if (!tx) return;
        
        // Extract token mints from transaction
        const mints = extractTokenMintsFromTransaction(tx);
        
        // Process each detected token
        for (const mint of mints) {
          // Skip if already in watchlist
          if (state.watchlist.includes(mint)) continue;
          
          console.log(`\n${'='.repeat(60)}`);
          console.log(`⚡ HELIUS DISCOVERY (DEX ACTIVITY)`);
          console.log(`${'='.repeat(60)}`);
          console.log(`🪙 Token Mint: ${mint}`);
          console.log(`⏱️ Detected: ${new Date().toISOString()}`);
          console.log(`📊 Source: Raydium swap activity`);
          console.log(`${'='.repeat(60)}\n`);
          
          // Add to watchlist immediately
          state.watchlist.push(mint);
          state.prices[mint] = {
            maxPrice: 0,
            source: 'helius-dex',
            discoveredAt: Date.now(),
            symbol: 'Unknown',
            name: 'Unknown'
          };
          
          console.log(`✅ Added to watchlist (DEX-ACTIVITY): ${mint}`);
          console.log(`📊 Total watchlist: ${state.watchlist.length} tokens`);
        }
        
      } catch (e) {
        console.log('⚠️ Helius WebSocket message parse error:', e.message);
      }
    });
    
    ws.on('error', (err) => {
      console.log(`❌ Helius WebSocket error: ${err.message}`);
    });
    
    ws.on('close', () => {
      console.log('🔌 Helius WebSocket closed, reconnecting in 5 seconds...');
      reconnectTimeout = setTimeout(connect, 5000);
    });
  }
  
  // Helper: Extract token mints from transaction
  function extractTokenMintsFromTransaction(tx) {
    const mints = new Set();
    
    try {
      // Extract from account keys
      const accounts = tx.meta?.postTokenBalances || [];
      for (const acc of accounts) {
        if (acc.mint) mints.add(acc.mint);
      }
      
      // Also check preTokenBalances
      const preAccounts = tx.meta?.preTokenBalances || [];
      for (const acc of preAccounts) {
        if (acc.mint) mints.add(acc.mint);
      }
    } catch (e) {
      // Ignore parse errors
    }
    
    return Array.from(mints);
  }
  
  connect();
}

// ==================== PUMPPORTAL WEBSOCKET (REAL-TIME DISCOVERY) ====================
function setupPumpPortalWebSocket() {
  const ws = new WebSocket('wss://pumpportal.fun/api/data');
  
  ws.on('open', () => {
    console.log('✅ PumpPortal WebSocket connected');
    
    // Subscribe to new token launches
    ws.send(JSON.stringify({
      method: 'subscribeNewToken'
    }));
    
    console.log('📡 Subscribed to real-time token launches (PumpPortal)');
  });
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      // Extract token info
      const mint = msg.mint;
      const name = msg.name || 'Unknown';
      const symbol = msg.symbol || 'Unknown';
      const txType = msg.txType;
      
      // Handle 'complete' event (token graduated to PumpSwap/Raydium)
      if (txType === 'complete' && mint) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎓 TOKEN GRADUATED (LP AUTO-BURNED)`);
        console.log(`${'='.repeat(60)}`);
        console.log(`🪙 Token: ${name} (${symbol})`);
        console.log(`📝 Mint: ${mint}`);
        console.log(`⏱️ Graduated: ${new Date().toISOString()}`);
        console.log(`✅ LP Status: BURNED to incinerator (Pump.fun default)`);
        console.log(`${'='.repeat(60)}\n`);
        
        // Mark token as graduated with LP burned
        if (state.prices[mint]) {
          state.prices[mint].isGraduated = true;
          state.prices[mint].lpBurned = true;
          state.prices[mint].graduatedAt = Date.now();
          console.log(`✅ Updated token status: ${symbol} - LP BURNED (graduated)`);
          
          // v38: Subscribe to real-time swaps for criteria detection
          subscribeToTokenSwaps(mint, name, symbol);
        } else {
          // Token not in watchlist yet, add it with graduated status
          state.watchlist.push(mint);
          state.prices[mint] = {
            maxPrice: 0,
            source: 'websocket-graduated',
            discoveredAt: Date.now(),
            name: name,
            symbol: symbol,
            isGraduated: true,
            lpBurned: true,
            graduatedAt: Date.now()
          };
          console.log(`✅ Added graduated token to watchlist: ${symbol}`);
          
          // v38: Subscribe to real-time swaps for criteria detection
          subscribeToTokenSwaps(mint, name, symbol);
        }
        
        return; // Don't process as 'create' event
      }
      
      // Only process new token creations
      if (txType !== 'create' || !mint) return;
      
      // Check if already in watchlist
      if (state.watchlist.includes(mint)) {
        console.log(`⚠️ WebSocket: ${symbol} already in watchlist, skip`);
        return;
      }
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🚀 WEBSOCKET DISCOVERY (REAL-TIME)`);
      console.log(`${'='.repeat(60)}`);
      console.log(`🪙 Token: ${name} (${symbol})`);
      console.log(`📝 Mint: ${mint}`);
      console.log(`⏱️ Detected: ${new Date().toISOString()}`);
      console.log(`📊 Market Cap: ${msg.marketCapSol?.toFixed(2) || 'N/A'} SOL`);
      console.log(`${'='.repeat(60)}\n`);
      
      // Add to watchlist immediately (fast-track)
      state.watchlist.push(mint);
      state.prices[mint] = {
        maxPrice: 0,
        source: 'websocket',
        discoveredAt: Date.now(),
        name: name,
        symbol: symbol,
        initialMarketCap: msg.marketCapSol || 0,
        heliusBundleCheck: 'pending' // Will be checked in 30 seconds
      };

      console.log(`✅ Added to watchlist (FAST-TRACK): ${symbol}`);
      console.log(`📊 Total watchlist: ${state.watchlist.length} tokens`);

      
    } catch (e) {
      console.error('❌ WebSocket message parse error:', e.message);
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ PumpPortal WebSocket error:', error.message);
  });
  
  ws.on('close', () => {
    console.log('🔌 PumpPortal WebSocket closed, reconnecting in 5 seconds...');
    setTimeout(setupPumpPortalWebSocket, 5000);
  });
  
  return ws;
}

// ==================== v38: REAL-TIME CRITERIA DETECTION ====================

// Store active WebSocket connections per token
const tokenWebSockets = {};

/**
 * Subscribe to real-time swap events for a specific token
 * Monitors EVERY swap to detect Criteria 1 & 2 crossings instantly (0-3s)
 */
function subscribeToTokenSwaps(mint, tokenName, tokenSymbol) {
  // Only monitor new tokens (<24h old)
  const tokenData = state.prices[mint];
  if (!tokenData) {
    console.log(`⏭️ [v38] Token ${tokenSymbol} not in state, skip WS subscription`);
    return;
  }
  
  const tokenAge = Date.now() - (tokenData.graduatedAt || tokenData.discoveredAt || 0);
  const isNewToken = tokenAge < 86400000; // <24h
  
  if (!isNewToken) {
    console.log(`⏭️ [v38] Token ${tokenSymbol} too old (${(tokenAge/3600000).toFixed(1)}h), skip WS subscription`);
    return;
  }
  
  // Check if already subscribed
  if (tokenWebSockets[mint]) {
    console.log(`⚠️ [v38] Already subscribed to ${tokenSymbol}, skip duplicate`);
    return;
  }
  
  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  if (!HELIUS_API_KEY) {
    console.log(`⚠️ [v38] No Helius API key, cannot subscribe to ${tokenSymbol}`);
    return;
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📡 [v38] SUBSCRIBING TO REAL-TIME SWAPS`);
  console.log(`${'='.repeat(60)}`);
  console.log(`🪙 Token: ${tokenSymbol}`);
  console.log(`📝 Mint: ${mint.slice(0, 8)}...${mint.slice(-6)}`);
  console.log(`⏱️ Age: ${(tokenAge/60000).toFixed(0)} minutes`);
  console.log(`🎯 Target: Criteria 1 & 2 detection (0-3s)`);
  console.log(`${'='.repeat(60)}\n`);
  
  const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  const ws = new WebSocket(wsUrl);
  
  ws.on('open', () => {
    console.log(`✅ [v38] Connected: ${tokenSymbol}`);
    
    // Subscribe to transactions mentioning this token
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id: `v38-${mint}`,
      method: 'transactionSubscribe',
      params: [
        {
          mentions: [mint],
          commitment: 'confirmed'
        },
        {
          encoding: 'jsonParsed',
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        }
      ]
    }));
    
    console.log(`🎧 [v38] Listening for swaps: ${tokenSymbol}`);
  });
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Skip subscription confirmations
      if (msg.result) return;
      
      // Get transaction data
      if (!msg.params || !msg.params.result) return;
      
      const txData = msg.params.result;
      if (!txData.transaction) return;
      
      // For now, trigger price check on any transaction
      // Real price extraction from swap instruction would go here
      // This triggers existing checkPrices logic which has price data
      const tokenData = state.prices[mint];
      if (tokenData && tokenData.lastPrice) {
        checkCriteria1And2RealTime(mint, tokenData.lastPrice, tokenSymbol);
      }
      
    } catch (e) {
      // Silent - too verbose for production
    }
  });
  
  ws.on('error', (error) => {
    console.error(`❌ [v38] WebSocket error for ${tokenSymbol}:`, error.message);
  });
  
  ws.on('close', () => {
    console.log(`🔌 [v38] WebSocket closed for ${tokenSymbol}`);
    delete tokenWebSockets[mint];
    
    // Reconnect if token still new
    const tokenData = state.prices[mint];
    if (tokenData) {
      const tokenAge = Date.now() - (tokenData.graduatedAt || tokenData.discoveredAt || 0);
      if (tokenAge < 86400000) {
        console.log(`🔄 [v38] Reconnecting to ${tokenSymbol} in 5 seconds...`);
        setTimeout(() => subscribeToTokenSwaps(mint, tokenName, tokenSymbol), 5000);
      }
    }
  });
  
  tokenWebSockets[mint] = ws;
}

/**
 * Check Criteria 1 & 2 thresholds in real-time
 * Called every time we detect activity for monitored token
 */
function checkCriteria1And2RealTime(mint, currentPrice, tokenSymbol) {
  const tokenData = state.prices[mint];
  if (!tokenData) return;
  
  // Initialize criteria tracking if not exists
  if (!tokenData.criteria1v38) {
    tokenData.criteria1v38 = {
      tier1CrossedHigh: false,
      tier1CrossedHighAt: null,
      tier1HighPrice: null,
      tier2CrossedHigh: false,
      tier2CrossedHighAt: null,
      tier2HighPrice: null,
      activeTier: null,
      signalSent: false
    };
  }
  
  const c1 = tokenData.criteria1v38;
  
  // Skip if already sent signal
  if (c1.signalSent) return;
  
  // TIER 1: Check HIGH threshold crossing
  if (!c1.tier1CrossedHigh && currentPrice >= PRICE_HIGH) {
    c1.tier1CrossedHigh = true;
    c1.tier1CrossedHighAt = Date.now();
    c1.tier1HighPrice = currentPrice;
    c1.activeTier = 1;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎯 [v38 REAL-TIME] CRITERIA 1 (TIER 1) HIGH CROSSED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`🪙 Token: ${tokenSymbol}`);
    console.log(`📝 Mint: ${mint.slice(0, 8)}...${mint.slice(-6)}`);
    console.log(`💰 Price: $${currentPrice.toFixed(8)}`);
    console.log(`📊 Threshold: $${PRICE_HIGH.toFixed(8)}`);
    console.log(`⏱️ Time: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(60)}\n`);
  }
  
  // TIER 2: Check HIGH threshold crossing (if enabled and Tier 1 not crossed)
  if (PRICE_HIGH_2 && !c1.tier1CrossedHigh && !c1.tier2CrossedHigh && currentPrice >= PRICE_HIGH_2) {
    c1.tier2CrossedHigh = true;
    c1.tier2CrossedHighAt = Date.now();
    c1.tier2HighPrice = currentPrice;
    c1.activeTier = 2;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎯 [v38 REAL-TIME] CRITERIA 2 (TIER 2) HIGH CROSSED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`🪙 Token: ${tokenSymbol}`);
    console.log(`💰 Price: $${currentPrice.toFixed(8)}`);
    console.log(`📊 Threshold: $${PRICE_HIGH_2.toFixed(8)}`);
    console.log(`⏱️ Time: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(60)}\n`);
  }
  
  // Check TIER 1 LOW threshold (dump detection)
  if (c1.tier1CrossedHigh && currentPrice <= PRICE_LOW) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🚨 [v38 REAL-TIME] CRITERIA 1 DETECTED! (TIER 1)`);
    console.log(`${'='.repeat(70)}`);
    console.log(`🪙 Token: ${tokenSymbol}`);
    console.log(`📝 Mint: ${mint.slice(0, 8)}...${mint.slice(-6)}`);
    console.log(`💰 High: $${c1.tier1HighPrice.toFixed(8)} @ ${new Date(c1.tier1CrossedHighAt).toISOString()}`);
    console.log(`💰 Low: $${currentPrice.toFixed(8)} @ ${new Date().toISOString()}`);
    console.log(`📉 Dump: ${(((c1.tier1HighPrice - currentPrice) / c1.tier1HighPrice) * 100).toFixed(1)}%`);
    console.log(`⏱️ Duration: ${((Date.now() - c1.tier1CrossedHighAt) / 1000).toFixed(0)}s`);
    console.log(`${'='.repeat(70)}\n`);
    
    // Mark as detected - trigger normal flow
    c1.signalSent = true;
    tokenData.crossedHigh = true;
    tokenData.highPrice = c1.tier1HighPrice;
    tokenData.dumpedToLow = true;
    tokenData.tier = 1;
    
  } else if (PRICE_LOW_2 && c1.tier2CrossedHigh && !c1.tier1CrossedHigh && currentPrice <= PRICE_LOW_2) {
    // TIER 2 LOW threshold
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🚨 [v38 REAL-TIME] CRITERIA 2 DETECTED! (TIER 2)`);
    console.log(`${'='.repeat(70)}`);
    console.log(`🪙 Token: ${tokenSymbol}`);
    console.log(`💰 High: $${c1.tier2HighPrice.toFixed(8)}`);
    console.log(`💰 Low: $${currentPrice.toFixed(8)}`);
    console.log(`📉 Dump: ${(((c1.tier2HighPrice - currentPrice) / c1.tier2HighPrice) * 100).toFixed(1)}%`);
    console.log(`⏱️ Duration: ${((Date.now() - c1.tier2CrossedHighAt) / 1000).toFixed(0)}s`);
    console.log(`${'='.repeat(70)}\n`);
    
    c1.signalSent = true;
    tokenData.crossedHigh = true;
    tokenData.highPrice = c1.tier2HighPrice;
    tokenData.dumpedToLow = true;
    tokenData.tier = 2;
  }
}

// ==================== JALANKAN ====================
(async () => {
  // Start PumpPortal WebSocket for real-time discovery
  setupPumpPortalWebSocket();
  setupMultiHeliusEnhancedWebSocket();
  
  // Jalankan health check pertama kali saat startup
  console.log('🏥 Menjalankan Helius health check pertama kali...');
  await checkHeliusHealth();
  
  console.log('🔥 HYBRID DISCOVERY SYSTEM ACTIVE:');
  console.log('  - WebSocket (Multi-Helius): 0-5 sec (3 connections × 5 DEXs)');
  console.log('  - WebSocket (PumpPortal): 0-10 sec (new token creation)');
  console.log('  - Polling (Birdeye): 45 min (top volume)');
  console.log(`  - Polling (Gecko): ${(GECKO_DISCOVER_INTERVAL_MS / 1000).toFixed(0)} sec (trending backup)\n`);
  
  await refreshBirdeyeWatchlist();
  await refreshGeckoWatchlist();
  await checkPricesOnce();
  setInterval(refreshBirdeyeWatchlist, BIRDEYE_DISCOVER_INTERVAL_MS);
  setInterval(refreshGeckoWatchlist, GECKO_DISCOVER_INTERVAL_MS);
  setInterval(checkPricesOnce, CHECK_INTERVAL_MS);
  setInterval(fastCheckArmedTokens, FAST_CHECK_INTERVAL_MS);
  setInterval(highRiskCheckArmedTokens, HIGH_RISK_FAST_CHECK_INTERVAL_MS);
  setInterval(cleanupWatchlist, 10 * 60 * 1000); // Cleanup every 10 minutes
  
  // Start Telegram command listener (Phase 1: Read-only)
  const { startCommandListener } = require('./telegram-commands.js');
  startCommandListener(BOT_TOKEN, state).catch(err => {
    console.error('❌ Command listener crashed:', err);
  });
})();
