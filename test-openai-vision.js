require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');

console.log('🔍 Testing OpenAI Vision API...');
const token = process.env.DISCORD_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;

console.log('Token exists:', !!token);
console.log('OpenAI key exists:', !!openaiKey);
console.log('OpenAI key length:', openaiKey ? openaiKey.length : 'undefined');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

const openai = new OpenAI({
    apiKey: openaiKey
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
    
    if (message.mentions.has(client.user) && !message.author.bot) {
        console.log('🎯 BOT WAS MENTIONED!');
        
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            console.log(`📎 Attachment: ${attachment.name} (${attachment.contentType})`);
            console.log(`📎 URL: ${attachment.url}`);
            
            if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                console.log('🖼️ IMAGE DETECTED - Testing OpenAI Vision...');
                
                try {
                    console.log('🔮 Calling OpenAI Vision API...');
                    
                    const response = await openai.chat.completions.create({
                        model: "gpt-4o",
                        messages: [
                            {
                                role: "user",
                                content: [
                                    {
                                        type: "text",
                                        text: "Analyze this chart and give a price prediction for SOL by end of 2026. End with 'My price prediction is $XXX-XXX by end of 2026'."
                                    },
                                    {
                                        type: "image_url",
                                        image_url: {
                                            url: attachment.url
                                        }
                                    }
                                ]
                            }
                        ],
                        max_tokens: 1000
                    });
                    
                    console.log('✅ OpenAI Vision API call successful!');
                    const analysis = response.choices[0].message.content;
                    console.log(`✅ Analysis received (${analysis.length} characters)`);
                    console.log(`✅ First 200 chars: ${analysis.substring(0, 200)}...`);
                    
                    await message.reply(analysis);
                    
                } catch (openaiError) {
                    console.error('❌ OpenAI Vision API Error:');
                    console.error('   Error message:', openaiError.message);
                    console.error('   Error type:', openaiError.constructor.name);
                    console.error('   Error status:', openaiError.status);
                    console.error('   Error code:', openaiError.code);
                    
                    await message.reply(`❌ OpenAI API Error: ${openaiError.message}`);
                }
            } else {
                await message.reply('❌ Not an image file.');
            }
        } else {
            await message.reply('❌ No attachments found.');
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
