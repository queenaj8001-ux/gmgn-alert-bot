async function checkPricesOnceInner() {
  if (state.watchlist.length === 0) {
    console.log('Watchlist masih kosong, tunggu refresh pertama selesai...');
    return;
  }
  
  const now = Date.now();
  
  // v45: Filter watchlist - only fetch expired cache entries (75s TTL)
  const addressesToFetch = state.watchlist.filter(addr => {
    const cached = priceCache.get(addr);
    if (!cached) return true; // Not in cache, fetch
    if (now - cached.timestamp > CACHE_TTL_MS) return true; // Expired, fetch
    return false; // Still valid, skip
  });
  
  const cachedCount = state.watchlist.length - addressesToFetch.length;
  console.log(`[v45 CACHE] Watchlist: ${state.watchlist.length} total, ${addressesToFetch.length} fetch, ${cachedCount} cached (75s TTL)`);
  
  // Fetch only expired/missing entries
  let jupiterPrices = {};
  if (addressesToFetch.length > 0) {
    console.log(`[v45] Fetching ${addressesToFetch.length} tokens from DexScreener...`);
    jupiterPrices = await fetchDexScreenerBatch(addressesToFetch);
    
    // Update cache with fresh data
    for (const addr of addressesToFetch) {
      if (jupiterPrices[addr]) {
        priceCache.set(addr, {
          data: jupiterPrices[addr],
          timestamp: now
        });
      }
    }
  }
  
  // Merge cached data for tokens not fetched
  for (const addr of state.watchlist) {
    if (!addressesToFetch.includes(addr)) {
      const cached = priceCache.get(addr);
      if (cached && cached.data) {
        jupiterPrices[addr] = cached.data;
      }
    }
  }
  
  console.log(`[v45] Processing ${Object.keys(jupiterPrices).length} tokens (fresh + cached)...`);
  
  // Update price tracking for each token
  for (const addr of state.watchlist) {
    const jupData = jupiterPrices[addr];
