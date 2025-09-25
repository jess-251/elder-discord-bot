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
        if (message.content.toLowerCase().includes('predict')) {
            console.log('🔮 Prediction request detected!');
            message.reply('SOL will reach $325-375 by end of 2026. Confidence: Medium.');
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
