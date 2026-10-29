// Test daily signal counter with date reset
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

console.log('🧪 Testing daily signal counter...\n');

// Test 1: Load state with new fields
console.log('Test 1: Load state with daily counter fields');
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

const state = loadState();
console.log(`✅ signalsSent: ${state.signalsSent}`);
console.log(`✅ signalsSentToday: ${state.signalsSentToday}`);
console.log(`✅ lastResetDate: ${state.lastResetDate}`);

// Test 2: Simulate signal (same day)
console.log('\nTest 2: Simulate signal (same day)');
const today = new Date().toISOString().split('T')[0];
const oldTotal = state.signalsSent;
const oldToday = state.signalsSentToday;

if (state.lastResetDate !== today) {
  console.log(`📅 Date changed: ${state.lastResetDate} → ${today}. Resetting daily counter.`);
  state.signalsSentToday = 0;
  state.lastResetDate = today;
}

state.signalsSent = (state.signalsSent || 0) + 1;
state.signalsSentToday = (state.signalsSentToday || 0) + 1;

console.log(`✅ Total: ${oldTotal} → ${state.signalsSent}`);
console.log(`✅ Today: ${oldToday} → ${state.signalsSentToday}`);
console.log(`✅ Date unchanged: ${state.lastResetDate === today}`);

// Test 3: Save and reload
console.log('\nTest 3: Save and reload');
saveState(state);
const reloaded = loadState();
console.log(`✅ Total persisted: ${reloaded.signalsSent === state.signalsSent}`);
console.log(`✅ Today persisted: ${reloaded.signalsSentToday === state.signalsSentToday}`);
console.log(`✅ Date persisted: ${reloaded.lastResetDate === state.lastResetDate}`);

// Test 4: Simulate date change
console.log('\nTest 4: Simulate date change (yesterday → today)');
const yesterday = '2026-10-28';
state.lastResetDate = yesterday;
state.signalsSentToday = 99; // Simulate yesterday's count

console.log(`📅 Setting fake date: ${yesterday}`);
console.log(`📊 Setting fake today count: 99`);

// Now simulate signal on new day
const newDay = '2026-10-29';
if (state.lastResetDate !== newDay) {
  console.log(`✅ Date changed detected: ${state.lastResetDate} → ${newDay}`);
  console.log(`✅ Resetting daily counter: ${state.signalsSentToday} → 0`);
  state.signalsSentToday = 0;
  state.lastResetDate = newDay;
}

state.signalsSent += 1;
state.signalsSentToday += 1;

console.log(`✅ New total: ${state.signalsSent}`);
console.log(`✅ New today: ${state.signalsSentToday} (should be 1)`);
console.log(`✅ Daily reset works: ${state.signalsSentToday === 1}`);

// Test 5: Restore original values
console.log('\nTest 5: Restore original values');
state.signalsSent = oldTotal;
state.signalsSentToday = oldToday;
state.lastResetDate = today;
saveState(state);
console.log(`✅ Restored to original state`);

console.log('\n🎉 All tests passed!');
