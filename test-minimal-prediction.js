require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');

console.log('🔍 Testing Minimal Prediction...');
const token = process.env.DISCORD_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;

console.log('Token exists:', !!token);
console.log('OpenAI key exists:', !!openaiKey);

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
        
        const question = message.content.toLowerCase();
        const isPrediction = question.includes('predict') || question.includes('prediction');
        
        if (message.attachments.size > 0 && isPrediction) {
            console.log('🔮 PREDICTION WITH ATTACHMENTS DETECTED!');
            
            try {
                // Test 1: Check if we can access the attachment
                const attachment = message.attachments.first();
                console.log(`📎 Attachment: ${attachment.name}`);
                console.log(`📎 URL: ${attachment.url}`);
                console.log(`📎 Content Type: ${attachment.contentType}`);
                
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    console.log('🖼️ Image detected, testing OpenAI Vision...');
                    
                    // Test 2: Try OpenAI Vision API
                    try {
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
                        console.log(`✅ Analysis received: ${analysis.substring(0, 100)}...`);
                        
                        await message.reply(analysis);
                        
                    } catch (openaiError) {
                        console.error('❌ OpenAI Vision API Error:', openaiError.message);
                        await message.reply(`❌ OpenAI API Error: ${openaiError.message}`);
                    }
                } else {
                    console.log('❌ Not an image attachment');
                    await message.reply('❌ Please upload an image file.');
                }
                
            } catch (error) {
                console.error('❌ General Error:', error.message);
                console.error('❌ Error stack:', error.stack);
                await message.reply(`❌ Error: ${error.message}`);
            }
        } else {
            await message.reply('Hello! Upload a chart and ask me to predict!');
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
