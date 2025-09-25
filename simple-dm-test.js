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
    console.log(`📝 Send a DM to test`);
});

client.on('messageCreate', (message) => {
    console.log(`📨 MESSAGE RECEIVED:`);
    console.log(`   From: ${message.author.tag} (${message.author.id})`);
    console.log(`   Channel Type: ${message.channel.type} (${typeof message.channel.type})`);
    console.log(`   Channel ID: ${message.channel.id}`);
    console.log(`   Content: "${message.content}"`);
    console.log(`   Is Bot: ${message.author.bot}`);
    console.log(`   Mentions bot: ${message.mentions.users.has(client.user.id)}`);
    console.log(`   Is DM: ${message.channel.type === 1}`);
    console.log(`---`);
    
    // If it's a DM, respond
    if (message.channel.type === 1) {
        console.log(`💬 DM DETECTED! Responding...`);
        message.reply('✅ DM received! This is a test response.');
    }
    
    // If it's a mention, respond
    if (message.mentions.users.has(client.user.id)) {
        console.log(`🔔 MENTION DETECTED! Responding...`);
        message.reply('✅ Mention received! This is a test response.');
    }
});

client.login(process.env.DISCORD_TOKEN);
