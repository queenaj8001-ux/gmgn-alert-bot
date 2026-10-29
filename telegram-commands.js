// ==================== TELEGRAM COMMAND HANDLER (Phase 1 + Phase 2) ====================
// Created: 2026-10-28 (Phase 1: /help, /status, /getconfig, /logs)
// Updated: 2026-10-29 (Added autocomplete via setMyCommands)
// Updated: 2026-10-29 (Phase 2: /setprice with atomic writes + reload)
// Safe: Atomic writes, backups, confirmation required, validation

const fs = require('fs');
const path = require('path');
const { validatePriceThreshold, previewConfigChange, getCurrentConfig } = require('./config-validator.js');
const { atomicWriteEnv, reloadConfigSafe, verifyUpdate, listBackups } = require('./config-writer.js');

// Authorization: Only Okta can use commands
const AUTHORIZED_USER_ID = parseInt(process.env.TELEGRAM_CHAT_ID || '0');

// Track last update_id to avoid processing same message twice
let lastUpdateId = 0;

// Bot stats for /status command
const botStats = {
  startTime: Date.now(),
  signalsSent: 0,
  commandsReceived: 0,
};

// Pending confirmations (user waiting for "yes/no" reply)
// Format: { userId: { type, data, expiresAt, messageId, waitingForValue } }
const pendingConfirmations = {};

// Processed callback query IDs (prevent duplicate processing)
const processedCallbacks = new Set();

// Command lock (prevent concurrent writes)
let commandLock = false;

// Command definitions for autocomplete
const COMMAND_LIST = [
  { command: 'help', description: 'Show available commands' },
  { command: 'status', description: 'Bot health & stats' },
  { command: 'getconfig', description: 'Show current config' },
  { command: 'logs', description: 'Show recent logs (default 20 lines)' },
  { command: 'setprice', description: 'Update price thresholds (tier value)' },
  { command: 'reload', description: 'Reload config from disk' },
  { command: 'undo', description: 'Rollback to previous backup' },
  // Phase 2 (coming soon):
  // { command: 'setfilter', description: 'Update filters' },
  // { command: 'restart', description: 'Restart bot' },
];

// Increment signal counter (call this in sendTelegramAlert)
function incrementSignalCount() {
  botStats.signalsSent++;
}

// Get Telegram updates (long polling)
async function getUpdates(botToken, offset = 0, timeout = 30) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=${timeout}`;
    const res = await fetch(url);
    if (!res.ok) return { ok: false, result: [] };
    return await res.json();
  } catch (err) {
    console.error('❌ getUpdates error:', err.message);
    return { ok: false, result: [] };
  }
}

// Send text reply
async function sendTelegramReply(botToken, chatId, text, replyToMessageId = null, keyboard = null) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_to_message_id: replyToMessageId,
    };
    
    // Add keyboard if provided
    if (keyboard) {
      body.reply_markup = keyboard;
    }
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error('❌ sendReply error:', err.message);
    return false;
  }
}

// Answer callback query (remove loading state from button)
async function answerCallbackQuery(botToken, callbackQueryId, text = null) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
    const body = {
      callback_query_id: callbackQueryId,
    };
    
    if (text) {
      body.text = text;
      body.show_alert = false; // Toast notification
    }
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.error('❌ answerCallbackQuery error:', err.message);
    return false;
  }
}

// Create inline keyboard for /setprice command
function createSetPriceKeyboard() {
  const currentConfig = getCurrentConfig();
  
  return {
    inline_keyboard: [
      [
        { 
          text: `💰 Tier 1 High ($${currentConfig.PRICE_HIGH || 'N/A'})`, 
          callback_data: 'sp_t1h' 
        },
        { 
          text: `📉 Tier 1 Low ($${currentConfig.PRICE_LOW || 'N/A'})`, 
          callback_data: 'sp_t1l' 
        },
      ],
      [
        { 
          text: `💵 Tier 2 High ($${currentConfig.PRICE_HIGH_2 || 'N/A'})`, 
          callback_data: 'sp_t2h' 
        },
        { 
          text: `📊 Tier 2 Low ($${currentConfig.PRICE_LOW_2 || 'N/A'})`, 
          callback_data: 'sp_t2l' 
        },
      ],
    ],
  };
}

// Create Yes/No confirmation keyboard
function createConfirmationKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Yes, Update!', callback_data: 'confirm_yes' },
        { text: '❌ Cancel', callback_data: 'confirm_no' },
      ],
    ],
  };
}

// Set bot commands for autocomplete (shows popup when user types "/")
async function setMyCommands(botToken) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/setMyCommands`;
    const body = {
      commands: COMMAND_LIST,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    
    if (json.ok) {
      console.log(`✅ Bot commands registered (${COMMAND_LIST.length} commands)`);
      return true;
    } else {
      console.error('❌ Failed to set commands:', json.description);
      return false;
    }
  } catch (err) {
    console.error('❌ setMyCommands error:', err.message);
    return false;
  }
}

