// ==================== v45 CLEANUP HELPER FUNCTIONS ====================

// Price cache for watchlist (75s TTL)
const priceCache = new Map(); // { tokenAddress: { price, timestamp, data } }
const CACHE_TTL_MS = 75 * 1000; // 75 seconds (was 90s in v44)

// Cleanup configuration
const MAX_WATCHLIST_AGE_MINUTES = 90;
const MIN_VOLUME_24H_USD = 500;
const FLAT_PRICE_DURATION_MINUTES = 30;
const HIGH_RUG_SCORE_THRESHOLD = 60;
const MIN_HOLDERS_THRESHOLD = 50;
const LIQUIDITY_DROP_PERCENT = 20;
const MIN_WATCHLIST_SIZE = 50;
const GRACE_PERIOD_MINUTES = 10;
const MIN_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes

let lastCleanupTime = 0;

// ==================== CRITERION 1: Token Too Old ====================
function isTokenTooOld(token) {
  const ageMinutes = (Date.now() - token.discoveredAt) / 60000;
  
  // Grace period for fresh tokens
  if (ageMinutes < GRACE_PERIOD_MINUTES) {
    return false;
  }
  
  return ageMinutes > MAX_WATCHLIST_AGE_MINUTES;
}

// ==================== CRITERION 2: Low Volume ====================
function hasLowVolume(token) {
  return token.volume24h && token.volume24h < MIN_VOLUME_24H_USD;
}

// ==================== CRITERION 3: Price Flat ====================
function isPriceFlat(token, minutes = FLAT_PRICE_DURATION_MINUTES) {
  const history = token.recentPrices || [];
  const cutoff = Date.now() - (minutes * 60 * 1000);
  const recent = history.filter(p => p.timestamp > cutoff);
  
  if (recent.length < 3) return false;
  
  const firstPrice = recent[0].price;
  return recent.every(p => Math.abs(p.price - firstPrice) < 0.000001);
}

// ==================== CRITERION 4: High Rug Risk ====================
function hasHighRugRisk(token) {
  return token.rugCheckScore && token.rugCheckScore > HIGH_RUG_SCORE_THRESHOLD;
}

// ==================== CRITERION 5: Low Holders ====================
function hasLowHolders(token) {
  return token.holders && token.holders < MIN_HOLDERS_THRESHOLD;
}

// ==================== CRITERION 6: Liquidity Drop ====================
function hasLiquidityDrop(token, percentThreshold = LIQUIDITY_DROP_PERCENT) {
  const history = token.liquidityHistory || [];
  if (history.length < 2) return false;
  
  const oldLiq = history[history.length - 2].value;
  const newLiq = history[history.length - 1].value;
  
  if (oldLiq === 0) return false;
  
  const dropPercent = ((oldLiq - newLiq) / oldLiq) * 100;
  return dropPercent > percentThreshold;
}

// ==================== QUALITY SCORING ====================
function calculateQualityScore(token) {
  let score = 0;
  
  // Volume (0-30 points)
  const vol = token.volume24h || 0;
  if (vol > 50000) score += 30;
  else if (vol > 10000) score += 20;
  else if (vol > 5000) score += 15;
  else if (vol > 1000) score += 10;
  else if (vol > 500) score += 5;
  
  // Liquidity (0-25 points)
  const liq = token.liquidity || 0;
  if (liq > 20000) score += 25;
  else if (liq > 10000) score += 20;
  else if (liq > 5000) score += 15;
  else if (liq > 2000) score += 10;
  else score += 5;
  
  // Holders (0-20 points)
  const holders = token.holders || 0;
  if (holders > 500) score += 20;
  else if (holders > 200) score += 15;
  else if (holders > 100) score += 10;
  else if (holders > 50) score += 5;
  
  // Market cap (0-15 points)
  const mcap = token.marketCap || 0;
  if (mcap > 100000 && mcap < 10000000) score += 15;
  else if (mcap > 50000) score += 10;
  else if (mcap > 10000) score += 5;
  
  // Rug score (0-10 points, inverted)
  const rugScore = token.rugCheckScore || 100;
  if (rugScore < 30) score += 10;
  else if (rugScore < 50) score += 7;
  else if (rugScore < 70) score += 5;
  
  return score;
}

console.log("✅ v45 helper functions loaded");
