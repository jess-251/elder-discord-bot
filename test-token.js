require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

console.log('Testing Discord connection...');
console.log('Token exists:', !!process.env.DISCORD_TOKEN);
console.log('Token length:', process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.length : 0);

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.on('ready', () => {
    console.log('✅ Bot connected successfully!');
    console.log(`Bot name: ${client.user.tag}`);
    process.exit(0);
});

client.on('error', (error) => {
    console.error('❌ Discord error:', error.message);
    process.exit(1);
});

console.log('Attempting to connect...');
client.login(process.env.DISCORD_TOKEN);