// Command: /help
function commandHelp() {
  return `📚 <b>Eyescan2 Bot Commands (Phase 1)</b>

<b>Available Commands:</b>

📖 /help - Show this message
📊 /status - Bot health & stats
⚙️ /getconfig - Show current config
📜 /logs [lines] - Show recent logs (default 20)

<b>Config Management (Phase 2):</b>
💰 /setprice &lt;tier&gt; &lt;value&gt; - Update price threshold
🔄 /reload - Reload config without restart
↩️ /undo - Show backup info

<b>Authorization:</b> Only authorized users can use commands.

<b>Coming soon:</b>
/setfilter - Update filters
/restart - Restart bot

<i>Eyescan2 v38.1 - Real-time Solana token signals</i>`;
}

// Command: /status
function commandStatus(state) {
  const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
  const uptimeStr = formatUptime(uptime);
  const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
  
  const watchlistCount = state.watchlist ? state.watchlist.length : 0;
  const pricesTracked = state.prices ? Object.keys(state.prices).length : 0;
  const armed = state.watchlist ? state.watchlist.filter(addr => {
    const p = state.prices[addr];
    return p && (p.maxPrice >= parseFloat(process.env.PRICE_HIGH || 0) || 
                 p.maxPrice >= parseFloat(process.env.PRICE_HIGH_2 || 0));
  }).length : 0;

  return `📊 <b>Bot Status</b>

⏱️ <b>Uptime:</b> ${uptimeStr}
💾 <b>Memory:</b> ${memUsage} MB
📡 <b>Watchlist:</b> ${watchlistCount} tokens
📈 <b>Prices tracked:</b> ${pricesTracked}
🎯 <b>Armed tokens:</b> ${armed}
📤 <b>Signals sent:</b> ${botStats.signalsSent}
🤖 <b>Commands received:</b> ${botStats.commandsReceived}

✅ <b>Status:</b> Running normally`;
}

// Command: /getconfig
function commandGetConfig() {
  const config = {
    'Tier 1 High': process.env.PRICE_HIGH || 'N/A',
    'Tier 1 Low': process.env.PRICE_LOW || 'N/A',
    'Tier 2 High': process.env.PRICE_HIGH_2 || 'N/A',
    'Tier 2 Low': process.env.PRICE_LOW_2 || 'N/A',
    'Min Age': `${process.env.MIN_TOKEN_AGE_MINUTES || 'N/A'} min`,
    'Max Age': `${process.env.MAX_TOKEN_AGE_MINUTES || 'N/A'} min`,
    'Min Liquidity': `$${process.env.MIN_LIQUIDITY_FOR_SIGNAL_USD || 'N/A'}`,
    'Min Market Cap': `$${process.env.MIN_MARKET_CAP_USD || 'N/A'}`,
    'Min Volume 1h': `$${process.env.MIN_VOLUME_1H_USD || 'N/A'}`,
    'Check Interval': `${process.env.CHECK_INTERVAL_SECONDS || 'N/A'}s`,
  };

  let text = '⚙️ <b>Current Configuration</b>\n\n<b>Price Thresholds:</b>\n';
  text += `  Tier 1: ${config['Tier 1 High']} → ${config['Tier 1 Low']}\n`;
  text += `  Tier 2: ${config['Tier 2 High']} → ${config['Tier 2 Low']}\n\n`;
  text += '<b>Filters:</b>\n';
  text += `  Age: ${config['Min Age']} - ${config['Max Age']}\n`;
  text += `  Liquidity: ${config['Min Liquidity']}+\n`;
  text += `  Market Cap: ${config['Min Market Cap']}+\n`;
  text += `  Volume 1h: ${config['Min Volume 1h']}+\n\n`;
  text += '<b>Monitoring:</b>\n';
  text += `  Check interval: ${config['Check Interval']}`;

  return text;
}

