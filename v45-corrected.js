// ==================== v45 CLEANUP SYSTEM (CORRECTED FOR v43 STATE STRUCTURE) ====================

// Price cache for watchlist (75s TTL)
const priceCache = new Map(); // { tokenAddress: { price, timestamp, data } }
const CACHE_TTL_MS = 75 * 1000; // 75 seconds

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
const DRY_RUN = true; // ⚠️ Set false after dry-run verification

// ==================== CRITERION FUNCTIONS ====================

function isTokenTooOld(tokenData) {
  if (!tokenData || !tokenData.discoveredAt) return false;
  const ageMinutes = (Date.now() - tokenData.discoveredAt) / 60000;
  if (ageMinutes < GRACE_PERIOD_MINUTES) return false;
  return ageMinutes > MAX_WATCHLIST_AGE_MINUTES;
}

function hasLowVolume(tokenData) {
  return tokenData && tokenData.volume24h && tokenData.volume24h < MIN_VOLUME_24H_USD;
}

function isPriceFlat(tokenData, minutes = FLAT_PRICE_DURATION_MINUTES) {
  if (!tokenData || !tokenData.recentPrices) return false;
  const history = tokenData.recentPrices || [];
  const cutoff = Date.now() - (minutes * 60 * 1000);
  const recent = history.filter(p => p.t > cutoff);
  if (recent.length < 3) return false;
  const firstPrice = recent[0].price;
  return recent.every(p => Math.abs(p.price - firstPrice) < 0.000001);
}

function hasHighRugRisk(tokenData) {
  return tokenData && tokenData.rugCheckScore && tokenData.rugCheckScore > HIGH_RUG_SCORE_THRESHOLD;
}

function hasLowHolders(tokenData) {
  return tokenData && tokenData.holders && tokenData.holders < MIN_HOLDERS_THRESHOLD;
}

function hasLiquidityDrop(tokenData, percentThreshold = LIQUIDITY_DROP_PERCENT) {
  if (!tokenData || !tokenData.liquidityHistory) return false;
  const history = tokenData.liquidityHistory || [];
  if (history.length < 2) return false;
  const oldLiq = history[history.length - 2].value;
  const newLiq = history[history.length - 1].value;
  if (oldLiq === 0) return false;
  const dropPercent = ((oldLiq - newLiq) / oldLiq) * 100;
  return dropPercent > percentThreshold;
}

// ==================== QUALITY SCORING ====================

function calculateQualityScore(tokenData) {
  if (!tokenData) return 0;
  let score = 0;
  
  const vol = tokenData.volume24h || 0;
  if (vol > 50000) score += 30;
  else if (vol > 10000) score += 20;
  else if (vol > 5000) score += 15;
  else if (vol > 1000) score += 10;
  else if (vol > 500) score += 5;
  
  const liq = tokenData.liquidity || 0;
  if (liq > 20000) score += 25;
  else if (liq > 10000) score += 20;
  else if (liq > 5000) score += 15;
  else if (liq > 2000) score += 10;
  else score += 5;
  
  const holders = tokenData.holders || 0;
  if (holders > 500) score += 20;
  else if (holders > 200) score += 15;
  else if (holders > 100) score += 10;
  else if (holders > 50) score += 5;
  
  const mcap = tokenData.marketCap || 0;
  if (mcap > 100000 && mcap < 10000000) score += 15;
  else if (mcap > 50000) score += 10;
  else if (mcap > 10000) score += 5;
  
  const rugScore = tokenData.rugCheckScore || 100;
  if (rugScore < 30) score += 10;
  else if (rugScore < 50) score += 7;
  else if (rugScore < 70) score += 5;
  
  return score;
}

// ==================== MAIN CLEANUP FUNCTION ====================

