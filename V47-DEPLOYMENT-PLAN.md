# V47 DEPLOYMENT PLAN - TOMORROW (BESOK LIBUR)

## Prerequisites: ✅ READY
- [x] Code complete (1841 lines)
- [x] Unit tests passed (5/5)
- [x] Git committed (v47-rebuild branch)
- [x] GitHub backup (pushed)
- [x] Rollback plan documented

## TOMORROW MORNING CHECKLIST:

### Phase 6.4: Dry Run (30 minutes)
```bash
cd ~/gmgn-alert-bot-repo
git checkout v47-rebuild

# Test start without systemd
node index.js 2>&1 | tee /tmp/v47-dryrun.log
# Watch for 5 minutes
# Ctrl+C to stop

# Check logs:
grep -i "error\|fail\|crash" /tmp/v47-dryrun.log
# Expected: No critical errors
# Expected: Discovery working
# Expected: Rate limiting logs visible
```

**Success Criteria:**
- No crashes for 5 minutes ✅
- Discovery systems start ✅
- No immediate errors ✅

### Phase 7: Production Deploy (45 minutes)

**Step 7.1: Backup Current State**
```bash
cd ~/gmgn-alert-bot-repo
systemctl --user stop eyescan2-bot
cp state.json state.json.pre-v47-deploy
```

**Step 7.2: Merge & Deploy**
```bash
git checkout main
git merge v47-rebuild --no-ff -m "v47: Merge rebuild (v38.1 base + rate limiting + preservation + age limit)"
git tag v47.0
git push origin main --tags

systemctl --user restart eyescan2-bot
```

**Step 7.3: Monitor (30 minutes)**
```bash
# Watch logs
journalctl --user -u eyescan2-bot -f

# Check for issues:
# - DexScreener 429 errors? (should be ZERO)
# - Watchlist growth rate? (should be stable)
# - Armed tokens? (should have age limit)
# - Telegram commands? (/status should work)
```

**Success Criteria:**
- ✅ Bot running (no crashes)
- ✅ No DexScreener 429 errors (30 min)
- ✅ Watchlist stable (not growing rapidly)
- ✅ Armed tokens <4h age only
- ✅ /status command working
- ✅ Memory <512 MB

### If SUCCESS:
```bash
echo "🎉 V47 DEPLOYED SUCCESSFULLY!"
rm state.json.v46.11.backup
# Monitor for 1 more hour, then done!
```

### If FAILURE:
```bash
cd ~/gmgn-alert-bot-repo
git checkout main
git reset --hard v46.11-final-before-v47
cp state.json.v46.11.backup state.json
systemctl --user restart eyescan2-bot
echo "⚠️ Rolled back to v46.11, investigate issues"
```

## Estimated Timeline:
- 08:00 - Dry run start
- 08:30 - Dry run analysis
- 09:00 - Deploy start
- 09:15 - Monitoring start  
- 09:45 - Success check
- 10:00 - Final verification
- **Total: 2 hours**

## Risk Level: LOW ✅
- Core fixes working (unit tests passed)
- Rollback ready (1 command)
- Backup available (state.json)
- Testing protocol complete

---
Ready untuk besok! 🚀
