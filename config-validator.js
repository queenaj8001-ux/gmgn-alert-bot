// ==================== CONFIG VALIDATOR (Phase 2: Step 1) ====================
// Created: 2026-10-29
// Purpose: Validate config changes BEFORE writing (safety layer)
// Safe: Read-only, no writes, no side effects

// Validation rules for price thresholds
const PRICE_RULES = {
  min: 0.00001,  // Prevent spam (too low = every token triggers)
  max: 1.0,      // Realistic max for SOL memecoins
};

// Validation rules for filters
const FILTER_RULES = {
  age_min: { min: 1, max: 60, unit: 'minutes' },
  age_max: { min: 10, max: 240, unit: 'minutes' },
  liquidity_min: { min: 100, max: 1000000, unit: 'USD' },
  market_cap_min: { min: 100, max: 10000000, unit: 'USD' },
  volume_1h_min: { min: 10, max: 100000, unit: 'USD' },
  check_interval: { min: 5, max: 120, unit: 'seconds' },
};

// Price tier names mapping
const PRICE_TIERS = {
  tier1_high: 'PRICE_HIGH',
  tier1_low: 'PRICE_LOW',
  tier2_high: 'PRICE_HIGH_2',
  tier2_low: 'PRICE_LOW_2',
};

// Filter names mapping
const FILTER_NAMES = {
  age_min: 'MIN_TOKEN_AGE_MINUTES',
  age_max: 'MAX_TOKEN_AGE_MINUTES',
  liquidity_min: 'MIN_LIQUIDITY_FOR_SIGNAL_USD',
  market_cap_min: 'MIN_MARKET_CAP_USD',
  volume_1h_min: 'MIN_VOLUME_1H_USD',
  check_interval: 'CHECK_INTERVAL_SECONDS',
};

/**
 * Validate price threshold value
 * @param {string} tier - tier1_high, tier1_low, tier2_high, tier2_low
 * @param {number} value - New price value
 * @param {object} currentConfig - Current config values for logic checks
 * @returns {object} { valid: boolean, error?: string, warnings?: string[] }
 */
