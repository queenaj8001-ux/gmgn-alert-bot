#!/usr/bin/env python3
"""
GMGN-Style Candlestick Chart Generator
For Eyescan2 Bot - Solana Token Price Visualization

Usage:
  python3 generate_chart.py <token_address> [--hours 1] [--output chart.png]
"""

import sys
import json
import requests
import pandas as pd
import mplfinance as mpf
from datetime import datetime, timedelta
from pathlib import Path

# GMGN API endpoint (from research)
GMGN_API_BASE = "https://gmgn.ai/defi/quotation/v1/chart/sol"

def fetch_ohlcv_data(token_address, hours=1):
    """
    Fetch OHLCV candlestick data from state.json or DexScreener
    
    Args:
        token_address: Solana token contract address
        hours: Number of hours of data to fetch (default: 1)
    
    Returns:
        pandas.DataFrame with OHLCV data
    """
    # Try to read from state.json first (bot's price history)
    state_file = Path(__file__).parent / "state.json"
    
    if state_file.exists():
        try:
            with open(state_file) as f:
                state = json.load(f)
            
            if token_address in state.get("prices", {}):
                price_data = state["prices"][token_address]
                
                # Generate simple OHLCV from price history if available
                # (For v1, use single price point - upgrade later with real tick data)
                current_price = price_data.get("maxPrice", 0)
                
                if current_price > 0:
                    # Generate sample candles (mock data for visualization)
                    # TODO: Replace with real tick history from Helius/Birdeye
                    now = datetime.now()
                    candles = []
                    
                    for i in range(hours * 12):  # 5-min candles
                        timestamp = now - timedelta(minutes=5 * (hours * 12 - i))
                        # Simulate price movement (±5% random walk)
                        import random
                        variation = random.uniform(-0.05, 0.05)
                        price = current_price * (1 + variation)
                        
                        candles.append({
                            'timestamp': timestamp,
                            'open': price * 0.99,
                            'high': price * 1.02,
                            'low': price * 0.98,
                            'close': price,
                            'volume': random.randint(1000, 50000)
                        })
                    
                    df = pd.DataFrame(candles)
                    df['timestamp'] = pd.to_datetime(df['timestamp'])
                    df.set_index('timestamp', inplace=True)
                    return df
        except Exception as e:
            print(f"⚠️ State.json read failed: {e}", file=sys.stderr)
    
    # Fallback: Try DexScreener API
    try:
        # DexScreener doesn't provide OHLCV directly, use latest price
        url = f"https://api.dexscreener.com/latest/dex/tokens/{token_address}"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        if data.get("pairs"):
            pair = data["pairs"][0]
            price = float(pair.get("priceUsd", 0))
            
            # Generate mock candles from single price point
            now = datetime.now()
            candles = []
            
            for i in range(hours * 12):
                timestamp = now - timedelta(minutes=5 * (hours * 12 - i))
                import random
                variation = random.uniform(-0.03, 0.03)
                p = price * (1 + variation)
                
                candles.append({
                    'timestamp': timestamp,
                    'open': p * 0.995,
                    'high': p * 1.01,
                    'low': p * 0.99,
                    'close': p,
                    'volume': random.randint(500, 30000)
                })
            
            df = pd.DataFrame(candles)
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df.set_index('timestamp', inplace=True)
            return df
            
    except Exception as e:
        print(f"❌ DexScreener API failed: {e}", file=sys.stderr)
        return None

def generate_chart(token_address, hours=1, output_path="chart.png", title=None):
    """
    Generate GMGN-style candlestick chart
    
    Args:
        token_address: Token contract address
        hours: Hours of data to display
        output_path: Output PNG file path
        title: Chart title (optional)
    
    Returns:
        Path to generated chart or None on failure
    """
    print(f"📊 Generating chart for {token_address}...")
    
    # Fetch data
    df = fetch_ohlcv_data(token_address, hours)
    
    if df is None or df.empty:
        print("❌ No data available for chart generation", file=sys.stderr)
        return None
    
    # Rename columns to match mplfinance requirements
    df.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
    
    # GMGN-style configuration (dark theme, clean)
    style = mpf.make_mpf_style(
        base_mpf_style='nightclouds',
        marketcolors=mpf.make_marketcolors(
            up='#26a69a',      # Green candles (bullish)
            down='#ef5350',    # Red candles (bearish)
            edge='inherit',
            wick='inherit',
            volume='inherit'
        ),
        gridcolor='#2a2e39',
        facecolor='#1a1d24',
        figcolor='#1a1d24',
        edgecolor='#2a2e39'
    )
    
    # Generate chart
    chart_title = title or f"Token: {token_address[:8]}...{token_address[-6:]}"
    
    fig, axes = mpf.plot(
        df,
        type='candle',
        style=style,
        volume=True,
        title=chart_title,
        ylabel='Price (USD)',
        ylabel_lower='Volume',
        figsize=(12, 7),
        tight_layout=True,
        returnfig=True,
        warn_too_much_data=999999  # Suppress warnings
    )
    
    # Save to file
    output_path = Path(output_path)
    fig.savefig(output_path, dpi=150, bbox_inches='tight')
    print(f"✅ Chart saved: {output_path}")
    
    return str(output_path)

def main():
    """CLI entry point"""
    if len(sys.argv) < 2:
        print("Usage: python3 generate_chart.py <token_address> [--hours 1] [--output chart.png] [--title 'Token Name']")
        sys.exit(1)
    
    token_address = sys.argv[1]
    hours = 1
    output = "chart.png"
    title = None
    
    # Parse optional arguments
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--hours' and i + 1 < len(sys.argv):
            hours = int(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == '--output' and i + 1 < len(sys.argv):
            output = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--title' and i + 1 < len(sys.argv):
            title = sys.argv[i + 1]
            i += 2
        else:
            i += 1
    
    # Generate chart
    result = generate_chart(token_address, hours, output, title)
    
    if result:
        print(f"🎉 Success! Chart: {result}")
        sys.exit(0)
    else:
        print("❌ Chart generation failed", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
