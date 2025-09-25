require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

console.log('Testing Discord connection...');
const token = process.env.DISCORD_TOKEN;
console.log('Token exists:', !!token);
console.log('Token length:', token ? token.length : 'undefined');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.on('ready', () => {
    console.log('✅ Bot connected successfully!');
    console.log('Bot name:', client.user.tag);
    console.log('Bot ID:', client.user.id);
});

client.on('messageCreate', (message) => {
    console.log(`📨 Message received: "${message.content}" from ${message.author.username}`);
    console.log(`📨 Channel: ${message.channel.name || 'DM'}`);
    console.log(`📨 Mentions bot: ${message.mentions.has(client.user)}`);
    console.log(`📨 Is bot: ${message.author.bot}`);
    
    if (message.mentions.has(client.user) && !message.author.bot) {
        console.log('🎯 Bot was mentioned!');
        const question = message.content.toLowerCase();
        
        // Check for prediction requests
        const predictionKeywords = [
            'predict', 'prediction', 'forecast', 'future price', 'price prediction',
            'where will', 'what will', 'price target', 'where do you think',
            'lands by', 'reach by', 'will be', 'price will be',
            'will reach', 'going to be', 'expect', 'projection', 'estimate'
        ];
        
        const hasKeyword = predictionKeywords.some(keyword => question.includes(keyword));
        console.log(`🔍 Prediction check: "${question}" -> Keywords: ${hasKeyword}`);
        
        if (hasKeyword) {
            console.log('🔮 Prediction request detected!');
            message.reply('Looking at this Solana (SOL) chart, I can see a strong uptrend that has taken the price from around $20 in early 2023 to current levels near $225. The chart shows significant volatility but an overall bullish trajectory, with notable consolidation periods followed by sharp moves higher.\n\nBased on the technical pattern visible here, I see a few key observations:\n\nStrong momentum: The trend has been decisively upward with higher highs and higher lows\nCurrent position: SOL appears to be consolidating near all-time highs around $225-240\nSupport levels: Strong support appears to exist around $180-200 based on recent price action\n\nFor a projection to end of 2026, several scenarios seem plausible:\n\nBullish case: If the current bull market continues and SOL maintains its momentum, breaking above the current resistance could lead to a measured move targeting $400-500 by end of 2026.\n\nBase case: Assuming normal market cycles with corrections and recoveries, SOL could reasonably trade in the $300-350 range by end of 2026.\n\nBearish case: If crypto markets face a significant downturn (as they historically do in cycles), SOL could revisit the $100-150 range before recovering.\n\nMy best estimate would be around $325-375 by end of 2026, assuming SOL continues to gain adoption and the broader crypto market follows historical patterns of growth with intermittent corrections. However, crypto predictions over such long timeframes are highly speculative and subject to numerous unpredictable factors including regulation, technological developments, and overall market conditions.\n\nMy price prediction is $325-375 by end of 2026.');
        } else {
            console.log('📊 Regular request');
            message.reply('Hello! I can analyze charts and make predictions. Try asking me to predict a price!');
        }
    }
    console.log('---');
});

client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
});

client.login(token).catch(error => {
    console.error('❌ Failed to connect to Discord:', error.message);
});
