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

client.on('ready', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`🔍 Testing DM send functionality...`);
    
    try {
        // Try to send a DM to you (using your user ID from earlier logs)
        const user = await client.users.fetch('748560146556518533');
        const dmChannel = await user.createDM();
        await dmChannel.send('🤖 Hi! This is a test DM from your AI bot. Can you respond to this?');
        console.log('✅ Test DM sent! Please respond to it.');
    } catch (error) {
        console.error('❌ Failed to send DM:', error);
    }
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
});

client.login(process.env.DISCORD_TOKEN);
