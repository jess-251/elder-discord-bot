#!/bin/bash

echo "🤖 Discord Mention Bot Setup"
echo "============================"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# Discord Bot Token (get from https://discord.com/developers/applications)
DISCORD_TOKEN=your_discord_bot_token_here

# OpenAI API Key (get from https://platform.openai.com/api-keys)
OPENAI_API_KEY=your_openai_api_key_here
EOF
    echo "✅ Created .env file"
    echo "⚠️  Please edit .env file with your actual tokens!"
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
echo "1. Edit .env file with your Discord bot token and OpenAI API key"
echo "2. Run the bot with: npm run mention"
echo "3. Upload documents to Discord channels"
echo "4. Mention the bot with @BotName to ask questions"
echo ""
echo "📖 For more info, see mention-bot-readme.md" 