// Command: /logs
function commandLogs(lines = 20) {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`journalctl --user -u eyescan2-bot -n ${lines} --no-pager`, { 
      encoding: 'utf8',
      maxBuffer: 50 * 1024,
    });
    
    // Truncate if too long (Telegram limit 4096 chars)
    let text = `📜 <b>Last ${lines} log lines:</b>\n\n<code>${output}</code>`;
    if (text.length > 4000) {
      text = text.substring(0, 3900) + '\n\n... (truncated)</code>';
    }
    return text;
  } catch (err) {
    return `❌ Error reading logs: ${err.message}`;
  }
}

// Command: /setprice <tier> <value>
// Example: /setprice tier1_high 0.0005
// OR: /setprice (shows keyboard)
async function commandSetPrice(userId, args) {
  // No args = show keyboard
  if (args.length === 0) {
    const keyboard = createSetPriceKeyboard();
    return {
      text: `⚙️ <b>Update Price Threshold</b>

<b>Current thresholds:</b>
• Tier 1: High → Low signal
• Tier 2: High → Low signal

<b>Select threshold to update:</b>`,
      keyboard,
    };
  }
  
  // Legacy mode: /setprice tier1_high 0.0005
  if (args.length !== 2) {
    return `❌ <b>Usage:</b> /setprice &lt;tier&gt; &lt;value&gt;

<b>Valid tiers:</b>
• tier1_high - Tier 1 high threshold
• tier1_low - Tier 1 low threshold
• tier2_high - Tier 2 high threshold
• tier2_low - Tier 2 low threshold

<b>Example:</b>
<code>/setprice tier1_high 0.0005</code>

<b>Or use /setprice without args for button interface.</b>`;
  }

  const tier = args[0].toLowerCase();
  const value = parseFloat(args[1]);

  // Validate tier name
  const validTiers = ['tier1_high', 'tier1_low', 'tier2_high', 'tier2_low'];
  if (!validTiers.includes(tier)) {
    return `❌ Invalid tier: ${args[0]}

<b>Valid tiers:</b> ${validTiers.join(', ')}`;
  }

  // Validate value is number
  if (isNaN(value)) {
    return `❌ Invalid value: ${args[1]} (must be a number)`;
  }

  // Get current config
  const currentConfig = getCurrentConfig();

  // Validate with config-validator
  const validation = validatePriceThreshold(tier, value, currentConfig);

  if (!validation.valid) {
    return `❌ <b>Validation failed:</b>

${validation.error}

<b>Current config:</b>
${validation.context || 'N/A'}`;
  }

  // Generate preview
  const preview = previewConfigChange('price', tier, value, currentConfig);

  // Store pending confirmation
  pendingConfirmations[userId] = {
    type: 'setprice',
    data: { tier, value },
    expiresAt: Date.now() + 60000, // 60s timeout
    preview,
  };

  const keyboard = createConfirmationKeyboard();

  return {
    text: `⚠️ <b>Confirm Price Update</b>

${preview}

<b>Click button to confirm or cancel:</b>`,
    keyboard,
  };
}

// Command: /reload
async function commandReload() {
  try {
    const result = reloadConfigSafe();
    
    if (result.success) {
      return `✅ <b>Config reloaded successfully!</b>

Method: ${result.method}
No restart needed.

Use /getconfig to verify.`;
    } else {
      return `❌ <b>Reload failed:</b> ${result.error}`;
    }
  } catch (err) {
    return `❌ <b>Reload error:</b> ${err.message}`;
  }
}

