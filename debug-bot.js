require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

console.log('🔍 Debug Bot Starting...');
const token = process.env.DISCORD_TOKEN;
console.log('Token exists:', !!token);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.on('ready', () => {
    console.log('✅ Debug Bot connected successfully!');
    console.log('Bot name:', client.user.tag);
});

client.on('messageCreate', (message) => {
    console.log(`\n📨 MESSAGE RECEIVED:`);
    console.log(`   Content: "${message.content}"`);
    console.log(`   Author: ${message.author.username}`);
    console.log(`   Channel: ${message.channel.name || 'DM'}`);
    console.log(`   Mentions bot: ${message.mentions.has(client.user)}`);
    console.log(`   Is bot: ${message.author.bot}`);
    
    if (message.mentions.has(client.user) && !message.author.bot) {
        console.log('🎯 BOT WAS MENTIONED!');
        
        const question = message.content.toLowerCase();
        console.log(`   Cleaned question: "${question}"`);
        
        // Test prediction detection
        const predictionKeywords = [
            'predict', 'prediction', 'forecast', 'future price', 'price prediction',
            'where will', 'what will', 'price target', 'where do you think',
            'lands by', 'reach by', 'will be', 'price will be',
            'will reach', 'going to be', 'expect', 'projection', 'estimate',
            'think', 'believe', 'guess', 'opinion', 'view'
        ];
        
        const hasKeyword = predictionKeywords.some(keyword => question.includes(keyword));
        const hasPricePattern = /\$\d+|\d+\$|price|sol|bitcoin|btc|ethereum|eth/i.test(question);
        const hasTimePattern = /2026|2025|2024|end of|by end|next year|future/i.test(question);
        
        console.log(`🔍 PREDICTION CHECK:`);
        console.log(`   Keywords: ${hasKeyword}`);
        console.log(`   Price pattern: ${hasPricePattern}`);
        console.log(`   Time pattern: ${hasTimePattern}`);
        console.log(`   Should be prediction: ${hasKeyword || (hasPricePattern && hasTimePattern)}`);
        
        if (hasKeyword || (hasPricePattern && hasTimePattern)) {
            console.log('🔮 PREDICTION REQUEST DETECTED!');
            message.reply('🎯 PREDICTION DETECTED! This should trigger the prediction system.');
        } else {
            console.log('📊 REGULAR REQUEST');
            message.reply('📊 Regular request detected. This will go to normal analysis.');
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
