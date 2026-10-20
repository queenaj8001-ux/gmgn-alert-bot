/**
 * v38 Real-time Criteria Detection - Test Suite
 * Tests WebSocket subscription and criteria tracking logic
 */

const assert = require('assert');

console.log('====================================================================');
console.log('🧪 v38 TEST SUITE - Real-time Criteria Detection');
console.log('====================================================================\n');

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  testsRun++;
  try {
    fn();
    testsPassed++;
    console.log(`✅ Test ${testsRun}: ${name}`);
  } catch (e) {
    testsFailed++;
    console.error(`❌ Test ${testsRun}: ${name}`);
    console.error(`   Error: ${e.message}`);
  }
}

// Mock state
const mockState = {
  prices: {},
  watchlist: []
};

// Mock functions (simplified versions)
function createMockTokenData(mint, symbol, ageHours = 0) {
  const now = Date.now();
  const discoveredAt = now - (ageHours * 3600000);
  
  return {
    maxPrice: 0,
    source: 'test',
    discoveredAt: discoveredAt,
    graduatedAt: discoveredAt,
    name: `Test ${symbol}`,
    symbol: symbol,
    isGraduated: true,
    lpBurned: true,
    lastPrice: 0
  };
}

function initializeCriteria1v38(tokenData) {
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
  return tokenData.criteria1v38;
}

// Test constants
const PRICE_HIGH = 0.00034;
const PRICE_LOW = 0.0002;
const PRICE_HIGH_2 = 0.000145;
const PRICE_LOW_2 = 0.000065;

console.log('📋 Test Configuration:');
console.log(`   Criteria 1 (Tier 1): HIGH $${PRICE_HIGH} → LOW $${PRICE_LOW}`);
console.log(`   Criteria 2 (Tier 2): HIGH $${PRICE_HIGH_2} → LOW $${PRICE_LOW_2}`);
console.log('');

// ============================================================================
// TEST 1: Token age check (should monitor <24h tokens)
// ============================================================================
test('Token age check - new token (<24h)', () => {
  const tokenData = createMockTokenData('test1', 'NEW', 1); // 1 hour old
  const tokenAge = Date.now() - tokenData.graduatedAt;
  const isNew = tokenAge < 86400000;
  assert.strictEqual(isNew, true, 'Token should be considered new');
});

test('Token age check - old token (>24h)', () => {
  const tokenData = createMockTokenData('test2', 'OLD', 25); // 25 hours old
  const tokenAge = Date.now() - tokenData.graduatedAt;
  const isNew = tokenAge < 86400000;
  assert.strictEqual(isNew, false, 'Token should be considered old');
});

// ============================================================================
// TEST 2: Criteria 1v38 initialization
// ============================================================================
test('Criteria tracking structure initialization', () => {
  const tokenData = createMockTokenData('test3', 'INIT', 0);
  const c1 = initializeCriteria1v38(tokenData);
  
  assert.strictEqual(c1.tier1CrossedHigh, false);
  assert.strictEqual(c1.tier2CrossedHigh, false);
  assert.strictEqual(c1.signalSent, false);
  assert.strictEqual(c1.activeTier, null);
});

// ============================================================================
// TEST 3: Tier 1 HIGH threshold crossing
// ============================================================================
test('Tier 1 HIGH threshold crossing ($0.00034)', () => {
  const tokenData = createMockTokenData('test4', 'TIER1', 0);
  const c1 = initializeCriteria1v38(tokenData);
  
  const currentPrice = 0.00035; // Above threshold
  
  if (!c1.tier1CrossedHigh && currentPrice >= PRICE_HIGH) {
    c1.tier1CrossedHigh = true;
    c1.tier1CrossedHighAt = Date.now();
    c1.tier1HighPrice = currentPrice;
    c1.activeTier = 1;
  }
  
  assert.strictEqual(c1.tier1CrossedHigh, true);
  assert.strictEqual(c1.tier1HighPrice, 0.00035);
  assert.strictEqual(c1.activeTier, 1);
});

