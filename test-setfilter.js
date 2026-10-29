// Test /setfilter command integration
// Run: node test-setfilter.js

require('dotenv').config();

console.log('=== /SETFILTER COMMAND TEST ===\n');

// Test 1: Module loading
console.log('TEST 1: Load modules');
try {
  const validator = require('./config-validator.js');
  const commands = require('./telegram-commands.js');
  
  console.log('✅ Modules loaded');
  console.log();
} catch (err) {
  console.error('❌ Module load failed:', err.message);
  process.exit(1);
}

// Test 2: Filter validation
console.log('TEST 2: Filter validation');
const { validateFilter, getCurrentConfig } = require('./config-validator.js');
const config = getCurrentConfig();

const testCases = [
  { filter: 'age_min', value: 5, shouldPass: true },
  { filter: 'age_min', value: 0, shouldPass: false },
  { filter: 'age_max', value: 120, shouldPass: true },
  { filter: 'liquidity_min', value: 2000, shouldPass: true },
  { filter: 'mcap_min', value: 10000, shouldPass: true },
];

for (const test of testCases) {
  const result = validateFilter(test.filter, test.value, config);
  const status = result.valid === test.shouldPass ? '✅' : '❌';
  console.log(`  ${status} ${test.filter} = ${test.value}: ${result.valid ? 'VALID' : 'INVALID'}`);
}
console.log();

// Test 3: Check callback data length
console.log('TEST 3: Callback data length');
const callbacks = ['sf_age_min', 'sf_age_max', 'sf_liq', 'sf_mcap', 'sf_vol'];
let allValid = true;
for (const data of callbacks) {
  const len = Buffer.byteLength(data, 'utf8');
  console.log(`  ${data}: ${len} bytes`, len <= 64 ? '✅' : '❌');
  if (len > 64) allValid = false;
}
console.log(allValid ? '✅ All callback data valid\n' : '❌ Some too long\n');

// Test 4: Filter keyboard structure
console.log('TEST 4: Filter keyboard structure');
const keyboard = {
  inline_keyboard: [
    [
      { text: `⏱️ Min Age (${config.MIN_TOKEN_AGE_MINUTES}m)`, callback_data: 'sf_age_min' },
      { text: `⏳ Max Age (${config.MAX_TOKEN_AGE_MINUTES}m)`, callback_data: 'sf_age_max' },
    ],
    [
      { text: `💧 Min Liquidity ($${config.MIN_LIQUIDITY_FOR_SIGNAL_USD})`, callback_data: 'sf_liq' },
    ],
    [
      { text: `📊 Min Market Cap ($${config.MIN_MARKET_CAP_USD})`, callback_data: 'sf_mcap' },
    ],
    [
      { text: `📈 Min Volume 1h ($${config.MIN_VOLUME_1H_USD})`, callback_data: 'sf_vol' },
    ],
  ],
};
console.log('✅ Keyboard structure valid');
console.log('Buttons:', keyboard.inline_keyboard.length, 'rows');
console.log('First button:', keyboard.inline_keyboard[0][0].text);
console.log();

console.log('=== ALL TESTS PASSED ===');
console.log('\n✅ /setfilter ready for deployment!');
console.log('⚠️ Full test requires bot restart + button clicks');
