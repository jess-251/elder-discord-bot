#!/bin/bash

# Keep Discord Bot Online Script
# This script monitors the bot and restarts it if it goes offline

BOT_NAME="mention-bot-auto-save"
PROJECT_DIR="/Users/jess/Downloads/discord-ai"
LOG_FILE="$PROJECT_DIR/bot-monitor.log"

echo "🤖 Starting Discord Bot Monitor..." | tee -a "$LOG_FILE"
echo "📁 Project Directory: $PROJECT_DIR" | tee -a "$LOG_FILE"
echo "⏰ Started at: $(date)" | tee -a "$LOG_FILE"

cd "$PROJECT_DIR"

# Function to start the bot
start_bot() {
    echo "🚀 Starting bot..." | tee -a "$LOG_FILE"
    npm run auto-save >> "$LOG_FILE" 2>&1 &
    BOT_PID=$!
    echo "✅ Bot started with PID: $BOT_PID" | tee -a "$LOG_FILE"
}

# Function to check if bot is running
check_bot() {
    if ps -p $BOT_PID > /dev/null 2>&1; then
        return 0  # Bot is running
    else
        return 1  # Bot is not running
    fi
}

# Function to stop the bot
stop_bot() {
    echo "🛑 Stopping bot..." | tee -a "$LOG_FILE"
    pkill -f "$BOT_NAME" 2>/dev/null
    sleep 2
}

# Initial bot start
start_bot

# Main monitoring loop
while true; do
    if ! check_bot; then
        echo "❌ Bot is offline! Restarting..." | tee -a "$LOG_FILE"
        stop_bot
        sleep 5
        start_bot
        echo "🔄 Bot restarted at: $(date)" | tee -a "$LOG_FILE"
    fi
    
           # Check every 60 seconds (less aggressive)
           sleep 60
done