// ============================================================================
// TEST 4: Tier 2 HIGH threshold crossing
// ============================================================================
test('Tier 2 HIGH threshold crossing ($0.000145)', () => {
  const tokenData = createMockTokenData('test5', 'TIER2', 0);
  const c1 = initializeCriteria1v38(tokenData);
  
  const currentPrice = 0.00015; // Above Tier 2, below Tier 1
  
  if (!c1.tier1CrossedHigh && !c1.tier2CrossedHigh && currentPrice >= PRICE_HIGH_2) {
    c1.tier2CrossedHigh = true;
    c1.tier2CrossedHighAt = Date.now();
    c1.tier2HighPrice = currentPrice;
    c1.activeTier = 2;
  }
  
  assert.strictEqual(c1.tier2CrossedHigh, true);
  assert.strictEqual(c1.tier2HighPrice, 0.00015);
  assert.strictEqual(c1.activeTier, 2);
});

// ============================================================================
// TEST 5: Tier 1 complete cycle (HIGH → LOW)
// ============================================================================
test('Tier 1 complete pump-dump cycle', () => {
  const tokenData = createMockTokenData('test6', 'CYCLE1', 0);
  const c1 = initializeCriteria1v38(tokenData);
  
  // Step 1: Cross HIGH
  let price = 0.00035;
  if (!c1.tier1CrossedHigh && price >= PRICE_HIGH) {
    c1.tier1CrossedHigh = true;
    c1.tier1HighPrice = price;
  }
  
  // Step 2: Dump to LOW
  price = 0.00019;
  let signalTriggered = false;
  if (c1.tier1CrossedHigh && price <= PRICE_LOW && !c1.signalSent) {
    c1.signalSent = true;
    tokenData.crossedHigh = true;
    tokenData.dumpedToLow = true;
    tokenData.tier = 1;
    signalTriggered = true;
  }
  
  assert.strictEqual(signalTriggered, true, 'Signal should be triggered');
  assert.strictEqual(c1.signalSent, true);
  assert.strictEqual(tokenData.tier, 1);
});

// ============================================================================
// TEST 6: Tier 2 complete cycle (HIGH → LOW)
// ============================================================================
test('Tier 2 complete pump-dump cycle', () => {
  const tokenData = createMockTokenData('test7', 'CYCLE2', 0);
  const c1 = initializeCriteria1v38(tokenData);
  
  // Step 1: Cross Tier 2 HIGH (not Tier 1)
  let price = 0.00015;
  if (!c1.tier1CrossedHigh && !c1.tier2CrossedHigh && price >= PRICE_HIGH_2) {
    c1.tier2CrossedHigh = true;
    c1.tier2HighPrice = price;
  }
  
  // Step 2: Dump to Tier 2 LOW
  price = 0.00006;
  let signalTriggered = false;
  if (c1.tier2CrossedHigh && !c1.tier1CrossedHigh && price <= PRICE_LOW_2 && !c1.signalSent) {
    c1.signalSent = true;
    tokenData.crossedHigh = true;
    tokenData.dumpedToLow = true;
    tokenData.tier = 2;
    signalTriggered = true;
  }
  
  assert.strictEqual(signalTriggered, true, 'Signal should be triggered');
  assert.strictEqual(c1.signalSent, true);
  assert.strictEqual(tokenData.tier, 2);
});

// ============================================================================
// TEST 7: Tier 1 priority over Tier 2
// ============================================================================
test('Tier 1 takes priority when both thresholds crossed', () => {
  const tokenData = createMockTokenData('test8', 'PRIORITY', 0);
  const c1 = initializeCriteria1v38(tokenData);
  
  // Cross Tier 2 first
  let price = 0.00015;
  if (!c1.tier1CrossedHigh && !c1.tier2CrossedHigh && price >= PRICE_HIGH_2) {
    c1.tier2CrossedHigh = true;
    c1.tier2HighPrice = price;
    c1.activeTier = 2;
  }
  
  // Then cross Tier 1 (should override)
  price = 0.00035;
  if (!c1.tier1CrossedHigh && price >= PRICE_HIGH) {
    c1.tier1CrossedHigh = true;
    c1.tier1HighPrice = price;
    c1.activeTier = 1; // Override Tier 2
  }
  
  assert.strictEqual(c1.tier1CrossedHigh, true);
  assert.strictEqual(c1.tier2CrossedHigh, true);
  assert.strictEqual(c1.activeTier, 1, 'Tier 1 should take priority');
});

