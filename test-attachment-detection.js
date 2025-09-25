require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

console.log('🔍 Testing Attachment Detection...');
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
    console.log('✅ Test Bot connected successfully!');
    console.log('Bot name:', client.user.tag);
});

client.on('messageCreate', async (message) => {
    console.log(`\n📨 MESSAGE RECEIVED:`);
    console.log(`   Content: "${message.content}"`);
    console.log(`   Author: ${message.author.username}`);
    console.log(`   Mentions bot: ${message.mentions.has(client.user)}`);
    console.log(`   Attachments: ${message.attachments.size}`);
    console.log(`   Is bot: ${message.author.bot}`);
    
    if (message.mentions.has(client.user) && !message.author.bot) {
        console.log('🎯 BOT WAS MENTIONED!');
        
        // Log all attachment details
        if (message.attachments.size > 0) {
            console.log('📎 ATTACHMENTS FOUND:');
            message.attachments.forEach((attachment, key) => {
                console.log(`   Key: ${key}`);
                console.log(`   Name: ${attachment.name}`);
                console.log(`   URL: ${attachment.url}`);
                console.log(`   Content Type: ${attachment.contentType}`);
                console.log(`   Size: ${attachment.size}`);
                console.log(`   ID: ${attachment.id}`);
            });
            
            const attachment = message.attachments.first();
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                console.log('🖼️ IMAGE DETECTED!');
                await message.reply(`✅ Image detected: ${attachment.name} (${attachment.contentType})`);
            } else {
                console.log('❌ NOT AN IMAGE');
                await message.reply(`❌ Not an image: ${attachment.name} (${attachment.contentType})`);
            }
        } else {
            console.log('❌ NO ATTACHMENTS');
            await message.reply('❌ No attachments found in your message.');
        }
    } else {
        console.log('❌ NOT MENTIONED OR IS BOT');
    }
    console.log('---');
});

client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
});

client.login(token).catch(error => {
    console.error('❌ Failed to connect to Discord:', error.message);
});
