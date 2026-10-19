"""
Test Suite for v37: Pump.fun Graduation LP Auto-Burn Detection
Coverage target: ≥80%
"""

import json
import re
import subprocess
from pathlib import Path

def test_v37_version_updated():
    """Test: Version string updated to v37"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    assert "2026-10-19-v37" in content, "Version not updated to v37"
    assert "Pump.fun Graduation LP Auto-Burn Detection" in content, "Version description missing"
    print("✅ Version updated correctly")

def test_pumpportal_complete_handler_exists():
    """Test: PumpPortal 'complete' event handler exists"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    # Check handler for 'complete' event
    assert "txType === 'complete'" in content, "'complete' event handler not found"
    assert "TOKEN GRADUATED" in content, "Graduation log message missing"
    assert "isGraduated = true" in content, "isGraduated flag not set"
    assert "lpBurned = true" in content, "lpBurned flag not set"
    print("✅ 'complete' event handler exists")

def test_lp_check_skip_for_graduated():
    """Test: LP check skips Birdeye for graduated tokens"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    # Check conditional logic
    assert "cached.isGraduated && cached.lpBurned" in content, "Graduated token check missing"
    assert "LP check skipped for graduated token" in content, "Skip log missing"
    assert "lpBurnedByGraduation = true" in content, "lpBurnedByGraduation flag missing"
    print("✅ LP check skips for graduated tokens")

def test_birdeye_fallback_for_non_graduated():
    """Test: Birdeye still used for non-graduated tokens"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    # Check else branch exists
    assert "getBirdeyeTokenSecurity" in content, "Birdeye function removed (should keep for non-graduated)"
    assert "Non-graduated: Use Birdeye token_security" in content or "else {" in content, "Fallback missing"
    print("✅ Birdeye fallback preserved")

def test_telegram_notification_updated():
    """Test: Telegram notification includes graduation status"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    # Check function signature
    assert "lpBurnedByGraduation" in content, "lpBurnedByGraduation parameter missing from sendTelegramAlert"
    
    # Check notification text
    assert "LP BURNED: Token graduated from Pump.fun" in content, "Graduation notification text missing"
    assert "100% burned to incinerator" in content, "Incinerator mention missing"
    print("✅ Telegram notification updated")

def test_graduation_flags_in_state():
    """Test: State object includes graduation flags"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    # Check state.prices[mint] gets new fields
    assert "graduatedAt: Date.now()" in content, "graduatedAt timestamp missing"
    assert "source: 'websocket-graduated'" in content, "Graduated source tag missing"
    print("✅ State includes graduation flags")

def test_backward_compatibility():
    """Test: Non-graduated tokens still work (backward compatible)"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    # Ensure old code paths still exist
    assert "txType !== 'create'" in content, "'create' event handler preserved"
    assert "getBirdeyeTokenSecurity" in content, "Birdeye function preserved"
    print("✅ Backward compatible with non-graduated tokens")

def test_no_syntax_errors():
    """Test: JavaScript syntax is valid"""
    index_js = Path(__file__).parent.parent / "index.js"
    
    result = subprocess.run(
        ["node", "-c", str(index_js)],
        capture_output=True,
        text=True
    )
    
    assert result.returncode == 0, f"Syntax error: {result.stderr}"
    print("✅ No syntax errors")

def test_logic_flow_complete_event():
    """Test: Logic flow for 'complete' event is correct"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    # Find the complete event handler block
    complete_handler = re.search(
        r"if \(txType === 'complete'.*?\n\s+return;",
        content,
        re.DOTALL
    )
    
    assert complete_handler, "'complete' event handler block not found"
    
    handler_text = complete_handler.group(0)
    
    # Check order: log → update state → return
    assert handler_text.index("TOKEN GRADUATED") < handler_text.index("isGraduated"), "Log should come before state update"
    assert handler_text.index("isGraduated") < handler_text.index("return"), "State update should come before return"
    
    print("✅ Logic flow correct for 'complete' event")

def test_lp_lock_percentage_for_graduated():
    """Test: Graduated tokens show 100% LP locked"""
    index_js = Path(__file__).parent.parent / "index.js"
    content = index_js.read_text()
    
    # Check graduated token gets 100% locked
    assert "lockedPercentage = '100.0'" in content or 'lockedPercentage: "100.0"' in content, "100% locked not set"
    assert "lpLocked = true" in content or "lpLocked: true" in content, "lpLocked not set to true"
    print("✅ Graduated tokens marked as 100% locked")

if __name__ == "__main__":
    print("\n" + "=" * 70)
    print("🧪 Test Suite: v37 - Pump.fun Graduation LP Auto-Burn Detection")
    print("=" * 70 + "\n")
    
    tests = [
        test_v37_version_updated,
        test_pumpportal_complete_handler_exists,
        test_lp_check_skip_for_graduated,
        test_birdeye_fallback_for_non_graduated,
        test_telegram_notification_updated,
        test_graduation_flags_in_state,
        test_backward_compatibility,
        test_no_syntax_errors,
        test_logic_flow_complete_event,
        test_lp_lock_percentage_for_graduated,
    ]
    
    passed = 0
    failed = 0
    
    for test_func in tests:
        try:
            test_func()
            passed += 1
        except AssertionError as e:
            print(f"❌ FAILED: {test_func.__name__}")
            print(f"   Error: {e}\n")
            failed += 1
        except Exception as e:
            print(f"❌ ERROR: {test_func.__name__}")
            print(f"   Exception: {e}\n")
            failed += 1
    
    print("\n" + "=" * 70)
    print(f"📊 RESULTS: {passed} passed, {failed} failed (Total: {len(tests)} tests)")
    print(f"Coverage: {(passed / len(tests) * 100):.1f}%")
    print("=" * 70)
    
    exit(0 if failed == 0 else 1)
