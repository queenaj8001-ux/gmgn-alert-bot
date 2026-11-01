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
  console.log(`[v45 STAGGERED] Watchlist: ${state.watchlist.length} total, ${addressesToFetch.length} fetch, ${cachedCount} cached`);
  
  // v45 STAGGERED: Split into 4 batches (50 tokens each) to avoid rate limit bursts
  const BATCH_SIZE = 50;
  const batches = [];
  for (let i = 0; i < addressesToFetch.length; i += BATCH_SIZE) {
    batches.push(addressesToFetch.slice(i, i + BATCH_SIZE));
  }
  
  console.log(`[v45 STAGGERED] Split into ${batches.length} batches of max ${BATCH_SIZE} tokens`);
  
  let jupiterPrices = {};
  
  // Fetch batches with 30s delay between each
  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    console.log(`[v45 STAGGERED] Fetching batch ${batchIdx + 1}/${batches.length} (${batch.length} tokens)...`);
    
    const batchResults = await fetchDexScreenerBatch(batch);
    
    // Merge batch results
    Object.assign(jupiterPrices, batchResults);
    
    // Update cache with fresh data
    for (const addr of batch) {
      if (batchResults[addr]) {
        priceCache.set(addr, {
          data: batchResults[addr],
          timestamp: now
        });
      }
    }
    
    // 30s delay between batches (except last batch)
    if (batchIdx < batches.length - 1) {
      console.log(`[v45 STAGGERED] Waiting 30s before next batch...`);
      await sleep(30000);
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
  
  console.log(`[v45 STAGGERED] Processing ${Object.keys(jupiterPrices).length} tokens (fresh + cached)...`);
  
  // Update price tracking for each token
  for (const addr of state.watchlist) {
    const jupData = jupiterPrices[addr];
