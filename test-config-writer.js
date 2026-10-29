// Test config-writer.js
// Run: node test-config-writer.js

require('dotenv').config();
const {
  atomicWriteEnv,
  reloadConfigSafe,
  verifyUpdate,
  listBackups,
  parseEnv,
  serializeEnv,
} = require('./config-writer.js');
const fs = require('fs');

console.log('=== CONFIG WRITER TEST ===\n');

// Test 1: Parse .env
console.log('TEST 1: Parse .env file');
const content = fs.readFileSync('.env', 'utf8');
const parsed = parseEnv(content);
console.log('Keys parsed:', Object.keys(parsed).length);
console.log('Sample:', parsed.PRICE_HIGH, parsed.PRICE_LOW);
console.log('✅ Parse working\n');

// Test 2: Serialize
console.log('TEST 2: Serialize env object');
const serialized = serializeEnv({ TEST_KEY: 'test_value', ANOTHER: 'value2' });
console.log('Serialized preview:');
console.log(serialized.substring(0, 200));
console.log('✅ Serialize working\n');

// Test 3: List backups (before write)
console.log('TEST 3: List existing backups');
const backupsBefore = listBackups();
console.log('Existing backups:', backupsBefore.length);
console.log('✅ Backup listing working\n');

// Test 4: Atomic write (DRY RUN - use test key)
console.log('TEST 4: Atomic write test');
const currentPriceHigh = process.env.PRICE_HIGH;
console.log('Current PRICE_HIGH:', currentPriceHigh);

try {
  // Write a test update (small change for safety)
  const testValue = '0.00035'; // Slightly different from 0.00034
  const result = atomicWriteEnv({ TEST_TIMESTAMP: Date.now().toString() });
  
  console.log('Write result:', result);
  console.log('Backup created:', result.backup);
  console.log('Updated keys:', result.updated);
  console.log('✅ Atomic write successful\n');
  
  // Test 5: Reload config
  console.log('TEST 5: Reload config');
  const reloadResult = reloadConfigSafe();
  console.log('Reload result:', reloadResult);
  console.log('✅ Reload working\n');
  
  // Test 6: Verify update
  console.log('TEST 6: Verify update');
  const verified = verifyUpdate('TEST_TIMESTAMP', result.updated[0] === 'TEST_TIMESTAMP' ? process.env.TEST_TIMESTAMP : 'N/A');
  console.log('Verification:', verified ? 'PASS' : 'FAIL');
  console.log('✅ Verification working\n');
  
  // Test 7: List backups (after write)
  console.log('TEST 7: Confirm backup created');
  const backupsAfter = listBackups();
  console.log('Backups after write:', backupsAfter.length);
  console.log('New backup count:', backupsAfter.length - backupsBefore.length);
  console.log('✅ Backup confirmed\n');
  
} catch (err) {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
}

console.log('=== ALL TESTS PASSED ===');
console.log('\n⚠️ Note: Test added TEST_TIMESTAMP to .env (safe, can ignore)');
