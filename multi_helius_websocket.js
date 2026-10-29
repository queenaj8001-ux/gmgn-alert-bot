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
    let subscriptionIds = [];
    
    function connect() {
      ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        console.log(`✅ Helius WebSocket #${keyIndex + 1} connected`);
        
        // Subscribe to ALL DEX programs
        DEX_PROGRAMS.forEach((dex, dexIndex) => {
          const subscriptionId = keyIndex * 100 + dexIndex + 1; // Unique ID per connection
          
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
          
          subscriptionIds.push(subscriptionId);
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
            console.log(`📊 Source: Multi-DEX monitoring (5 programs)`);
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
          console.log(`⚠️ Helius WS #${keyIndex + 1} message parse error:`, e.message);
        }
      });
      
      ws.on('error', (err) => {
        console.log(`❌ Helius WebSocket #${keyIndex + 1} error: ${err.message}`);
      });
      
      ws.on('close', () => {
        console.log(`🔌 Helius WebSocket #${keyIndex + 1} closed, reconnecting in 5 seconds...`);
        reconnectTimeout = setTimeout(connect, 5000);
      });
    }
    
    // Start connection
    connect();
  });
  
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
  
  console.log(`🎯 Multi-Helius WebSocket system active:`);
  console.log(`   - ${HELIUS_KEYS.length} WebSocket connections (redundancy)`);
  console.log(`   - ${DEX_PROGRAMS.length} DEX programs monitored per connection`);
  console.log(`   - Total: ${HELIUS_KEYS.length * DEX_PROGRAMS.length} subscriptions`);
  console.log(`   - Expected detection: 0-3 seconds! ⚡\n`);
}
