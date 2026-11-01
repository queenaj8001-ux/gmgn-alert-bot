// ==================== v45 MAIN CLEANUP FUNCTION ====================

const DRY_RUN = true; // Set false after verification ⚠️

// ==================== CLEANUP WATCHLIST ====================
async function cleanupWatchlist(state) {
  const now = Date.now();
  
  // Rate limiting: Don't cleanup too frequently
  if (now - lastCleanupTime < MIN_CLEANUP_INTERVAL) {
    const timeSince = ((now - lastCleanupTime) / 1000).toFixed(0);
    console.log(`⏭️ Cleanup too soon, skipping (${timeSince}s since last, need ${MIN_CLEANUP_INTERVAL/1000}s)`);
    return;
  }
  
  const watchlistEntries = Object.entries(state.watchlist || {});
  
  // Safety: Minimum watchlist size
  if (watchlistEntries.length < MIN_WATCHLIST_SIZE) {
    console.log(`⚠️ Watchlist too small (${watchlistEntries.length} < ${MIN_WATCHLIST_SIZE}), skipping cleanup`);
    return;
  }
  
  console.log(`\n🧹 ===== CLEANUP WATCHLIST START =====`);
  console.log(`📊 Before: ${watchlistEntries.length} tokens`);
  
  const removalReasons = {
    tooOld: 0,
    lowVolume: 0,
    flatPrice: 0,
    highRug: 0,
    lowHolders: 0,
    liquidityDrop: 0
  };
  
  const tokensToRemove = [];
  
  // ===== APPLY 6 CRITERIA =====
  for (const [address, token] of watchlistEntries) {
    // SAFETY: Never remove armed tokens
    if (state.armedTokens && state.armedTokens[address]) {
      console.log(`🔒 Protected: ${token.symbol || address.slice(0,8)} (armed token)`);
      continue;
    }
    
    let shouldRemove = false;
    let reason = "";
    
    // Criterion 1: Too old
    if (isTokenTooOld(token)) {
      shouldRemove = true;
      reason = "too old";
      removalReasons.tooOld++;
    }
    // Criterion 2: Low volume
    else if (hasLowVolume(token)) {
      shouldRemove = true;
      reason = "low volume";
      removalReasons.lowVolume++;
    }
    // Criterion 3: Price flat
    else if (isPriceFlat(token)) {
      shouldRemove = true;
      reason = "flat price";
      removalReasons.flatPrice++;
    }
    // Criterion 4: High rug risk
    else if (hasHighRugRisk(token)) {
      shouldRemove = true;
      reason = "high rug risk";
      removalReasons.highRug++;
    }
    // Criterion 5: Low holders
    else if (hasLowHolders(token)) {
      shouldRemove = true;
      reason = "low holders";
      removalReasons.lowHolders++;
    }
    // Criterion 6: Liquidity drop
    else if (hasLiquidityDrop(token)) {
      shouldRemove = true;
      reason = "liquidity drop";
      removalReasons.liquidityDrop++;
    }
    
    if (shouldRemove) {
      tokensToRemove.push({ address, token, reason });
    }
  }
  
  // ===== EXECUTE REMOVAL (or dry-run log) =====
  console.log(`\n📋 Tokens to remove: ${tokensToRemove.length}`);
  console.log(`Reasons: Old=${removalReasons.tooOld}, Vol=${removalReasons.lowVolume}, Flat=${removalReasons.flatPrice}, Rug=${removalReasons.highRug}, Holders=${removalReasons.lowHolders}, Liq=${removalReasons.liquidityDrop}`);
  
  if (DRY_RUN) {
    console.log(`\n🧪 [DRY-RUN] Would remove ${tokensToRemove.length} tokens:`);
    tokensToRemove.slice(0, 10).forEach(item => {
      const age = ((Date.now() - item.token.discoveredAt) / 60000).toFixed(0);
      console.log(`  ❌ ${item.token.symbol || item.address.slice(0,8)}: ${item.reason} (age: ${age}m, vol: $${(item.token.volume24h || 0).toFixed(0)}, liq: $${(item.token.liquidity || 0).toFixed(0)})`);
    });
    if (tokensToRemove.length > 10) {
      console.log(`  ... and ${tokensToRemove.length - 10} more`);
    }
    console.log(`🧪 [DRY-RUN] Set DRY_RUN=false to execute actual removal`);
  } else {
    // Actually remove tokens
    for (const item of tokensToRemove) {
      delete state.watchlist[item.address];
      if (state.prices && state.prices[item.address]) {
        delete state.prices[item.address];
      }
    }
    console.log(`✅ Removed ${tokensToRemove.length} tokens`);
  }
  
  const remainingCount = Object.keys(state.watchlist || {}).length;
  console.log(`📊 After: ${remainingCount} tokens`);
  
  // ===== IF STILL > 150, USE QUALITY SCORING =====
  if (remainingCount > 150) {
    console.log(`\n⚠️ Still ${remainingCount} tokens (target: 150). Using quality scoring...`);
    await keepTopTokens(state, 150);
  }
  
  lastCleanupTime = now;
  console.log(`🧹 ===== CLEANUP COMPLETE =====\n`);
}

// ==================== KEEP TOP N TOKENS BY QUALITY ====================
async function keepTopTokens(state, maxTokens) {
  const tokens = Object.entries(state.watchlist || {});
  
  // Skip if already under limit
  if (tokens.length <= maxTokens) {
    console.log(`✅ Already under limit (${tokens.length} <= ${maxTokens})`);
    return;
  }
  
  console.log(`\n🎯 Scoring ${tokens.length} tokens...`);
  
  // Calculate score for each token
  const scored = tokens.map(([addr, token]) => {
    // SAFETY: Armed tokens get max score (never removed)
    const isArmed = state.armedTokens && state.armedTokens[addr];
    const score = isArmed ? 9999 : calculateQualityScore(token);
    
    return {
      address: addr,
      token: token,
      score: score,
      armed: isArmed
    };
  });
  
  // Sort by score descending (highest first)
  scored.sort((a, b) => b.score - a.score);
  
  // Keep top N
  const toKeep = scored.slice(0, maxTokens);
  const toRemove = scored.slice(maxTokens);
  
  console.log(`\n📈 Top 5 quality tokens:`);
  for (let i = 0; i < 5 && i < toKeep.length; i++) {
    const item = toKeep[i];
    const armed = item.armed ? " 🔒" : "";
    console.log(`${i+1}. ${item.token.symbol || item.address.slice(0,8)}${armed} (score: ${item.score}) - Vol $${(item.token.volume24h || 0).toFixed(0)}, Liq $${(item.token.liquidity || 0).toFixed(0)}`);
  }
  
  if (DRY_RUN) {
    console.log(`\n🧪 [DRY-RUN] Would remove ${toRemove.length} low-score tokens`);
    toRemove.slice(0, 5).forEach((item, i) => {
      console.log(`  ❌ ${item.token.symbol || item.address.slice(0,8)}: Low score (${item.score})`);
    });
    console.log(`🧪 [DRY-RUN] Set DRY_RUN=false to execute`);
  } else {
    // Remove low-score tokens
    console.log(`\n🗑️ Removing ${toRemove.length} low-score tokens...`);
    for (const item of toRemove) {
      delete state.watchlist[item.address];
      if (state.prices && state.prices[item.address]) {
        delete state.prices[item.address];
      }
    }
    console.log(`✅ Kept top ${toKeep.length} tokens by quality score`);
  }
}

console.log("✅ v45 cleanup functions loaded");
