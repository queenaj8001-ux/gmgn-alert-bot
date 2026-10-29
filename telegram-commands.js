// ==================== TELEGRAM COMMAND HANDLER (Phase 1: Read-Only) ====================
// Created: 2026-10-28 (Phase 1: /help, /status, /getconfig, /logs)
// Updated: 2026-10-29 (Added autocomplete via setMyCommands)
// Safe: No writes to config, no restarts

const fs = require('fs');
const path = require('path');

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

// Command definitions for autocomplete
const COMMAND_LIST = [
  { command: 'help', description: 'Show available commands' },
  { command: 'status', description: 'Bot health & stats' },
  { command: 'getconfig', description: 'Show current config' },
  { command: 'logs', description: 'Show recent logs (default 20 lines)' },
  // Phase 2 (not yet active, but shown for future use):
  // { command: 'setprice', description: 'Update price thresholds' },
  // { command: 'setfilter', description: 'Update filters' },
  // { command: 'restart', description: 'Restart bot' },
  // { command: 'reload', description: 'Reload config from disk' },
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
async function sendTelegramReply(botToken, chatId, text, replyToMessageId = null) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_to_message_id: replyToMessageId,
    };
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

/help - Show this message
/status - Bot health & stats
/getconfig - Show current config
/logs [lines] - Show recent logs (default 20)

<b>Authorization:</b> Only authorized users can use commands.

<b>Phase 2 (Coming soon):</b>
/setprice - Update price thresholds
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

    let reply = '';

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

      default:
        reply = `❌ Unknown command: ${command}\n\nUse /help to see available commands.`;
    }

    await sendTelegramReply(botToken, chatId, reply, messageId);
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
          
          if (update.message && update.message.text && update.message.text.startsWith('/')) {
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
