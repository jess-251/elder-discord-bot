require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class MentionBotFree {
    constructor() {
        // Set up Discord client with necessary intents
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessageReactions
            ]
        });

        // Store documents per channel
        this.channelDocuments = new Map();
        
        // Set up database and event handlers
        this.initDatabase();
        this.setupEventHandlers();
    }

    /**
     * Initialize SQLite database for storing documents and conversation history
     */
    async initDatabase() {
        this.db = new sqlite3.Database('./mention_bot_free.db');
        
        // Create tables if they don't exist
        await promisify(this.db.run.bind(this.db))(`
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await promisify(this.db.run.bind(this.db))(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    /**
     * Set up Discord event handlers
     */
    setupEventHandlers() {
        this.client.on('ready', () => {
            console.log(`✅ Bot logged in as ${this.client.user.tag}`);
            console.log(`🤖 Mention me with @${this.client.user.username} to ask questions!`);
            console.log(`📄 Upload documents to give me context!`);
        });

        this.client.on('messageCreate', async (message) => {
            // Ignore messages from bots
            if (message.author.bot) return;

            // Check if bot is mentioned
            if (message.mentions.users.has(this.client.user.id)) {
                await this.handleMention(message);
            }

            // Handle file uploads for document feeding
            if (message.attachments.size > 0) {
                await this.handleFileUpload(message);
            }
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });
    }

    /**
     * Handle when the bot is mentioned
     */
    async handleMention(message) {
        try {
            const question = message.content.replace(`<@${this.client.user.id}>`, '').trim();
            
            if (!question) {
                await message.reply('👋 Hi! I\'m here to help answer your questions. Upload documents to give me context, then ask me anything!');
                return;
            }

            // Show typing indicator
            await message.channel.sendTyping();

            // Get documents for this channel
            const documents = await this.getChannelDocuments(message.channel.id);
            
            // Generate response using document search
            const response = await this.generateResponse(question, documents, message.channel.id);
            
            // Save conversation to database
            await this.saveConversation(message.channel.id, message.author.id, question, response);

            // Send response
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🤖 AI Assistant')
                .setDescription(response)
                .setFooter({ text: `Asked by ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error handling mention:', error);
            await message.reply('❌ Sorry, I encountered an error while processing your question. Please try again.');
        }
    }

    /**
     * Handle file uploads for document feeding
     */
    async handleFileUpload(message) {
        try {
            const attachment = message.attachments.first();
            
            // Check file size (max 10MB)
            if (attachment.size > 10 * 1024 * 1024) {
                await message.reply('❌ File too large! Please upload files smaller than 10MB.');
                return;
            }

            // Download and process file
            const response = await fetch(attachment.url);
            const buffer = await response.arrayBuffer();
            const content = Buffer.from(buffer).toString('utf-8');

            // Save to database
            await this.saveDocument(message.channel.id, attachment.name, content);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📄 Document Added')
                .setDescription(`Successfully added **${attachment.name}** to my knowledge base for this channel!`)
                .setFooter({ text: `Uploaded by ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error handling file upload:', error);
            await message.reply('❌ Sorry, I couldn\'t process that file. Please make sure it\'s a text-based file.');
        }
    }

    /**
     * Generate response using document search and simple AI
     */
    async generateResponse(question, documents, channelId) {
        try {
            if (documents.length === 0) {
                return "I don't have any documents to reference yet. Please upload some documents first, then I'll be able to help answer your questions!";
            }

            // Simple keyword-based search
            const questionLower = question.toLowerCase();
            const relevantDocs = documents.filter(doc => {
                const contentLower = doc.content.toLowerCase();
                const filenameLower = doc.filename.toLowerCase();
                
                // Check if question keywords appear in document
                const keywords = questionLower.split(' ').filter(word => word.length > 3);
                return keywords.some(keyword => 
                    contentLower.includes(keyword) || filenameLower.includes(keyword)
                );
            });

            if (relevantDocs.length === 0) {
                return `I found ${documents.length} document(s) but none seem directly relevant to your question: "${question}". Try asking something more general or upload more relevant documents.`;
            }

            // Create a response based on relevant documents
            let response = `Based on the documents I have, here's what I found:\n\n`;
            
            relevantDocs.forEach((doc, index) => {
                response += `**From ${doc.filename}:**\n`;
                
                // Extract relevant sentences (simple approach)
                const sentences = doc.content.split(/[.!?]+/).filter(s => s.trim().length > 10);
                const relevantSentences = sentences.filter(sentence => {
                    const sentenceLower = sentence.toLowerCase();
                    const keywords = questionLower.split(' ').filter(word => word.length > 3);
                    return keywords.some(keyword => sentenceLower.includes(keyword));
                }).slice(0, 3); // Limit to 3 most relevant sentences
                
                if (relevantSentences.length > 0) {
                    response += relevantSentences.map(s => s.trim()).join('. ') + '.\n\n';
                } else {
                    // If no specific sentences match, give a general summary
                    const words = doc.content.split(' ').slice(0, 50).join(' ');
                    response += `${words}...\n\n`;
                }
            });

            response += `\nI found ${relevantDocs.length} relevant document(s) out of ${documents.length} total. If you need more specific information, try asking a more detailed question or upload additional documents.`;

            return response;

        } catch (error) {
            console.error('Error generating response:', error);
            return "Sorry, I had trouble processing your question. Please try again with a different question.";
        }
    }

    /**
     * Get documents for a specific channel
     */
    async getChannelDocuments(channelId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT filename, content FROM documents WHERE channel_id = ? ORDER BY uploaded_at DESC',
                [channelId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    /**
     * Save document to database
     */
    async saveDocument(channelId, filename, content) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO documents (channel_id, filename, content) VALUES (?, ?, ?)',
                [channelId, filename, content],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    /**
     * Save conversation to database
     */
    async saveConversation(channelId, userId, question, answer) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO conversations (channel_id, user_id, question, answer) VALUES (?, ?, ?)',
                [channelId, userId, question, answer],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });
    }

    /**
     * Start the bot
     */
    async start() {
        try {
            await this.client.login(process.env.DISCORD_TOKEN);
        } catch (error) {
            console.error('Failed to start bot:', error);
            process.exit(1);
        }
    }
}

// Start the bot
const bot = new MentionBotFree();
bot.start().catch(console.error); 