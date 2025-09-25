require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.on('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`🔍 TEST MODE: Will respond to ANY message`);
});

client.on('messageCreate', async (message) => {
    console.log(`📨 MESSAGE RECEIVED:`);
    console.log(`   From: ${message.author.tag}`);
    console.log(`   Channel: ${message.channel.type} - ${message.channel.name || 'DM'}`);
    console.log(`   Content: "${message.content}"`);
    console.log(`   Is bot: ${message.author.bot}`);
    console.log(`---`);

    // Ignore bot messages
    if (message.author.bot) return;

    // Respond to any message
    try {
        await message.reply(`🤖 Test response! I received your message: "${message.content}"`);
        console.log(`✅ Response sent successfully`);
    } catch (error) {
        console.error(`❌ Error sending response:`, error);
    }
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

client.login(process.env.DISCORD_TOKEN).catch(console.error); 