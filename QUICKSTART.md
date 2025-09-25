# 🚀 Quick Start Guide

Get your Discord Mention Bot running in 5 minutes!

## Step 1: Get Your Tokens

### Discord Bot Token
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section
4. Click "Add Bot"
5. Copy the token

### OpenAI API Key
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new API key
3. Copy the key

## Step 2: Set Up the Bot

```bash
# Run the setup script
./setup.sh

# Edit the .env file with your tokens
nano .env
```

## Step 3: Test Everything

```bash
# Run the test script
npm test
```

## Step 4: Start the Bot

```bash
# Run the mention bot
npm run mention
```

## Step 5: Use the Bot

1. **Invite the bot to your server** (use the OAuth2 URL from Discord Developer Portal)
2. **Upload a document** to any channel
3. **Mention the bot** with `@BotName your question here`

## Example Usage

```
User: *uploads README.md*
Bot: 📄 Document Added: README.md

User: @BotName what are the main features?
Bot: 🤖 AI Assistant
Based on the README.md document, the main features are:
- Mention-based interaction
- Document feeding and learning
- AI-powered responses
- Channel-specific contexts
```

## Troubleshooting

### Bot not responding?
- Check if it's online in Discord
- Verify the bot has "Message Content Intent" enabled
- Make sure you're mentioning it correctly

### File upload not working?
- Ensure file is under 10MB
- Try a simple .txt file first
- Check bot permissions in the channel

### AI not working?
- Verify your OpenAI API key is correct
- Check your OpenAI account has credits
- Try the test script: `npm test`

## Need Help?

- Check `mention-bot-readme.md` for detailed documentation
- Run `npm test` to diagnose issues
- Make sure all environment variables are set correctly 