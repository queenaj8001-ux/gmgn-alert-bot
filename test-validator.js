// Test config-validator.js
// Run: node test-validator.js

require('dotenv').config();
const {
  validatePriceThreshold,
  validateFilter,
  previewConfigChange,
  getCurrentConfig,
} = require('./config-validator.js');

console.log('=== CONFIG VALIDATOR TEST ===\n');

const currentConfig = getCurrentConfig();
console.log('Current config loaded:', Object.keys(currentConfig).length, 'keys\n');

// Test 1: Valid price change
console.log('TEST 1: Valid price change');
let result = validatePriceThreshold('tier1_high', 0.0005, currentConfig);
console.log('Result:', result);
console.log('✅ Expected: valid\n');

// Test 2: Invalid price (too low)
console.log('TEST 2: Invalid price (too low)');
result = validatePriceThreshold('tier1_high', 0.000001, currentConfig);
console.log('Result:', result);
console.log('✅ Expected: invalid (too low)\n');

// Test 3: Logic error (high < low)
console.log('TEST 3: Logic error (tier1_high < tier1_low)');
result = validatePriceThreshold('tier1_high', 0.00015, currentConfig);
console.log('Result:', result);
console.log('✅ Expected: invalid (high < low)\n');

// Test 4: Valid filter
console.log('TEST 4: Valid filter (age_min)');
result = validateFilter('age_min', 5, currentConfig);
console.log('Result:', result);
console.log('✅ Expected: valid\n');

// Test 5: Invalid filter (out of range)
console.log('TEST 5: Invalid filter (age_min too high)');
result = validateFilter('age_min', 300, currentConfig);
console.log('Result:', result);
console.log('✅ Expected: invalid (too high)\n');

// Test 6: Preview change
console.log('TEST 6: Preview config change');
const preview = previewConfigChange('price', 'tier1_high', 0.0005, currentConfig);
console.log('Preview:\n' + preview.replace(/<[^>]*>/g, '')); // Strip HTML for terminal
console.log('✅ Expected: formatted preview\n');

console.log('=== ALL TESTS COMPLETE ===');
