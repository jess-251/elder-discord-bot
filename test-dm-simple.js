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
    console.log(`🔍 DM Test Bot Ready!`);
    console.log(`📝 Send a DM to test if the bot receives it`);
});

client.on('messageCreate', (message) => {
    console.log(`📨 MESSAGE RECEIVED:`);
    console.log(`   From: ${message.author.tag} (${message.author.id})`);
    console.log(`   Channel Type: ${message.channel.type} (${typeof message.channel.type})`);
    console.log(`   Channel ID: ${message.channel.id}`);
    console.log(`   Content: "${message.content}"`);
    console.log(`   Is Bot: ${message.author.bot}`);
    console.log(`   Is DM: ${message.channel.type === 1}`);
    console.log(`---`);
    
    // Respond to DMs
    if (message.channel.type === 1 && !message.author.bot) {
        console.log(`💬 DM DETECTED! Responding...`);
        message.reply('✅ DM received! This is a test response.');
    }
    
    // Respond to mentions
    if (message.mentions.users.has(client.user.id) && !message.author.bot) {
        console.log(`🎯 MENTION DETECTED! Responding...`);
        message.reply('✅ Mention received! This is a test response.');
    }
});

client.login(process.env.DISCORD_TOKEN);
