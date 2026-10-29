# Eyescan2 Changelog

## v39 (2026-10-29) - Telegram Phase 2: Config Management

### 🎉 Major Features
- **Inline Keyboard UI** for all write commands
- **Phase 2 Telegram Commands**: /setprice, /setfilter with interactive buttons
- **Atomic Configuration Updates** with automatic backup system
- **Auto-restart on cache issue** for reliable config updates

### ✨ New Commands
- `/setprice` - Update price thresholds via inline keyboard (4 tiers)
- `/setfilter` - Update signal filters via inline keyboard (5 filters)
- `/reload` - Reload configuration without restart
- `/undo` - View backup history

### 🛡️ Safety Features
- Atomic file writes (temp → rename pattern, no corruption possible)
- Automatic backup before every write (keeps last 5)
- Validation before write (range checks, logic checks)
- Preview with percentage change before confirmation
- Auto-restart when verification fails (~10s downtime)
- Command lock (prevents concurrent writes)
- Authorization (user whitelist)

### 🎨 UX Improvements
- Interactive button interface (click > type)
- Multi-step conversation flow
- Yes/No confirmation buttons
- Real-time value display in buttons
- Timeout handling (2min for value, 60s for confirm)
- Duplicate callback prevention

### 📊 Technical Details
- **Files Added**: config-validator.js (334 lines), config-writer.js (242 lines)
- **Updated**: telegram-commands.js (~1200 lines total, +600 lines)
- **Total Code**: ~1800 lines Phase 2
- **Commands**: 8 total (4 read-only, 4 write)
- **Tests**: All passing (validation, atomic write, callback, integration)

### 🔧 Deployment
- Railway disabled (cost optimization)
- VPS Oracle Cloud primary bot
- Auto-restart timer: daily 00:00 UTC (07:00 WIB)

### 📝 Commits
- ac89147: feat(phase2): Add /setprice command with atomic writes
- 9e29e50: feat(phase2): Add inline keyboard UI for /setprice
- e42b714: fix(phase2): Auto-restart bot when verification fails
- fcf281b: feat(phase2): Add /setfilter command with inline keyboard
- 607e755: fix: Add missing validateFilter import

---

## v38.1 (2026-10-20) - Real-time Criteria Detection

### Features
- Real-time WebSocket monitoring for Criteria 1 detection
- Multi-Helius setup (3 API keys × 5 DEXs = 15 subscriptions)
- 0-3 second detection speed
- LP graduation check (Pump.fun graduated = auto-burned)
- GMGN-style candlestick charts
- DexScreener links in signals

### Filters
- Age: 4-120 minutes
- Liquidity: $2000+
- Market Cap: $10000+
- Volume 1h: $1000+
- RugCheck score < 50
- Bundle check (>65% = warning)

### Discovery Layers
1. Multi-Helius WebSocket: 0-3s
2. PumpPortal WebSocket: 0-10s (+ graduation detect)
3. Gecko: 30s
4. DexScreener: 10min
5. Birdeye: 45min

### Price Thresholds
- Tier 1: HIGH $0.00034 → LOW $0.0002
- Tier 2: HIGH $0.000145 → LOW $0.000065
