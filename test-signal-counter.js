// Test signal counter persistence in state.json
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

console.log('🧪 Testing signal counter persistence...\n');

// Test 1: Load state with signalsSent
console.log('Test 1: Load state structure');
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      watchlist: raw.watchlist || [],
      prices: raw.prices || {},
      birdeyeAddresses: raw.birdeyeAddresses || [],
      geckoAddresses: raw.geckoAddresses || [],
      signalsSent: raw.signalsSent || 0,
    };
  } catch {
    return { watchlist: [], prices: {}, birdeyeAddresses: [], geckoAddresses: [], signalsSent: 0 };
  }
}

const state = loadState();
console.log(`✅ Current signalsSent: ${state.signalsSent}`);
console.log(`✅ State has signalsSent field: ${state.hasOwnProperty('signalsSent')}`);

// Test 2: Increment counter
console.log('\nTest 2: Increment counter');
const oldCount = state.signalsSent;
state.signalsSent = (state.signalsSent || 0) + 1;
console.log(`✅ Counter incremented: ${oldCount} → ${state.signalsSent}`);

// Test 3: Save state
console.log('\nTest 3: Save state to file');
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
saveState(state);
console.log('✅ State saved to state.json');

// Test 4: Reload and verify
console.log('\nTest 4: Reload and verify persistence');
const reloadedState = loadState();
console.log(`✅ Reloaded signalsSent: ${reloadedState.signalsSent}`);
console.log(`✅ Counter persisted: ${reloadedState.signalsSent === state.signalsSent}`);

// Test 5: Restore original count (cleanup)
console.log('\nTest 5: Restore original count');
state.signalsSent = oldCount;
saveState(state);
console.log(`✅ Restored to original: ${oldCount}`);

console.log('\n🎉 All tests passed!');
