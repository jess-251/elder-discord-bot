require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const OpenAI = require('openai');

class SimpleBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent
            ]
        });

        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        this.setupEvents();
    }

    setupEvents() {
        this.client.on('ready', () => {
            console.log(`✅ Bot logged in as ${this.client.user.tag}`);
            console.log(`🤖 Mention me with @${this.client.user.username} to test!`);
        });

        this.client.on('messageCreate', async (message) => {
            try {
                if (message.author.bot) return;
                
                const isMentioned = message.mentions.users.has(this.client.user.id);
                if (!isMentioned) return;

                console.log(`📨 Message received from ${message.author.tag}: ${message.content}`);

                if (message.attachments.size > 0) {
                    await this.handleAttachments(message);
                } else {
                    await message.channel.send('👋 Hi! I\'m your AI bot. Mention me with an image to analyze it!');
                }
            } catch (error) {
                console.error('Error handling message:', error);
                try {
                    await message.channel.send('❌ Sorry, something went wrong. Please try again.');
                } catch (e) {
                    console.error('Could not send error message:', e);
                }
            }
        });

        this.client.on('error', (error) => {
            console.error('Discord error:', error);
        });

        process.on('unhandledRejection', (error) => {
            console.error('Unhandled rejection:', error);
        });
    }

    async handleAttachments(message) {
        try {
            for (const attachment of message.attachments.values()) {
                if (attachment.contentType && attachment.contentType.startsWith('image/')) {
                    console.log(`🔍 Processing image: ${attachment.name}`);
                    await this.analyzeImage(message, attachment);
                } else {
                    await message.channel.send(`📁 I can see you uploaded: ${attachment.name} (${attachment.contentType})`);
                }
            }
        } catch (error) {
            console.error('Error handling attachments:', error);
            await message.channel.send('❌ Error processing attachments. Please try again.');
        }
    }

    async analyzeImage(message, attachment) {
        try {
            console.log(`🔍 Starting image analysis for: ${attachment.name}`);
            
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Please analyze this image in detail. If it's a chart, diagram, or graph, explain what data it's showing, what the trends are, and any key insights. If it's a screenshot or other image, describe what you see and any important details. Be thorough and helpful."
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

            const analysis = response.choices[0].message.content;
            console.log(`✅ Image analysis completed for: ${attachment.name}`);
            
            await message.channel.send(`🔍 **Analysis of ${attachment.name}:**\n\n${analysis}`);
            
        } catch (error) {
            console.error(`❌ Error analyzing image ${attachment.name}:`, error);
            await message.channel.send(`❌ Failed to analyze ${attachment.name}. Error: ${error.message}`);
        }
    }

    start() {
        this.client.login(process.env.DISCORD_TOKEN);
    }
}

// Start the bot
const bot = new SimpleBot();
bot.start();