// Command: /undo
async function commandUndo() {
  try {
    const backups = listBackups();
    
    if (backups.length === 0) {
      return `❌ No backups available`;
    }
    
    const latest = backups[0];
    const age = Math.floor(latest.age / 1000);
    const ageStr = formatUptime(age);
    
    return `📦 <b>Latest Backup</b>

Created: ${ageStr} ago
Size: ${latest.size} bytes

<b>Available backups:</b> ${backups.length}

<i>To restore: Use /setprice to make a change, then undo if needed.</i>
<i>(Auto-rollback on failed reload)</i>`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

// Process confirmation reply (yes/no)
async function processConfirmation(userId, text) {
  const pending = pendingConfirmations[userId];
  
  if (!pending) {
    return null; // No pending confirmation
  }
  
  // Check expiration
  if (Date.now() > pending.expiresAt) {
    delete pendingConfirmations[userId];
    return `⏰ <b>Confirmation expired</b> (timeout after 60s)`;
  }
  
  const reply = text.toLowerCase().trim();
  
  // Cancel
  if (reply === 'no' || reply === 'cancel') {
    delete pendingConfirmations[userId];
    return `❌ <b>Cancelled</b> - No changes made`;
  }
  
  // Confirm
  if (reply === 'yes' || reply === 'confirm') {
    delete pendingConfirmations[userId];
    
    if (pending.type === 'setprice') {
      return await executeSetPrice(pending.data);
    }
    
    return `❌ Unknown confirmation type: ${pending.type}`;
  }
  
  // Invalid reply
  return `❓ Please reply "yes" to confirm or "no" to cancel`;
}

// Execute setprice after confirmation
async function executeSetPrice(data) {
  const { tier, value } = data;
  
  try {
    // Map tier to env var name
    const tierMap = {
      tier1_high: 'PRICE_HIGH',
      tier1_low: 'PRICE_LOW',
      tier2_high: 'PRICE_HIGH_2',
      tier2_low: 'PRICE_LOW_2',
    };
    
    const envKey = tierMap[tier];
    const oldValue = process.env[envKey];
    
    // Atomic write
    const writeResult = atomicWriteEnv({ [envKey]: String(value) });
    
    // Reload config
    const reloadResult = reloadConfigSafe();
    
    if (!reloadResult.success) {
      return `❌ <b>Reload failed!</b>

File written but reload error: ${reloadResult.error}

<b>Manual action needed:</b>
1. Check bot logs
2. Try /reload command
3. Or restart bot if needed

Backup: ${writeResult.backup}`;
    }
    
    // Verify update
    const verified = verifyUpdate(envKey, value);
    
    if (!verified) {
      // Verification failed = index.js has cached old values
      // Need restart to reload all cached constants
      console.log('⚠️ Verification failed, restarting bot to reload cached values...');
      
      // Schedule restart after reply sent
      setTimeout(() => {
        console.log('🔄 Restarting bot (config update requires restart)...');
        process.exit(0); // Systemd will restart us
      }, 2000);
      
      return `✅ <b>Price updated successfully!</b>

<b>Changed:</b> ${tier}
<b>Old:</b> $${oldValue}
<b>New:</b> $${value}

<b>Status:</b>
✅ File written (atomic)
✅ Config reloaded
⚠️ Bot restarting to apply changes...

<b>Backup:</b> ${path.basename(writeResult.backup)}

<i>Bot will restart in 2 seconds (downtime ~3s)</i>
Use /status to verify restart.`;
    }
    
    return `✅ <b>Price updated successfully!</b>

<b>Changed:</b> ${tier}
<b>Old:</b> $${oldValue}
<b>New:</b> $${value}

<b>Status:</b>
✅ File written (atomic)
✅ Config reloaded (no restart)
✅ Value verified

<b>Backup:</b> ${path.basename(writeResult.backup)}

Use /getconfig to verify all thresholds.`;
    
  } catch (err) {
    return `❌ <b>Execute failed:</b> ${err.message}

Check bot logs for details.`;
  }
}

// Format uptime
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  
  return parts.join(' ');
}

// Handle callback query (button clicks)
async function handleCallbackQuery(botToken, callbackQuery, state) {
  const queryId = callbackQuery.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  
  // Check if already processed (prevent duplicates)
  if (processedCallbacks.has(queryId)) {
    console.log(`⏩ Skipping duplicate callback: ${queryId}`);
    return;
  }
  processedCallbacks.add(queryId);
  
  // Cleanup old callback IDs (keep last 100)
  if (processedCallbacks.size > 100) {
    const arr = Array.from(processedCallbacks);
    processedCallbacks.clear();
    arr.slice(-50).forEach(id => processedCallbacks.add(id));
  }
  
  // Authorization check
  if (userId !== AUTHORIZED_USER_ID) {
    await answerCallbackQuery(botToken, queryId, '⛔ Unauthorized');
    console.log(`⛔ Unauthorized callback from user ${userId}`);
    return;
  }
  
  console.log(`🔘 Callback received: ${data} from user ${userId}`);
  
  try {
    // Parse callback data
    if (data.startsWith('sp_')) {
      // Setprice tier selection: sp_t1h, sp_t1l, sp_t2h, sp_t2l
      const tierMap = {
        sp_t1h: 'tier1_high',
        sp_t1l: 'tier1_low',
        sp_t2h: 'tier2_high',
        sp_t2l: 'tier2_low',
      };
      
      const tier = tierMap[data];
      if (!tier) {
        await answerCallbackQuery(botToken, queryId, '❌ Invalid tier');
        return;
      }
      
      const currentConfig = getCurrentConfig();
      const tierEnvMap = {
        tier1_high: 'PRICE_HIGH',
        tier1_low: 'PRICE_LOW',
        tier2_high: 'PRICE_HIGH_2',
        tier2_low: 'PRICE_LOW_2',
      };
      const envKey = tierEnvMap[tier];
      const currentValue = currentConfig[envKey];
      
      // Store "waiting for value" state
      pendingConfirmations[userId] = {
        type: 'setprice_waiting_value',
        data: { tier },
        expiresAt: Date.now() + 120000, // 2 min timeout
      };
      
      await answerCallbackQuery(botToken, queryId);
      await sendTelegramReply(
        botToken,
        chatId,
        `💰 <b>Update ${tier.replace('_', ' ')}</b>

<b>Current value:</b> $${currentValue}

<b>Enter new value:</b>
<i>Example: 0.0005</i>

<i>(Timeout in 2 minutes)</i>`,
        messageId
      );
      
    } else if (data === 'confirm_yes') {
      // Confirmation: Yes
      const pending = pendingConfirmations[userId];
      
      if (!pending) {
        await answerCallbackQuery(botToken, queryId, '❌ No pending action');
        return;
      }
      
      if (Date.now() > pending.expiresAt) {
        delete pendingConfirmations[userId];
        await answerCallbackQuery(botToken, queryId, '⏰ Expired');
        await sendTelegramReply(botToken, chatId, '⏰ <b>Confirmation expired</b>', messageId);
        return;
      }
      
      delete pendingConfirmations[userId];
      await answerCallbackQuery(botToken, queryId, '✅ Executing...');
      
      if (pending.type === 'setprice') {
        const result = await executeSetPrice(pending.data);
        await sendTelegramReply(botToken, chatId, result, messageId);
      }
      
    } else if (data === 'confirm_no') {
      // Confirmation: No
      delete pendingConfirmations[userId];
      await answerCallbackQuery(botToken, queryId, '❌ Cancelled');
      await sendTelegramReply(botToken, chatId, '❌ <b>Cancelled</b> - No changes made', messageId);
      
    } else {
      await answerCallbackQuery(botToken, queryId, '❓ Unknown action');
    }
    
  } catch (err) {
    console.error('❌ Callback handler error:', err);
    await answerCallbackQuery(botToken, queryId, '❌ Error');
    await sendTelegramReply(botToken, chatId, `❌ Error: ${err.message}`, messageId);
  }
}

// Process one command message
async function processCommand(botToken, msg, state) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || '';
  const messageId = msg.message_id;

  // Authorization check
  if (userId !== AUTHORIZED_USER_ID) {
    await sendTelegramReply(botToken, chatId, '⛔ Unauthorized. Contact @okta.', messageId);
    console.log(`⛔ Unauthorized command attempt from user ${userId}: ${text}`);
    return;
  }

  botStats.commandsReceived++;
  console.log(`🤖 Command received from ${userId}: ${text}`);

  try {
    const parts = text.split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    let reply = '';
    let keyboard = null;

    // First check if user is waiting to enter a value (after button click)
    const pending = pendingConfirmations[userId];
    if (pending && pending.type === 'setprice_waiting_value' && !text.startsWith('/')) {
      // User entered value after clicking tier button
      const value = parseFloat(text.trim());
      
      if (isNaN(value)) {
        await sendTelegramReply(botToken, chatId, `❌ Invalid number: ${text}\n\nPlease enter a valid number (e.g., 0.0005)`, messageId);
        return;
      }
      
      const { tier } = pending.data;
      
      // Validate
      const currentConfig = getCurrentConfig();
      const validation = validatePriceThreshold(tier, value, currentConfig);
      
      if (!validation.valid) {
        await sendTelegramReply(botToken, chatId, `❌ <b>Validation failed:</b>\n\n${validation.error}\n\n<b>Current config:</b>\n${validation.context || 'N/A'}`, messageId);
        return;
      }
      
      // Generate preview
      const preview = previewConfigChange('price', tier, value, currentConfig);
      
      // Update pending state to confirmation
      pendingConfirmations[userId] = {
        type: 'setprice',
        data: { tier, value },
        expiresAt: Date.now() + 60000, // 60s timeout
        preview,
      };
      
      keyboard = createConfirmationKeyboard();
      reply = `⚠️ <b>Confirm Price Update</b>\n\n${preview}\n\n<b>Click button to confirm or cancel:</b>`;
      
      await sendTelegramReply(botToken, chatId, reply, messageId, keyboard);
      console.log(`✅ Value validated, waiting for confirmation: ${tier} = ${value}`);
      return;
    }

    // Next check if this is a yes/no text confirmation (legacy mode)
    if (!text.startsWith('/')) {
      const confirmReply = await processConfirmation(userId, text);
      if (confirmReply) {
        await sendTelegramReply(botToken, chatId, confirmReply, messageId);
        console.log(`✅ Confirmation processed: ${text}`);
        return;
      }
    }

    // Check command lock (prevent concurrent writes)
    if (commandLock && ['/setprice', '/setfilter', '/restart'].includes(command)) {
      await sendTelegramReply(botToken, chatId, '⏳ Another command is running, please wait...', messageId);
      return;
    }

    switch (command) {
      case '/help':
      case '/start':
        reply = commandHelp();
        break;

      case '/status':
        reply = commandStatus(state);
        break;

      case '/getconfig':
        reply = commandGetConfig();
        break;

      case '/logs':
        const lines = parseInt(parts[1]) || 20;
        if (lines > 100) {
          reply = '❌ Max 100 lines allowed';
        } else {
          reply = commandLogs(lines);
        }
        break;

      case '/setprice':
        commandLock = true;
        try {
          const result = await commandSetPrice(userId, args);
          if (typeof result === 'object' && result.text) {
            // Result has keyboard
            reply = result.text;
            keyboard = result.keyboard;
          } else {
            reply = result;
          }
        } finally {
          commandLock = false;
        }
        break;

      case '/reload':
        reply = await commandReload();
        break;

      case '/undo':
        reply = await commandUndo();
        break;

      default:
        reply = `❌ Unknown command: ${command}\n\nUse /help to see available commands.`;
    }

    await sendTelegramReply(botToken, chatId, reply, messageId, keyboard);
    console.log(`✅ Command processed: ${command}`);

  } catch (err) {
    console.error(`❌ Command error:`, err);
    await sendTelegramReply(botToken, chatId, `❌ Error: ${err.message}`, messageId);
  }
}