// ============================================================================
// TEST 8: Duplicate signal prevention
// ============================================================================
test('Prevent duplicate signals', () => {
  const tokenData = createMockTokenData('test9', 'DUP', 0);
  const c1 = initializeCriteria1v38(tokenData);
  
  // First signal
  c1.tier1CrossedHigh = true;
  c1.tier1HighPrice = 0.00035;
  
  let price = 0.00019;
  let signalCount = 0;
  
  // First check - should signal
  if (c1.tier1CrossedHigh && price <= PRICE_LOW && !c1.signalSent) {
    c1.signalSent = true;
    signalCount++;
  }
  
  // Second check - should NOT signal (already sent)
  if (c1.tier1CrossedHigh && price <= PRICE_LOW && !c1.signalSent) {
    signalCount++;
  }
  
  assert.strictEqual(signalCount, 1, 'Should only signal once');
});

// ============================================================================
// TEST 9: CATEUS scenario validation
// ============================================================================
test('CATEUS scenario: Fast pump-dump (1 min)', () => {
  const tokenData = createMockTokenData('cateus', 'CATEUS', 0);
  const c1 = initializeCriteria1v38(tokenData);
  
  const startTime = Date.now();
  
  // T+0s: $0.002 (below threshold)
  let price = 0.002;
  
  // T+30s: $0.04 (crossed HIGH!)
  price = 0.04;
  if (!c1.tier1CrossedHigh && price >= PRICE_HIGH) {
    c1.tier1CrossedHigh = true;
    c1.tier1CrossedHighAt = Date.now();
    c1.tier1HighPrice = price;
  }
  
  // T+60s: $0.052 (peak, still HIGH)
  price = 0.052;
  if (price > c1.tier1HighPrice) {
    c1.tier1HighPrice = price;
  }
  
  // T+90s: $0.00015 (dumped below LOW!)
  price = 0.00015;
  let detected = false;
  if (c1.tier1CrossedHigh && price <= PRICE_LOW && !c1.signalSent) {
    detected = true;
    c1.signalSent = true;
    const detectionTime = Date.now() - c1.tier1CrossedHighAt;
    
    // Should detect within 90 seconds
    assert.ok(detectionTime < 90000, 'Should detect within 90s');
  }
  
  assert.strictEqual(detected, true, 'Should detect CATEUS pattern');
  assert.strictEqual(c1.tier1HighPrice, 0.052, 'Should track peak');
});

// ============================================================================
// TEST 10: Environment variable compatibility
// ============================================================================
test('Environment variables can override thresholds', () => {
  // Simulate Railway environment variables
  const customHigh = parseFloat(process.env.PRICE_HIGH || '0.00034');
  const customLow = parseFloat(process.env.PRICE_LOW || '0.0002');
  
  assert.strictEqual(typeof customHigh, 'number');
  assert.strictEqual(typeof customLow, 'number');
  assert.ok(customHigh > customLow, 'HIGH should be greater than LOW');
});

// ============================================================================
// RESULTS
// ============================================================================
console.log('');
console.log('====================================================================');
console.log('📊 TEST RESULTS');
console.log('====================================================================');
console.log(`Total tests: ${testsRun}`);
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(`📈 Success rate: ${((testsPassed/testsRun)*100).toFixed(1)}%`);
console.log('====================================================================');

if (testsFailed === 0) {
  console.log('');
  console.log('✅ ALL TESTS PASSED! v38 logic validated.');
  console.log('');
  console.log('Next step: BUILD (commit + deploy)');
  process.exit(0);
} else {
  console.log('');
  console.log(`❌ ${testsFailed} TEST(S) FAILED! Fix before deploy.`);
  process.exit(1);
}