async function cleanupWatchlist(state) {
  const now = Date.now();
  
  if (now - lastCleanupTime < MIN_CLEANUP_INTERVAL) {
    const timeSince = ((now - lastCleanupTime) / 1000).toFixed(0);
    console.log(`⏭️ Cleanup too soon, skipping (${timeSince}s since last)`);
    return;
  }
  
  if (state.watchlist.length < MIN_WATCHLIST_SIZE) {
    console.log(`⚠️ Watchlist too small (${state.watchlist.length}), skipping cleanup`);
    return;
  }
  
  console.log(`\n🧹 ===== v45 CLEANUP START =====`);
  console.log(`📊 Before: ${state.watchlist.length} tokens`);
  
  const removalReasons = { tooOld: 0, lowVolume: 0, flatPrice: 0, highRug: 0, lowHolders: 0, liquidityDrop: 0 };
  const addressesToRemove = [];
  
  // Iterate over watchlist array, check token data in prices object
  for (const address of state.watchlist) {
    const tokenData = state.prices[address];
    if (!tokenData) continue; // Skip if no price data
    
    let shouldRemove = false;
    let reason = "";
    
    if (isTokenTooOld(tokenData)) {
      shouldRemove = true; reason = "too old"; removalReasons.tooOld++;
    } else if (hasLowVolume(tokenData)) {
      shouldRemove = true; reason = "low volume"; removalReasons.lowVolume++;
    } else if (isPriceFlat(tokenData)) {
      shouldRemove = true; reason = "flat price"; removalReasons.flatPrice++;
    } else if (hasHighRugRisk(tokenData)) {
      shouldRemove = true; reason = "high rug"; removalReasons.highRug++;
    } else if (hasLowHolders(tokenData)) {
      shouldRemove = true; reason = "low holders"; removalReasons.lowHolders++;
    } else if (hasLiquidityDrop(tokenData)) {
      shouldRemove = true; reason = "liquidity drop"; removalReasons.liquidityDrop++;
    }
    
    if (shouldRemove) {
      const age = tokenData.discoveredAt ? ((now - tokenData.discoveredAt) / 60000).toFixed(0) : "?";
      addressesToRemove.push({ 
        address, 
        reason, 
        symbol: tokenData.symbol || address.slice(0,8),
        age,
        vol: tokenData.volume24h || 0
      });
    }
  }
  
  console.log(`📋 Tokens to remove: ${addressesToRemove.length}`);
  console.log(`Reasons: Old=${removalReasons.tooOld}, Vol=${removalReasons.lowVolume}, Flat=${removalReasons.flatPrice}, Rug=${removalReasons.highRug}, Holders=${removalReasons.lowHolders}, Liq=${removalReasons.liquidityDrop}`);
  
  if (DRY_RUN) {
    console.log(`\n🧪 [DRY-RUN] Would remove ${addressesToRemove.length} tokens:`);
    addressesToRemove.slice(0, 10).forEach(item => {
      console.log(`  ❌ ${item.symbol}: ${item.reason} (age: ${item.age}m, vol: $${item.vol.toFixed(0)})`);
    });
    if (addressesToRemove.length > 10) console.log(`  ... and ${addressesToRemove.length - 10} more`);
    console.log(`🧪 [DRY-RUN] Set DRY_RUN=false to execute removal`);
  } else {
    // Actually remove from BOTH watchlist array AND prices object
    for (const item of addressesToRemove) {
      const index = state.watchlist.indexOf(item.address);
      if (index > -1) state.watchlist.splice(index, 1);
      delete state.prices[item.address];
    }
    console.log(`✅ Removed ${addressesToRemove.length} tokens`);
  }
  
  console.log(`📊 After: ${state.watchlist.length} tokens`);
  
  if (state.watchlist.length > 150) {
    console.log(`\n⚠️ Still ${state.watchlist.length} > 150. Using quality scoring...`);
    await keepTopTokens(state, 150);
  }
  
  lastCleanupTime = now;
  console.log(`🧹 ===== CLEANUP COMPLETE =====\n`);
}

// ==================== KEEP TOP N BY QUALITY ====================

async function keepTopTokens(state, maxTokens) {
  if (state.watchlist.length <= maxTokens) return;
  
  console.log(`🎯 Scoring ${state.watchlist.length} tokens...`);
  
  const scored = state.watchlist.map(addr => {
    const tokenData = state.prices[addr];
    const score = tokenData ? calculateQualityScore(tokenData) : 0;
    return { address: addr, tokenData, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  const toKeep = scored.slice(0, maxTokens);
  const toRemove = scored.slice(maxTokens);
  
  console.log(`📈 Top 5:`);
  toKeep.slice(0, 5).forEach((item, i) => {
    const symbol = item.tokenData?.symbol || item.address.slice(0,8);
    console.log(`${i+1}. ${symbol} (score: ${item.score})`);
  });
  
  if (DRY_RUN) {
    console.log(`🧪 [DRY-RUN] Would remove ${toRemove.length} low-score tokens`);
  } else {
    for (const item of toRemove) {
      const index = state.watchlist.indexOf(item.address);
      if (index > -1) state.watchlist.splice(index, 1);
      delete state.prices[item.address];
    }
    console.log(`✅ Kept top ${toKeep.length} by quality`);
  }
}

console.log("✅ v45 Cleanup System Loaded (DRY_RUN=" + DRY_RUN + ")");

