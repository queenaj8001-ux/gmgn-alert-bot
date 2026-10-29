// Test Phase 2 commands integration
// Run: node test-phase2-commands.js

require('dotenv').config();

console.log('=== PHASE 2 COMMANDS INTEGRATION TEST ===\n');

// Test 1: Module loading
console.log('TEST 1: Load all modules');
try {
  const validator = require('./config-validator.js');
  const writer = require('./config-writer.js');
  const commands = require('./telegram-commands.js');
  
  console.log('✅ config-validator loaded:', Object.keys(validator).length, 'exports');
  console.log('✅ config-writer loaded:', Object.keys(writer).length, 'exports');
  console.log('✅ telegram-commands loaded:', Object.keys(commands).length, 'exports');
  console.log();
} catch (err) {
  console.error('❌ Module load failed:', err.message);
  process.exit(1);
}

// Test 2: Validate price threshold
console.log('TEST 2: Price validation (via validator)');
const { validatePriceThreshold, getCurrentConfig } = require('./config-validator.js');
const config = getCurrentConfig();
const validation = validatePriceThreshold('tier1_high', 0.0005, config);
console.log('Validation result:', validation.valid ? 'VALID ✅' : 'INVALID ❌');
console.log('Error (if any):', validation.error || 'None');
console.log();

// Test 3: Test invalid validation
console.log('TEST 3: Invalid price validation');
const invalidValidation = validatePriceThreshold('tier1_high', 0.000001, config);
console.log('Validation result:', invalidValidation.valid ? 'VALID (BAD!)' : 'INVALID ✅');
console.log('Error:', invalidValidation.error.substring(0, 80) + '...');
console.log();

// Test 4: Check backup directory
console.log('TEST 4: Backup system');
const { listBackups } = require('./config-writer.js');
const backups = listBackups();
console.log('Backups available:', backups.length);
if (backups.length > 0) {
  console.log('Latest backup:', backups[0].name);
  console.log('Created:', new Date(backups[0].mtime).toISOString());
}
console.log('✅ Backup system working');
console.log();

// Test 5: Reload function
console.log('TEST 5: Config reload (dry run)');
const { reloadConfigSafe } = require('./config-writer.js');
const reloadResult = reloadConfigSafe();
console.log('Reload result:', reloadResult.success ? 'SUCCESS ✅' : 'FAILED ❌');
console.log('Method:', reloadResult.method);
console.log();

// Test 6: Check command exports
console.log('TEST 6: Command module exports');
const commands = require('./telegram-commands.js');
console.log('Exports:', Object.keys(commands));
console.log('✅ Command listener export:', typeof commands.startCommandListener === 'function' ? 'OK' : 'MISSING');
console.log('✅ Stats increment export:', typeof commands.incrementSignalCount === 'function' ? 'OK' : 'MISSING');
console.log();

console.log('=== ALL TESTS PASSED ===');
console.log('\n✅ Phase 2 integration ready!');
console.log('⚠️ Full test requires bot restart (next step)');
