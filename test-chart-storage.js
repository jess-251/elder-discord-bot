require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

console.log('🔍 Testing Chart Storage...');
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

// Store chart context
const chartContext = new Map();

client.on('ready', () => {
    console.log('✅ Test Bot connected successfully!');
    console.log('Bot name:', client.user.tag);
});

client.on('messageCreate', (message) => {
    console.log(`\n📨 MESSAGE RECEIVED:`);
    console.log(`   Content: "${message.content}"`);
    console.log(`   Author: ${message.author.username}`);
    console.log(`   Channel: ${message.channel.name || 'DM'}`);
    console.log(`   Channel ID: ${message.channel.id}`);
    console.log(`   Mentions bot: ${message.mentions.has(client.user)}`);
    console.log(`   Is bot: ${message.author.bot}`);
    console.log(`   Attachments: ${message.attachments.size}`);
    
    if (message.mentions.has(client.user) && !message.author.bot) {
        console.log('🎯 BOT WAS MENTIONED!');
        
        // Check for attachments
        if (message.attachments.size > 0) {
            console.log('📎 PROCESSING ATTACHMENTS...');
            for (const attachment of message.attachments.values()) {
                console.log(`   Attachment: ${attachment.name}`);
                console.log(`   Content Type: ${attachment.contentType}`);
                console.log(`   URL: ${attachment.url}`);
                
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    console.log('🖼️ IMAGE DETECTED - Would analyze and store');
                    
                    // Simulate storing chart context
                    const channelId = message.channel.id;
                    if (!chartContext.has(channelId)) {
                        chartContext.set(channelId, []);
                    }
                    
                    const charts = chartContext.get(channelId);
                    charts.push({
                        filename: attachment.name,
                        analysis: 'Test analysis for ' + attachment.name,
                        imageUrl: attachment.url,
                        timestamp: Date.now()
                    });
                    
                    console.log(`📊 Stored chart context for ${attachment.name} in channel ${channelId}`);
                    console.log(`📊 Charts in memory: ${charts.length}`);
                    
                    message.reply(`✅ Chart stored! I now have ${charts.length} chart(s) in memory for this channel.`);
                }
            }
        } else {
            // Check for prediction requests
            const question = message.content.toLowerCase();
            const predictionKeywords = ['predict', 'prediction', 'forecast', 'where will', 'what will'];
            const hasKeyword = predictionKeywords.some(keyword => question.includes(keyword));
            
            if (hasKeyword) {
                console.log('🔮 PREDICTION REQUEST DETECTED!');
                const channelId = message.channel.id;
                const charts = chartContext.get(channelId) || [];
                console.log(`📊 Charts in memory for channel ${channelId}: ${charts.length}`);
                
                if (charts.length === 0) {
                    message.reply('I don\'t have any charts in memory to make predictions about. Please upload a chart first, then ask me for predictions!');
                } else {
                    message.reply(`I have ${charts.length} chart(s) in memory. I can make predictions based on these charts!`);
                }
            } else {
                message.reply('Hello! Upload a chart and I\'ll store it, then ask me to predict!');
            }
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