// Main polling loop
async function startCommandListener(botToken, state) {
  console.log('🤖 Telegram command listener started (polling mode)');
  console.log(`✅ Authorized user ID: ${AUTHORIZED_USER_ID}`);
  
  // Register commands for autocomplete (non-blocking)
  setMyCommands(botToken).catch(err => {
    console.error('⚠️ Failed to register commands, but listener continues:', err.message);
  });
  
  let pollCount = 0;

  while (true) {
    try {
      pollCount++;
      if (pollCount % 10 === 1) {
        console.log(`🤖 Polling... (count: ${pollCount}, last update ID: ${lastUpdateId})`);
      }
      const data = await getUpdates(botToken, lastUpdateId + 1, 30);
      
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          
          // Handle callback query (button clicks)
          if (update.callback_query) {
            await handleCallbackQuery(botToken, update.callback_query, state);
          }
          
          // Handle text messages (commands)
          if (update.message && update.message.text && update.message.text.startsWith('/')) {
            await processCommand(botToken, update.message, state);
          }
          
          // Handle text messages (value input or confirmation)
          if (update.message && update.message.text && !update.message.text.startsWith('/')) {
            await processCommand(botToken, update.message, state);
          }
        }
      }
    } catch (err) {
      console.error('❌ Command listener error:', err.message);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s on error
    }
  }
}

module.exports = {
  startCommandListener,
  incrementSignalCount,
  botStats,
  setMyCommands,
};
