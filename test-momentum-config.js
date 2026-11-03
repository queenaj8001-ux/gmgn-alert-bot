// Test momentum config integration
const { validateFilter, getCurrentConfig } = require('./config-validator.js');

console.log('═══════════════════════════════════════════');
console.log('MOMENTUM CONFIG TEST');
console.log('═══════════════════════════════════════════\n');

let passed = 0;
let total = 0;

// Get current config
const currentConfig = getCurrentConfig();
console.log('Current MOMENTUM_RUGPULL_THRESHOLD:', currentConfig.MOMENTUM_RUGPULL_THRESHOLD || 'Not set (default -80)');
console.log('');

// Test 1: Valid momentum threshold -80%
total++;
console.log('Test 1: Valid threshold -80%');
const test1 = validateFilter('momentum_rugpull', -80, currentConfig);
if (test1.valid) {
  console.log('✅ PASS: -80% accepted');
  passed++;
} else {
  console.log('❌ FAIL:', test1.error);
}
console.log('');

// Test 2: Valid threshold -70% (stricter)
total++;
console.log('Test 2: Valid threshold -70% (stricter)');
const test2 = validateFilter('momentum_rugpull', -70, currentConfig);
if (test2.valid) {
  console.log('✅ PASS: -70% accepted');
  passed++;
} else {
  console.log('❌ FAIL:', test2.error);
}
console.log('');

// Test 3: Valid threshold -90% (looser)
total++;
console.log('Test 3: Valid threshold -90% (looser)');
const test3 = validateFilter('momentum_rugpull', -90, currentConfig);
if (test3.valid) {
  console.log('✅ PASS: -90% accepted');
  passed++;
} else {
  console.log('❌ FAIL:', test3.error);
}
console.log('');

// Test 4: Invalid - too loose -40%
total++;
console.log('Test 4: Invalid threshold -40% (too loose, should reject)');
const test4 = validateFilter('momentum_rugpull', -40, currentConfig);
if (!test4.valid) {
  console.log('✅ PASS: -40% rejected (too loose)');
  passed++;
} else {
  console.log('❌ FAIL: Should reject -40%');
}
console.log('');

// Test 5: Invalid - positive value
total++;
console.log('Test 5: Invalid positive +10% (should reject)');
const test5 = validateFilter('momentum_rugpull', 10, currentConfig);
if (!test5.valid) {
  console.log('✅ PASS: +10% rejected (must be negative)');
  passed++;
} else {
  console.log('❌ FAIL: Should reject positive value');
}
console.log('');

// Test 6: Boundary -99%
total++;
console.log('Test 6: Boundary test -99% (min allowed)');
const test6 = validateFilter('momentum_rugpull', -99, currentConfig);
if (test6.valid) {
  console.log('✅ PASS: -99% accepted');
  passed++;
} else {
  console.log('❌ FAIL:', test6.error);
}
console.log('');

// Test 7: Boundary -50%
total++;
console.log('Test 7: Boundary test -50% (max allowed)');
const test7 = validateFilter('momentum_rugpull', -50, currentConfig);
if (test7.valid) {
  console.log('✅ PASS: -50% accepted');
  passed++;
} else {
  console.log('❌ FAIL:', test7.error);
}
console.log('');

// Test 8: Invalid filter name
total++;
console.log('Test 8: Invalid filter name');
const test8 = validateFilter('momentum_invalid', -80, currentConfig);
if (!test8.valid) {
  console.log('✅ PASS: Invalid filter rejected');
  passed++;
} else {
  console.log('❌ FAIL: Should reject invalid filter name');
}
console.log('');

console.log('═══════════════════════════════════════════');
console.log(`RESULT: ${passed}/${total} tests passed`);
console.log('═══════════════════════════════════════════');

process.exit(passed === total ? 0 : 1);
