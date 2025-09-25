require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions
    ]
});

client.on('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`🔍 Testing DM functionality...`);
    console.log(`📝 Send a DM to the bot to test`);
});

client.on('messageCreate', (message) => {
    console.log(`📨 MESSAGE RECEIVED:`);
    console.log(`   From: ${message.author.tag} (${message.author.id})`);
    console.log(`   Channel Type: ${message.channel.type} (${typeof message.channel.type})`);
    console.log(`   Channel ID: ${message.channel.id}`);
    console.log(`   Content: "${message.content}"`);
    console.log(`   Is Bot: ${message.author.bot}`);
    console.log(`   Channel Name: ${message.channel.name || 'DM'}`);
    console.log(`   Channel Recipient: ${message.channel.recipient ? message.channel.recipient.tag : 'N/A'}`);
    console.log(`---`);
    
    // If it's a DM, respond
    if (message.channel.type === 1 || message.channel.type === 3) {
        console.log(`💬 DM DETECTED! Responding...`);
        message.reply('✅ DM received! This is a test response.');
    }
});

client.login(process.env.DISCORD_TOKEN);
