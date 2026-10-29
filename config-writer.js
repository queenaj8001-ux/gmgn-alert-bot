// ==================== CONFIG WRITER (Phase 2: Step 2) ====================
// Created: 2026-10-29
// Purpose: Safe atomic .env updates with backup + reload
// Safe: Atomic writes (temp → rename), auto-backup, verification

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_FILE = path.join(__dirname, '.env');
const BACKUP_DIR = path.join(__dirname, '.env-backups');
const MAX_BACKUPS = 5;

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Parse .env file content into object
 * @param {string} content - Raw .env file content
 * @returns {object} Parsed key-value pairs
 */
function parseEnv(content) {
  const env = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Parse KEY="VALUE" or KEY=VALUE
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=["']?([^"']*)["']?$/);
    if (match) {
      env[match[1]] = match[2];
    }
  }
  
  return env;
}

/**
 * Serialize object back to .env format
 * @param {object} env - Key-value pairs
 * @returns {string} .env file content
 */
function serializeEnv(env) {
  const lines = [];
  
  // Add header comment
  lines.push('# Eyescan2 v39 Environment Variables');
  lines.push(`# Last updated: ${new Date().toISOString()}`);
  lines.push('');
  
  // Sort keys for consistency
  const keys = Object.keys(env).sort();
  
  for (const key of keys) {
    const value = env[key];
    // Quote values that contain spaces or special chars
    if (value.includes(' ') || value.includes('#')) {
      lines.push(`${key}="${value}"`);
    } else {
      lines.push(`${key}="${value}"`);
    }
  }
  
  return lines.join('\n') + '\n';
}

/**
 * Create backup of current .env file
 * @returns {string} Backup file path
 */
function createBackup() {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error('.env file not found');
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `.env.backup-${timestamp}`);
  
  fs.copyFileSync(ENV_FILE, backupPath);
  console.log(`✅ Backup created: ${backupPath}`);
  
  // Cleanup old backups (keep last MAX_BACKUPS)
  cleanupOldBackups();
  
  return backupPath;
}

/**
 * Cleanup old backup files (keep last N)
 */
function cleanupOldBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;
  
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('.env.backup-'))
    .map(f => ({
      name: f,
      path: path.join(BACKUP_DIR, f),
      mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime); // Newest first
  
  // Delete old backups (keep last MAX_BACKUPS)
  for (let i = MAX_BACKUPS; i < files.length; i++) {
    fs.unlinkSync(files[i].path);
    console.log(`🗑️ Deleted old backup: ${files[i].name}`);
  }
}

/**
 * Atomically write updates to .env file
 * Pattern: write temp → fsync → rename (atomic!)
 * @param {object} updates - Key-value pairs to update
 * @returns {object} { backup, updated, verified }
 */
function atomicWriteEnv(updates) {
  // 1. Create backup FIRST
  const backup = createBackup();
  
  // 2. Read current .env
  const currentContent = fs.readFileSync(ENV_FILE, 'utf8');
  const env = parseEnv(currentContent);
  
  // 3. Apply updates
  Object.assign(env, updates);
  const newContent = serializeEnv(env);
  
  // 4. Write to temp file (ATOMIC WRITE START)
  const tempPath = `${ENV_FILE}.tmp-${crypto.randomUUID()}`;
  
  try {
    // Open with exclusive flag (wx = create only, fail if exists)
    const fd = fs.openSync(tempPath, 'wx', 0o600);
    
    // Write content
    fs.writeSync(fd, newContent, 0, 'utf8');
    
    // Force write to disk (survive crash/power loss!)
    fs.fsyncSync(fd);
    
    // Close file
    fs.closeSync(fd);
    
    // 5. Atomic rename (COMMIT POINT!)
    fs.renameSync(tempPath, ENV_FILE);
    
    console.log(`✅ Atomic write complete: ${Object.keys(updates).join(', ')}`);
    
    return {
      backup,
      updated: Object.keys(updates),
      tempPath, // For debugging
    };
    
  } catch (err) {
    // Cleanup temp file on error
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw err;
  }
}

/**
 * Reload .env into process.env without restart
 * Uses Node.js 20+ built-in API
 * @returns {object} { success, reloaded, errors }
 */
function reloadConfigSafe() {
  try {
    // Method 1: Node.js 20+ native (preferred)
    if (process.loadEnvFile) {
      process.loadEnvFile(ENV_FILE);
      console.log('✅ Config reloaded via process.loadEnvFile()');
      return { success: true, method: 'native', reloaded: true };
    }
    
    // Method 2: Manual parse (fallback for Node < 20)
    const content = fs.readFileSync(ENV_FILE, 'utf8');
    const env = parseEnv(content);
    
    // Update process.env
    Object.assign(process.env, env);
    
    console.log('✅ Config reloaded via manual parse');
    return { success: true, method: 'manual', reloaded: true };
    
  } catch (err) {
    console.error('❌ Config reload failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Verify that a config value was actually updated
 * @param {string} key - Environment variable name
 * @param {string} expectedValue - Expected new value
 * @returns {boolean} True if verified
 */
function verifyUpdate(key, expectedValue) {
  const actual = process.env[key];
  const expected = String(expectedValue);
  
  if (actual === expected) {
    console.log(`✅ Verified: ${key} = ${actual}`);
    return true;
  } else {
    console.error(`❌ Verification failed: ${key}`);
    console.error(`   Expected: ${expected}`);
    console.error(`   Actual: ${actual}`);
    return false;
  }
}

/**
 * Restore from backup file
 * @param {string} backupPath - Path to backup file
 * @returns {boolean} Success
 */
function restoreFromBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  
  // Use atomic write pattern for restore too
  const tempPath = `${ENV_FILE}.tmp-${crypto.randomUUID()}`;
  
  try {
    fs.copyFileSync(backupPath, tempPath);
    fs.renameSync(tempPath, ENV_FILE);
    
    console.log(`✅ Restored from backup: ${backupPath}`);
    
    // Reload after restore
    reloadConfigSafe();
    
    return true;
  } catch (err) {
    console.error('❌ Restore failed:', err.message);
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    return false;
  }
}

/**
 * List available backups
 * @returns {array} Backup file info
 */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('.env.backup-'))
    .map(f => {
      const fullPath = path.join(BACKUP_DIR, f);
      const stats = fs.statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        size: stats.size,
        mtime: stats.mtime,
        age: Date.now() - stats.mtime.getTime(),
      };
    })
    .sort((a, b) => b.mtime - a.mtime); // Newest first
}

module.exports = {
  atomicWriteEnv,
  reloadConfigSafe,
  verifyUpdate,
  createBackup,
  restoreFromBackup,
  listBackups,
  parseEnv,
  serializeEnv,
};
