irequire('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

class DebugMentionBot {
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

        // Initialize OpenAI
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // Set up database and event handlers
        this.initDatabase();
        this.setupEventHandlers();
    }

    /**
     * Initialize SQLite database for storing documents globally
     */
    async initDatabase() {
        this.db = new sqlite3.Database('./debug_bot.db');
        
        // Create tables if they don't exist
        await promisify(this.db.run.bind(this.db))(`
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                content TEXT NOT NULL,
                uploaded_by TEXT NOT NULL,
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
            console.log(`📄 Upload files in any channel and I'll remember them globally!`);
            console.log(`🔍 DEBUG MODE: I'll log all messages I receive`);
        });

        this.client.on('messageCreate', async (message) => {
            // Debug: Log all messages
            console.log(`📨 Message received:`);
            console.log(`   From: ${message.author.tag} (${message.author.id})`);
            console.log(`   Channel: ${message.channel.type} - ${message.channel.name || 'DM'}`);
            console.log(`   Content: "${message.content}"`);
            console.log(`   Attachments: ${message.attachments.size}`);
            console.log(`   Mentions bot: ${message.mentions.users.has(this.client.user.id)}`);
            console.log(`   Is bot: ${message.author.bot}`);
            console.log(`---`);

            // Ignore messages from bots
            if (message.author.bot) {
                console.log(`❌ Ignoring bot message`);
                return;
            }

            // Check if bot is mentioned
            if (message.mentions.users.has(this.client.user.id)) {
                console.log(`🎯 Bot mentioned! Processing...`);
                await this.handleMention(message);
            }

            // Handle file uploads for document feeding (anywhere)
            if (message.attachments.size > 0) {
                console.log(`📎 File attachment detected! Processing...`);
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
            console.log(`🤖 Processing mention from ${message.author.tag}`);
            const question = message.content.replace(`<@${this.client.user.id}>`, '').trim();
            console.log(`   Question: "${question}"`);
            
            if (!question) {
                console.log(`   No question provided, sending help message`);
                await message.reply('👋 Hi! Ask me anything! I remember all the files you\'ve uploaded across all channels.');
                return;
            }

            // Show typing indicator
            await message.channel.sendTyping();

            // Get all documents globally
            const documents = await this.getAllDocuments();
            console.log(`   Found ${documents.length} documents in memory`);
            
            // Generate response using AI
            console.log(`   Generating AI response...`);
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
            console.log(`   Response sent successfully`);

        } catch (error) {
            console.error('Error handling mention:', error);
            await message.reply('❌ Sorry, I encountered an error while processing your question.');
        }
    }

    /**
     * Handle file uploads for document feeding (works in any channel)
     */
    async handleFileUpload(message) {
        try {
            console.log(`📎 Processing file upload from ${message.author.tag}`);
            const saves = [];
            for (const [, attachment] of message.attachments) {
                console.log(`   File: ${attachment.name} (${attachment.size} bytes)`);
                
                // Check file size (max 10MB)
                if (attachment.size > 10 * 1024 * 1024) {
                    console.log(`   ❌ File too large`);
                    await message.reply(`❌ File too large: ${attachment.name}. Please upload files smaller than 10MB.`);
                    continue;
                }

                // Download and process file
                console.log(`   Downloading file...`);
                const response = await fetch(attachment.url);
                const buffer = await response.arrayBuffer();
                const content = Buffer.from(buffer).toString('utf-8');
                console.log(`   File content length: ${content.length} characters`);

                // Save to database globally
                saves.push(this.saveDocument(attachment.name, content, message.author.id));
            }

            await Promise.all(saves);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📄 Document Added')
                .setDescription(`Saved ${message.attachments.size} file(s) to my global memory!`)
                .setFooter({ text: `Uploaded by ${message.author.username} in #${message.channel.name || 'DM'}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            console.log(`   File upload processed successfully`);

        } catch (error) {
            console.error('Error handling file upload:', error);
            await message.reply('❌ Sorry, I couldn\'t process that file. Please make sure it\'s a text-based file.');
        }
    }

    /**
     * Generate AI response using OpenAI
     */
    async generateResponse(question, documents, channelId) {
        try {
            let systemPrompt = `You are a helpful AI assistant. Answer questions clearly and concisely based on the documents you have access to.`;

            // Add document context if available
            if (documents.length > 0) {
                systemPrompt += `\n\nYou have access to ${documents.length} document(s) in your memory. Use this information to provide accurate and helpful answers:\n\n`;
                documents.forEach((doc, index) => {
                    systemPrompt += `Document ${index + 1} (${doc.filename}):\n${doc.content}\n\n`;
                });
                systemPrompt += `When answering, reference specific information from the documents when relevant.`;
            } else {
                systemPrompt += `\n\nYou don't have any documents in memory yet. Upload some files first, then I'll be able to help answer questions about them.`;
            }

            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: question }
                ],
                max_tokens: 1000,
                temperature: 0.4
            });

            return completion.choices[0].message.content;

        } catch (error) {
            console.error('OpenAI API error:', error);
            throw new Error('Failed to generate response');
        }
    }

    /**
     * Get all documents globally
     */
    async getAllDocuments() {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT filename, content FROM documents ORDER BY uploaded_at DESC',
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    /**
     * Save document to database globally
     */
    async saveDocument(filename, content, uploadedBy) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO documents (filename, content, uploaded_by) VALUES (?, ?, ?)',
                [filename, content, uploadedBy],
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
                'INSERT INTO conversations (channel_id, user_id, question, answer) VALUES (?, ?, ?, ?)',
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
const bot = new DebugMentionBot();
bot.start().catch(console.error); 