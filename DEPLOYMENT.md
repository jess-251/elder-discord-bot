# 🥷 Elder Bot - Cloud Deployment Guide

## 🚀 Deploy to Railway (Recommended - Free)

### Step 1: Prepare Your Repository
1. Create a new repository on GitHub
2. Upload all your bot files to the repository
3. Make sure your `.env` file is NOT uploaded (it should be in `.gitignore`)

### Step 2: Deploy to Railway
1. Go to [Railway.app](https://railway.app)
2. Sign up with your GitHub account
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway will automatically detect it's a Node.js project

### Step 3: Set Environment Variables
In Railway dashboard:
1. Go to your project → Variables tab
2. Add these environment variables:
   - `DISCORD_TOKEN` = your Discord bot token
   - `OPENAI_API_KEY` = your OpenAI API key

### Step 4: Deploy
1. Railway will automatically build and deploy your bot
2. Check the logs to see if it starts successfully
3. Your bot will now run 24/7 in the cloud!

## 🔧 Alternative: Deploy to Heroku

### Step 1: Install Heroku CLI
```bash
# Install Heroku CLI from https://devcenter.heroku.com/articles/heroku-cli
```

### Step 2: Create Heroku App
```bash
heroku create your-bot-name
```

### Step 3: Set Environment Variables
```bash
heroku config:set DISCORD_TOKEN=your_discord_bot_token
heroku config:set OPENAI_API_KEY=your_openai_api_key
```

### Step 4: Deploy
```bash
git add .
git commit -m "Deploy bot to Heroku"
git push heroku main
```

## 📋 Required Files for Deployment
- ✅ `mention-bot.js` - Main bot file
- ✅ `package.json` - Dependencies
- ✅ `Procfile` - Tells cloud platform how to run the bot
- ✅ `railway.json` - Railway-specific configuration
- ✅ `env.example` - Example environment variables

## 🎯 After Deployment
Your bot will:
- ✅ Run 24/7 in the cloud
- ✅ Stay online even when your laptop is off
- ✅ Automatically restart if it crashes
- ✅ Handle real-time information requests
- ✅ Support document uploads and memory labels

## 🔍 Monitoring
- Railway: Check logs in the Railway dashboard
- Heroku: Use `heroku logs --tail` to see real-time logs

## 💡 Tips
- Keep your Discord token and OpenAI API key secure
- Monitor your usage to stay within free tier limits
- The bot will create its own SQLite database in the cloud