function validatePriceThreshold(tier, value, currentConfig = {}) {
  // Check tier name valid
  if (!PRICE_TIERS[tier]) {
    return {
      valid: false,
      error: `Invalid tier name: ${tier}. Valid: tier1_high, tier1_low, tier2_high, tier2_low`,
    };
  }

  // Check value is number
  const numValue = parseFloat(value);
  if (isNaN(numValue)) {
    return {
      valid: false,
      error: `Value must be a number, got: ${value}`,
    };
  }

  // Check range
  if (numValue < PRICE_RULES.min) {
    return {
      valid: false,
      error: `Value ${numValue} too low! Min: ${PRICE_RULES.min} (prevents spam signals)`,
    };
  }

  if (numValue > PRICE_RULES.max) {
    return {
      valid: false,
      error: `Value ${numValue} too high! Max: ${PRICE_RULES.max} (unrealistic for memecoins)`,
    };
  }

  // Logic checks (high must be > low)
  const warnings = [];

  if (tier === 'tier1_high') {
    const tier1Low = parseFloat(currentConfig.PRICE_LOW || 0);
    if (tier1Low > 0 && numValue <= tier1Low) {
      return {
        valid: false,
        error: `tier1_high (${numValue}) must be > tier1_low (${tier1Low})`,
      };
    }
  }

  if (tier === 'tier1_low') {
    const tier1High = parseFloat(currentConfig.PRICE_HIGH || 999);
    if (tier1High < 999 && numValue >= tier1High) {
      return {
        valid: false,
        error: `tier1_low (${numValue}) must be < tier1_high (${tier1High})`,
      };
    }
  }

  if (tier === 'tier2_high') {
    const tier2Low = parseFloat(currentConfig.PRICE_LOW_2 || 0);
    const tier1High = parseFloat(currentConfig.PRICE_HIGH || 999);
    
    if (tier2Low > 0 && numValue <= tier2Low) {
      return {
        valid: false,
        error: `tier2_high (${numValue}) must be > tier2_low (${tier2Low})`,
      };
    }
    
    if (tier1High < 999 && numValue >= tier1High) {
      warnings.push(`⚠️ tier2_high (${numValue}) close to tier1_high (${tier1High}). Tier 2 should be lower than Tier 1.`);
    }
  }

  if (tier === 'tier2_low') {
    const tier2High = parseFloat(currentConfig.PRICE_HIGH_2 || 999);
    if (tier2High < 999 && numValue >= tier2High) {
      return {
        valid: false,
        error: `tier2_low (${numValue}) must be < tier2_high (${tier2High})`,
      };
    }
  }

  // Check if value change is significant (< 5% = maybe typo?)
  const envKey = PRICE_TIERS[tier];
  const currentValue = parseFloat(currentConfig[envKey] || 0);
  if (currentValue > 0) {
    const changePct = Math.abs((numValue - currentValue) / currentValue * 100);
    if (changePct < 5) {
      warnings.push(`⚠️ Small change (${changePct.toFixed(1)}%). Typo? Old: ${currentValue}, New: ${numValue}`);
    }
    if (changePct > 100) {
      warnings.push(`⚠️ Large change (${changePct.toFixed(0)}%)! Double-check value.`);
    }
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Validate filter value
 * @param {string} name - age_min, age_max, liquidity_min, etc
 * @param {number} value - New filter value
 * @param {object} currentConfig - Current config values for logic checks
 * @returns {object} { valid: boolean, error?: string, warnings?: string[] }
 */
function validateFilter(name, value, currentConfig = {}) {
  // Check filter name valid
  if (!FILTER_RULES[name]) {
    return {
      valid: false,
      error: `Invalid filter name: ${name}. Valid: ${Object.keys(FILTER_RULES).join(', ')}`,
    };
  }

  // Check value is number
  const numValue = parseFloat(value);
  if (isNaN(numValue)) {
    return {
      valid: false,
      error: `Value must be a number, got: ${value}`,
    };
  }

  const rules = FILTER_RULES[name];

  // Check range
  if (numValue < rules.min) {
    return {
      valid: false,
      error: `Value ${numValue} too low! Min: ${rules.min} ${rules.unit}`,
    };
  }

  if (numValue > rules.max) {
    return {
      valid: false,
      error: `Value ${numValue} too high! Max: ${rules.max} ${rules.unit}`,
    };
  }

  // Logic checks
  const warnings = [];

  if (name === 'age_min') {
    const ageMax = parseFloat(currentConfig.MAX_TOKEN_AGE_MINUTES || 999);
    if (ageMax < 999 && numValue >= ageMax) {
      return {
        valid: false,
        error: `age_min (${numValue}) must be < age_max (${ageMax})`,
      };
    }
  }

  if (name === 'age_max') {
    const ageMin = parseFloat(currentConfig.MIN_TOKEN_AGE_MINUTES || 0);
    if (ageMin > 0 && numValue <= ageMin) {
      return {
        valid: false,
        error: `age_max (${numValue}) must be > age_min (${ageMin})`,
      };
    }
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Preview config change (formatted for Telegram)
 * @param {string} type - 'price' or 'filter'
 * @param {string} name - tier1_high, age_min, etc
 * @param {number} newValue - New value
 * @param {object} currentConfig - Current config
 * @returns {string} Formatted preview text
 */
function previewConfigChange(type, name, newValue, currentConfig) {
  let envKey;
  let oldValue;
  let unit = '';

  if (type === 'price') {
    envKey = PRICE_TIERS[name];
    oldValue = currentConfig[envKey] || 'N/A';
    unit = '$';
  } else if (type === 'filter') {
    envKey = FILTER_NAMES[name];
    oldValue = currentConfig[envKey] || 'N/A';
    const rules = FILTER_RULES[name];
    if (rules) unit = ` ${rules.unit}`;
  }

  const changePct = oldValue !== 'N/A' && oldValue > 0
    ? ((newValue - parseFloat(oldValue)) / parseFloat(oldValue) * 100).toFixed(1)
    : null;

  let text = `📝 <b>Config Change Preview</b>\n\n`;
  text += `<b>Parameter:</b> ${name}\n`;
  text += `<b>Environment var:</b> ${envKey}\n\n`;
  text += `<b>Current:</b> ${unit}${oldValue}${unit ? '' : unit}\n`;
  text += `<b>New:</b> ${unit}${newValue}${unit ? '' : unit}\n`;
  
  if (changePct !== null) {
    const arrow = changePct > 0 ? '📈' : '📉';
    text += `<b>Change:</b> ${arrow} ${changePct}%\n`;
  }

  return text;
}

/**
 * Get current config from process.env (read-only)
 * @returns {object} Current config snapshot
 */
function getCurrentConfig() {
  return {
    PRICE_HIGH: process.env.PRICE_HIGH || '',
    PRICE_LOW: process.env.PRICE_LOW || '',
    PRICE_HIGH_2: process.env.PRICE_HIGH_2 || '',
    PRICE_LOW_2: process.env.PRICE_LOW_2 || '',
    MIN_TOKEN_AGE_MINUTES: process.env.MIN_TOKEN_AGE_MINUTES || '',
    MAX_TOKEN_AGE_MINUTES: process.env.MAX_TOKEN_AGE_MINUTES || '',
    MIN_LIQUIDITY_FOR_SIGNAL_USD: process.env.MIN_LIQUIDITY_FOR_SIGNAL_USD || '',
    MIN_MARKET_CAP_USD: process.env.MIN_MARKET_CAP_USD || '',
    MIN_VOLUME_1H_USD: process.env.MIN_VOLUME_1H_USD || '',
    CHECK_INTERVAL_SECONDS: process.env.CHECK_INTERVAL_SECONDS || '',
  };
}

module.exports = {
  validatePriceThreshold,
  validateFilter,
  previewConfigChange,
  getCurrentConfig,
  PRICE_TIERS,
  FILTER_NAMES,
};
