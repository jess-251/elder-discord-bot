#!/bin/bash

echo "🤖 Discord Mention Bot (Free Version) Setup"
echo "==========================================="

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# Discord Bot Token (get from https://discord.com/developers/applications)
DISCORD_TOKEN=your_discord_bot_token_here

# No OpenAI API key needed for the free version!
EOF
    echo "✅ Created .env file"
    echo "⚠️  Please edit .env file with your Discord bot token!"
else
    echo "✅ .env file already exists"
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
else
    echo "✅ Dependencies already installed"
fi

echo ""
echo "🚀 Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your Discord bot token"
echo "2. Run the free bot with: npm run mention-free"
echo "3. Upload documents to Discord channels"
echo "4. Mention the bot with @BotName to ask questions"
echo ""
echo "💡 This version uses keyword-based search instead of AI"
echo "📖 For more info, see mention-bot-readme.md" 