// Quick test: getTokenSnapshot with Jupiter fallback
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PRICE_CACHE_TTL_MS = 30000;
const MIN_TOKEN_AGE_MINUTES = 4;
const MAX_TOKEN_AGE_MINUTES = 120;
const pumpApiPriceCache = new Map();

async function getTokenSnapshot(address) {
  const cached = pumpApiPriceCache.get(address);
  if (cached && (Date.now() - cached.timestamp) < PRICE_CACHE_TTL_MS) {
    return { address, price: cached.price };
  }
  
  const jupUrl = `https://api.jup.ag/price/v3?ids=${address}`;
  try {
    const jupRes = await fetch(jupUrl);
    if (jupRes.ok) {
      const jupJson = await jupRes.json();
      const priceData = jupJson[address];
      if (priceData?.usdPrice && priceData.usdPrice > 0) {
        return {
          address,
          symbol: '?',
          name: '?',
          price: priceData.usdPrice,
          pair: null
        };
      }
    }
  } catch (err) {
    console.log('Jupiter API error:', err.message);
  }
  return null;
}

// Test with real token
(async () => {
  const token = 'CrmJtccRoeSb4JVH5hautjWJmwYgKtvWxEco9ankpump';
  console.log('Testing Jupiter fallback...');
  const result = await getTokenSnapshot(token);
  console.log('Result:', result);
  console.log(result?.price ? '✅ PASS: Price fetched' : '❌ FAIL: No price');
})();
