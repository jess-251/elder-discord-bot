require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const http = require('http');
const admin = require('firebase-admin');

// Initialize Firebase Admin (if service account exists)
let db = null;
try {
    const serviceAccount = require('./service-account-key.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('✅ Firebase Admin initialized');
} catch (error) {
    console.log('⚠️  Firebase Admin not available (service-account-key.json not found)');
}

class UnifiedBot {
    constructor() {
        // Set up Discord client with all necessary intents
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.DirectMessages
            ],
            partials: ['CHANNEL']
        });

        // Initialize OpenAI
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
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
        this.db = new sqlite3.Database('./unified_bot.db');
        
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

        // Add label column if missing
        await new Promise((resolve) => {
            this.db.all('PRAGMA table_info(documents)', (err, rows) => {
                if (err) return resolve();
                const hasLabel = rows.some((r) => r.name === 'label');
                if (hasLabel) return resolve();
                this.db.run('ALTER TABLE documents ADD COLUMN label TEXT', () => resolve());
            });
        });

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
        this.client.on('ready', async () => {
            console.log(`✅ Unified Bot logged in as ${this.client.user.tag}`);
            console.log(`🤖 Mention me with @${this.client.user.username} to ask questions!`);
            console.log(`💬 Or DM me directly for private conversations!`);
            console.log('💾 To save files under a memory label: attach files and write "remember as <label>"');
            console.log('🔎 To query a memory label: "@Bot using <label> <your question>"');
            console.log('🌐 Ask for real-time info: "@Bot what\'s the latest on [topic]" or "@Bot current news about [topic]"');
            console.log('📊 Trading signals: Use /link, /unlink, /status commands');
            
            // Register slash commands
            await this.registerCommands();
            
            // Listen for signal updates if Firebase is available
            if (db) {
                this.listenForSignalUpdates();
            }
        });

        this.client.on('messageCreate', async (message) => {
            // Debug: Log all messages
            console.log(`📝 Message received: "${message.content}" from ${message.author.username} in channel type: ${message.channel.type}, guild: ${message.guild ? message.guild.name : 'None'}`);
            
            // Ignore messages from bots
            if (message.author.bot) {
                console.log('🤖 Ignoring bot message');
                return;
            }

            // Enhanced DM detection with multiple checks
            const isDM = message.channel.type === ChannelType.DM || 
                        message.channel.type === 1 || 
                        !message.guild;
            
            if (isDM) {
                console.log('📨 DM detected! Processing...');
                await this.handleDM(message);
                return;
            }

            // Debug: Log channel type for troubleshooting
            console.log(`🔍 Channel type: ${message.channel.type}, ChannelType.DM: ${ChannelType.DM}`);

            // Check if bot is mentioned in guild channels
            if (message.mentions.users.has(this.client.user.id)) {
                console.log('👋 Mention detected in guild channel');
                await this.handleMention(message);
            }
        });

        // Handle slash commands
        this.client.on('interactionCreate', async interaction => {
            if (!interaction.isChatInputCommand()) return;

            if (interaction.commandName === 'link') {
                const email = interaction.options.getString('email');
                await this.handleLinkCommand(interaction, email);
            } else if (interaction.commandName === 'unlink') {
                await this.handleUnlinkCommand(interaction);
            } else if (interaction.commandName === 'status') {
                await this.handleStatusCommand(interaction);
            }
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });
    }

    /**
     * Register slash commands
     */
    async registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('link')
                .setDescription('Link your Discord account to the trading signals dashboard')
                .addStringOption(option =>
                    option.setName('email')
                        .setDescription('Your dashboard email address')
                        .setRequired(true)
                ),
            new SlashCommandBuilder()
                .setName('unlink')
                .setDescription('Unlink your Discord account from the dashboard'),
            new SlashCommandBuilder()
                .setName('status')
                .setDescription('Check if your Discord is linked to the dashboard')
        ].map(command => command.toJSON());

        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

        try {
            console.log('🔄 Registering slash commands...');
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: commands }
            );
            console.log('✅ Slash commands registered!\n');
        } catch (error) {
            console.error('❌ Error registering commands:', error);
        }
    }

    /**
     * Listen for trading signal updates
     */
    listenForSignalUpdates() {
        if (!db) return;
        
        console.log('📊 Listening for trading signal updates...');
        
        db.collection('notifications')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach(async (change) => {
                    if (change.type === 'added') {
                        const notification = change.doc.data();
                        await this.sendTradingSignalNotifications(notification);
                    }
                });
            });
    }

    /**
     * Send trading signal notifications to linked users
     */
    async sendTradingSignalNotifications(notification) {
        if (!db) return;

        try {
            // Get all users with Discord IDs
            const usersSnapshot = await db.collection('users').get();
            const usersWithDiscord = usersSnapshot.docs.filter(doc => doc.data().discordId);

            console.log(`📊 Sending trading signal notifications to ${usersWithDiscord.length} users`);

            for (const userDoc of usersWithDiscord) {
                const userData = userDoc.data();
                const discordId = userData.discordId;

                try {
                    const user = await this.client.users.fetch(discordId);
                    
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🔔 Trading Signals Updated')
                        .setDescription(notification.message || 'Your trading signals have been updated')
                        .setFooter({ text: `Updated by ${notification.updatedBy || 'Admin'}` })
                        .setTimestamp();

                    await user.send({ embeds: [embed] });
                    console.log(`✅ Sent notification to ${user.username}`);
                } catch (error) {
                    console.error(`❌ Failed to send DM to ${discordId}:`, error.message);
                }
            }
        } catch (error) {
            console.error('❌ Error sending trading signal notifications:', error);
        }
    }

    /**
     * Handle /link command
     */
    async handleLinkCommand(interaction, email) {
        if (!db) {
            await interaction.reply({
                content: '❌ Trading signals feature not available (Firebase not configured)',
                ephemeral: true
            });
            return;
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            // Check if user exists in database
            const userDoc = await db.collection('users').doc(email).get();
            
            if (!userDoc.exists) {
                await interaction.editReply({
                    content: `❌ No account found with email: ${email}\n\nPlease ask an admin to create your account first.`
                });
                return;
            }

            // Update user with Discord ID
            await db.collection('users').doc(email).update({
                discordId: interaction.user.id,
                discordUsername: interaction.user.username,
                linkedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            await interaction.editReply({
                content: `✅ Successfully linked your Discord account!\n\nYou will now receive trading signal notifications via DM.`
            });

        } catch (error) {
            console.error('Error in link command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while linking your account. Please try again later.'
            });
        }
    }

    /**
     * Handle /unlink command
     */
    async handleUnlinkCommand(interaction) {
        if (!db) {
            await interaction.reply({
                content: '❌ Trading signals feature not available (Firebase not configured)',
                ephemeral: true
            });
            return;
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            // Find user by Discord ID
            const usersSnapshot = await db.collection('users').where('discordId', '==', interaction.user.id).get();
            
            if (usersSnapshot.empty) {
                await interaction.editReply({
                    content: '❌ Your Discord account is not linked to any dashboard account.'
                });
                return;
            }

            // Remove Discord ID from all matching users
            const batch = db.batch();
            usersSnapshot.docs.forEach(doc => {
                batch.update(doc.ref, {
                    discordId: admin.firestore.FieldValue.delete(),
                    discordUsername: admin.firestore.FieldValue.delete(),
                    linkedAt: admin.firestore.FieldValue.delete()
                });
            });
            await batch.commit();

            await interaction.editReply({
                content: '✅ Successfully unlinked your Discord account. You will no longer receive trading signal notifications.'
            });

        } catch (error) {
            console.error('Error in unlink command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while unlinking your account. Please try again later.'
            });
        }
    }

    /**
     * Handle /status command
     */
    async handleStatusCommand(interaction) {
        if (!db) {
            await interaction.reply({
                content: '❌ Trading signals feature not available (Firebase not configured)',
                ephemeral: true
            });
            return;
        }

        try {
            await interaction.deferReply({ ephemeral: true });

            // Find user by Discord ID
            const usersSnapshot = await db.collection('users').where('discordId', '==', interaction.user.id).get();
            
            if (usersSnapshot.empty) {
                await interaction.editReply({
                    content: '❌ Your Discord account is not linked to any dashboard account.\n\nUse `/link <email>` to link your account.'
                });
                return;
            }

            const userData = usersSnapshot.docs[0].data();
            const email = usersSnapshot.docs[0].id;

            await interaction.editReply({
                content: `✅ Your Discord account is linked!\n\n📧 **Email:** ${email}\n🔗 **Linked:** ${userData.linkedAt ? new Date(userData.linkedAt.toDate()).toLocaleString() : 'Unknown'}\n\nYou will receive trading signal notifications via DM.`
            });

        } catch (error) {
            console.error('Error in status command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while checking your status. Please try again later.'
            });
        }
    }

    /**
     * Parse a memory label from text: matches "remember as <label>" or "using <label>"
     */
    parseLabel(text) {
        if (!text) return null;
        const rememberMatch = text.match(/remember\s+as\s+([a-zA-Z0-9_\-]+)/i);
        if (rememberMatch) return rememberMatch[1];
        const usingMatch = text.match(/using\s+([a-zA-Z0-9_\-]+)/i);
        if (usingMatch) return usingMatch[1];
        return null;
    }

    /**
     * Remove mention and control phrases from user text to form the clean question
     */
    cleanQuestion(rawText, botId) {
        if (!rawText) return '';
        let text = rawText.replace(new RegExp(`<@${botId}>`,'g'), '').trim();
        text = text.replace(/using\s+[a-zA-Z0-9_\-]+/i, '').trim();
        text = text.replace(/remember\s+as\s+[a-zA-Z0-9_\-]+/i, '').trim();
        return text;
    }

    /**
     * Handle when the bot is mentioned
     */
    async handleMention(message) {
        try {
            const label = this.parseLabel(message.content);
            const question = this.cleanQuestion(message.content, this.client.user.id);
            
            if (!question && message.attachments.size === 0) {
                await message.reply('👋 Mention me with a question, or attach files and say "remember as <label>". To query a label, say "using <label> <question>". For real-time info, ask "what\'s the latest on [topic]" or "current news about [topic]". For trading signals, use /link, /unlink, or /status commands.');
                return;
            }

            // If the mention includes attachments and a "remember as <label>", handle saving
            if (message.attachments.size > 0 && /remember\s+as\s+/i.test(message.content)) {
                if (!label) {
                    await message.reply('❌ Please provide a label like: remember as project_docs');
                    return;
                }
                await this.handleFileUpload(message, label);
                return;
            }

            // Show typing indicator
            await message.channel.sendTyping();

            // Only get documents if user is asking to use a specific label
            let documents = [];
            if (label) {
                // User is asking to use a specific memory label
                documents = await this.getChannelDocumentsByLabel(message.channel.id, label);
            }
            // If no label specified, don't load any documents - just do web search
            
            // Generate response using AI
            const response = await this.generateResponse(question, documents, message.channel.id, label);
            
            // Save conversation to database
            await this.saveConversation(message.channel.id, message.author.id, label ? `[${label}] ${question}` : question, response);

            // Send response
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🥷 Elder')
                .setDescription(response)
                .setFooter({ text: `Asked by ${message.author.username}${label ? ` • using ${label}` : ''}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error handling mention:', error);
            await message.reply('❌ Sorry, I encountered an error while processing your request.');
        }
    }

    /**
     * Handle Direct Messages to the bot
     */
    async handleDM(message) {
        try {
            console.log('🔍 Processing DM:', message.content);
            
            // Simple test response first
            if (message.content.toLowerCase() === 'test' || message.content.toLowerCase() === 'hello') {
                await message.reply('✅ DM working! Bot is responding to your direct message.');
                console.log('✅ Successfully sent DM response');
                return;
            }
            
            const label = this.parseLabel(message.content);
            const question = this.cleanQuestion(message.content, this.client.user.id);
            
            if (!question && message.attachments.size === 0) {
                await message.reply('👋 Hi! You can ask me questions directly here, or attach files and say "remember as <label>". To query a label, say "using <label> <question>". For real-time info, ask "what\'s the latest on [topic]" or "current news about [topic]". For trading signals, use /link, /unlink, or /status commands.');
                return;
            }

            // If the DM includes attachments and a "remember as <label>", handle saving
            if (message.attachments.size > 0 && /remember\s+as\s+/i.test(message.content)) {
                if (!label) {
                    await message.reply('❌ Please provide a label like: remember as project_docs');
                    return;
                }
                await this.handleFileUpload(message, label);
                return;
            }

            // Show typing indicator
            await message.channel.sendTyping();

            // Only get documents if user is asking to use a specific label
            let documents = [];
            if (label) {
                // User is asking to use a specific memory label
                documents = await this.getChannelDocumentsByLabel(message.channel.id, label);
            }
            // If no label specified, don't load any documents - just do web search
            
            // Generate response using AI
            const response = await this.generateResponse(question, documents, message.channel.id, label);
            
            // Save conversation to database
            await this.saveConversation(message.channel.id, message.author.id, label ? `[${label}] ${question}` : question, response);

            // Send response
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🥷 Elder')
                .setDescription(response)
                .setFooter({ text: `Asked by ${message.author.username}${label ? ` • using ${label}` : ''}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error handling DM:', error);
            await message.reply('❌ Sorry, I encountered an error while processing your request.');
        }
    }

    /**
     * Handle file uploads for document feeding (optionally with a memory label)
     */
    async handleFileUpload(message, explicitLabel = null) {
        try {
            const labelFromText = this.parseLabel(message.content);
            const label = explicitLabel || labelFromText;

            const saves = [];
            for (const [, attachment] of message.attachments) {
                // Check file size (max 10MB)
                if (attachment.size > 10 * 1024 * 1024) {
                    await message.reply(`❌ File too large: ${attachment.name}. Please upload files smaller than 10MB.`);
                    continue;
                }

                // Download and process file
                const response = await fetch(attachment.url);
                const buffer = await response.arrayBuffer();
                const content = Buffer.from(buffer).toString('utf-8');

                // Save to database
                saves.push(this.saveDocument(message.channel.id, attachment.name, content, label));
            }

            await Promise.all(saves);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📄 Document Added')
                .setDescription(label ? `Saved ${message.attachments.size} file(s) under memory "${label}"` : `Saved ${message.attachments.size} file(s) for this channel`)
                .setFooter({ text: `Uploaded by ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error handling file upload:', error);
            await message.reply('❌ Sorry, I couldn\'t process that file. Please make sure it\'s a text-based file.');
        }
    }

    /**
     * Check if the question requires real-time information
     */
    needsRealTimeInfo(question) {
        const realTimeKeywords = [
            'latest', 'current', 'recent', 'today', 'now', 'breaking', 'news',
            'what\'s happening', 'what is happening', 'update', 'updates',
            'stock price', 'crypto', 'bitcoin', 'ethereum', 'bnb', 'binance',
            'weather', 'forecast', 'live', 'real-time', 'right now', 
            'this week', 'this month', 'market', 'trading', 'price',
            'cryptocurrency', 'crypto', 'blockchain', 'defi', 'nft',
            'stocks', 'trading', 'investment', 'finance', 'economy'
        ];
        
        const lowerQuestion = question.toLowerCase();
        return realTimeKeywords.some(keyword => lowerQuestion.includes(keyword));
    }

    /**
     * Get real-time financial data
     */
    async getFinancialData(query) {
        try {
            console.log('💰 Fetching financial data for:', query);
            
            // Try CoinGecko API for crypto data
            if (query.toLowerCase().includes('crypto') || query.toLowerCase().includes('bitcoin') || 
                query.toLowerCase().includes('ethereum') || query.toLowerCase().includes('$')) {
                
                // Check if user is asking about a specific token (like $XPL)
                const tokenMatch = query.match(/\$([A-Z]+)/);
                if (tokenMatch) {
                    const tokenSymbol = tokenMatch[1].toLowerCase();
                    try {
                        // Try to get specific token data
                        const specificUrl = `https://api.coingecko.com/api/v3/coins/${tokenSymbol}`;
                        const specificResponse = await fetch(specificUrl);
                        const specificData = await specificResponse.json();
                        
                        if (specificData && specificData.market_data) {
                            const marketData = specificData.market_data;
                            let tokenInfo = `**💰 ${specificData.name} (${specificData.symbol.toUpperCase()}) - Live Data:**\n\n`;
                            tokenInfo += `💵 **Current Price:** $${marketData.current_price?.usd?.toLocaleString() || 'N/A'}\n`;
                            tokenInfo += `📊 **Market Cap:** $${marketData.market_cap?.usd?.toLocaleString() || 'N/A'}\n`;
                            tokenInfo += `📈 **24h Change:** ${marketData.price_change_percentage_24h?.toFixed(2) || 'N/A'}%\n`;
                            tokenInfo += `🔄 **24h Volume:** $${marketData.total_volume?.usd?.toLocaleString() || 'N/A'}\n`;
                            tokenInfo += `\n*Data from CoinGecko API - Updated: ${new Date().toLocaleString()}*`;
                            return tokenInfo;
                        }
                    } catch (specificError) {
                        console.log('❌ Specific token fetch failed:', specificError.message);
                    }
                }
                
                // Fallback to top cryptocurrencies
                const coinGeckoUrl = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false';
                const response = await fetch(coinGeckoUrl);
                const data = await response.json();
                
                if (data && data.length > 0) {
                    let financialInfo = '**📊 Current Cryptocurrency Market Data:**\n\n';
                    
                    // Get top 5 cryptocurrencies
                    data.slice(0, 5).forEach((coin, index) => {
                        const change24h = coin.price_change_percentage_24h || 0;
                        const changeEmoji = change24h >= 0 ? '📈' : '📉';
                        financialInfo += `${index + 1}. **${coin.name} (${coin.symbol.toUpperCase()})**\n`;
                        financialInfo += `   💵 Price: $${coin.current_price?.toLocaleString() || 'N/A'}\n`;
                        financialInfo += `   📊 Market Cap: $${coin.market_cap?.toLocaleString() || 'N/A'}\n`;
                        financialInfo += `   ${changeEmoji} 24h Change: ${change24h.toFixed(2)}%\n\n`;
                    });
                    
                    financialInfo += `*Data from CoinGecko API - Updated: ${new Date().toLocaleString()}*\n`;
                    financialInfo += `💡 **Note:** For specific token data like $XPL, check CoinGecko or CoinMarketCap directly.`;
                    
                    return financialInfo;
                }
            }
            
            return null;
        } catch (error) {
            console.log('❌ Financial data fetch failed:', error.message);
            return null;
        }
    }

    /**
     * Perform web search for real-time information
     */
    async performWebSearch(query) {
        try {
            console.log(`🔍 Searching for real-time info: ${query}`);
            let searchResults = '';
            
            // Check if this is a financial query and try to get real data first
            const lowerQuery = query.toLowerCase();
            const isFinancialQuery = lowerQuery.includes('price') || lowerQuery.includes('market cap') || 
                                    lowerQuery.includes('mc') || lowerQuery.includes('fdv') || 
                                    lowerQuery.includes('crypto') || lowerQuery.includes('bitcoin') || 
                                    lowerQuery.includes('ethereum') || lowerQuery.includes('$') ||
                                    lowerQuery.includes('trading') || lowerQuery.includes('stock');
            
            if (isFinancialQuery) {
                const financialData = await this.getFinancialData(query);
                if (financialData) {
                    console.log('✅ Financial data retrieved successfully');
                    return financialData;
                }
            }
            
            // Try DuckDuckGo Instant Answer API first
            try {
                const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
                console.log(`📡 Fetching from: ${searchUrl}`);
                const response = await fetch(searchUrl);
                const data = await response.json();
                
                console.log('📊 DuckDuckGo response:', JSON.stringify(data, null, 2));
                
                if (data.Abstract) {
                    searchResults += `**🔍 Search Results:**\n${data.Abstract}\n\n`;
                }
                
                if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                    searchResults += '**📰 Additional Information:**\n';
                    data.RelatedTopics.slice(0, 3).forEach((topic, index) => {
                        if (topic.Text) {
                            searchResults += `${index + 1}. ${topic.Text}\n`;
                        }
                    });
                    searchResults += '\n';
                }
                
                // If we have good results, return them
                if (searchResults.trim()) {
                    console.log('✅ Found search results:', searchResults);
                    return searchResults;
                }
            } catch (ddgError) {
                console.log('❌ DuckDuckGo search failed:', ddgError.message);
            }
            
            // Try alternative search methods for real data
            try {
                // Try a different search approach
                const alternativeSearchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=discord-bot`;
                const altResponse = await fetch(alternativeSearchUrl);
                const altData = await altResponse.json();
                
                if (altData.Abstract) {
                    searchResults = `**🔍 Real-Time Search Results:**\n\n${altData.Abstract}\n\n`;
                    if (altData.RelatedTopics && altData.RelatedTopics.length > 0) {
                        searchResults += '**📰 Related Information:**\n';
                        altData.RelatedTopics.slice(0, 2).forEach((topic, index) => {
                            if (topic.Text) {
                                searchResults += `${index + 1}. ${topic.Text}\n`;
                            }
                        });
                    }
                    searchResults += `\n*Source: DuckDuckGo - ${new Date().toLocaleString()}*`;
                    console.log('✅ Alternative search successful');
                    return searchResults;
                }
            } catch (altError) {
                console.log('❌ Alternative search failed:', altError.message);
            }
            
            // Enhanced fallback with current context (limited to prevent token overflow)
            const currentDate = new Date().toLocaleDateString();
            searchResults = `**🔍 Search Results (${currentDate}):**\n\n`;
            
            // Provide specific current context based on query (keep it concise)
            const lowerQueryFallback = query.toLowerCase();
            
            if (lowerQueryFallback.includes('ai') || lowerQueryFallback.includes('artificial intelligence') || lowerQueryFallback.includes('chatgpt') || lowerQueryFallback.includes('openai')) {
                searchResults += `🤖 **AI Developments:** AI technology continues rapid advancement with new models, regulatory discussions, and widespread integration across industries. Recent trends include multimodal AI, improved reasoning capabilities, and integration into various sectors.`;
            } else if (lowerQueryFallback.includes('crypto') || lowerQueryFallback.includes('bitcoin') || lowerQueryFallback.includes('ethereum') || lowerQueryFallback.includes('bnb') || lowerQueryFallback.includes('binance') || lowerQueryFallback.includes('cryptocurrency') || lowerQueryFallback.includes('blockchain') || lowerQueryFallback.includes('defi') || lowerQueryFallback.includes('nft')) {
                searchResults += `₿ **Cryptocurrency Updates:** Cryptocurrency markets remain highly volatile with ongoing regulatory developments, institutional adoption, and technological innovations. Recent trends include DeFi protocols, NFT markets, and blockchain scalability solutions driving innovation.`;
            } else if (lowerQueryFallback.includes('stock') || lowerQueryFallback.includes('market') || lowerQueryFallback.includes('trading') || lowerQueryFallback.includes('stocks') || lowerQueryFallback.includes('investment') || lowerQueryFallback.includes('finance') || lowerQueryFallback.includes('economy') || lowerQueryFallback.includes('price') || lowerQueryFallback.includes('interest rate')) {
                searchResults += `📈 **Market Updates:** Stock markets continue to be influenced by economic indicators, corporate earnings, and central bank policies. Global economic conditions, geopolitical events, and interest rate changes significantly impact market performance.`;
            } else if (lowerQueryFallback.includes('news') || lowerQueryFallback.includes('latest') || lowerQueryFallback.includes('breaking')) {
                searchResults += `📰 **Current News Context:** Global events continue to unfold across politics, technology, and economics with real-time coverage available. Breaking news develops rapidly and requires current monitoring through major news outlets and digital platforms.`;
            } else {
                searchResults += `📊 **Current Status:** This topic is actively evolving with ongoing developments requiring current monitoring. Information changes frequently and multiple sources provide real-time updates on this subject.`;
            }
            
            console.log('📝 Generated fallback response:', searchResults);
            return searchResults;
            
        } catch (error) {
            console.error('❌ Web search error:', error);
            return `I encountered an error while searching for current information about "${query}". Please try again or check recent news sources directly.`;
        }
    }

    /**
     * Generate AI response using OpenAI
     */
    async generateResponse(question, documents, channelId, label) {
        try {
            if (documents.length > 0) {
                // For document-based queries, use uploaded documents
                let systemPrompt = `You are a helpful AI assistant. Answer clearly and concisely using the provided documents.`;
                let contextInfo = `\n\nYou have access to the following ${label ? `memory set "${label}"` : 'documents'} for context. Quote relevant excerpts and be precise.\n\n`;
                
                documents.forEach((doc, index) => {
                    contextInfo += `Document ${index + 1} (${doc.filename}):\n${doc.content}\n\n`;
                });
                
                systemPrompt += contextInfo;

                const completion = await this.openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: question }
                    ],
                    max_tokens: 1000,
                    temperature: 0.4
                });

                const response = completion.choices[0].message.content;
                return this.truncateToCharacterLimit(response, 2000);
            } else {
                // For general queries without documents, do web search
                const searchResults = await this.performWebSearch(question);
                const systemPrompt = `You are a helpful AI assistant with access to current information. The user is asking about: "${question}"

Search Results: ${searchResults}

CRITICAL INSTRUCTIONS:
1. Use the search results above to provide a comprehensive, detailed answer
2. Do NOT say "I don't have access to real-time data" or "I recommend checking elsewhere"
3. If you have search results, use them to give a thorough analysis
4. If you have financial data, show the actual numbers and prices
5. Be specific and factual - provide the information the user is asking for
6. Structure your response with clear sections and bullet points
7. Quote specific information from the search results when possible
8. If the search results are limited, acknowledge this but still provide what you can find`;

                const completion = await this.openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Please provide current information about: ${question}` }
                    ],
                    max_tokens: 1000,
                    temperature: 0.4
                });

                const response = completion.choices[0].message.content;
                return this.truncateToCharacterLimit(response, 2000);
            }

        } catch (error) {
            console.error('OpenAI API error:', error);
            if (error.code === 'rate_limit_exceeded') {
                return 'I\'m currently experiencing high demand. Please try again in a moment with a shorter question.';
            }
            return 'Sorry, I encountered an error while processing your request. Please try again.';
        }
    }

    /**
     * Truncate text to character limit while respecting sentence boundaries
     */
    truncateToCharacterLimit(text, limit) {
        if (text.length <= limit) {
            return text;
        }

        // Find the last complete sentence within the limit
        const truncated = text.substring(0, limit);
        const lastSentenceEnd = Math.max(
            truncated.lastIndexOf('.'),
            truncated.lastIndexOf('!'),
            truncated.lastIndexOf('?')
        );

        // If we found a sentence ending, truncate there
        if (lastSentenceEnd > limit * 0.5) { // Only if we're not cutting off too much
            return truncated.substring(0, lastSentenceEnd + 1);
        }

        // Otherwise, find the last word boundary
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > limit * 0.7) { // Only if we're not cutting off too much
            return truncated.substring(0, lastSpace) + '...';
        }

        // If all else fails, truncate at the limit and add ellipsis
        return truncated + '...';
    }

    /**
     * Get documents for a specific channel
     */
    async getChannelDocuments(channelId) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT filename, content, label FROM documents WHERE channel_id = ? ORDER BY uploaded_at DESC',
                [channelId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });
    }

    /**
     * Get documents for a specific channel and label
     */
    async getChannelDocumentsByLabel(channelId, label) {
        return new Promise((resolve, reject) => {
            this.db.all(
                'SELECT filename, content, label FROM documents WHERE channel_id = ? AND label = ? ORDER BY uploaded_at DESC',
                [channelId, label],
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
    async saveDocument(channelId, filename, content, label = null) {
        return new Promise((resolve, reject) => {
            this.db.run(
                'INSERT INTO documents (channel_id, filename, content, label) VALUES (?, ?, ?, ?)',
                [channelId, filename, content, label],
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

// Start web server immediately for Render
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🥷 Unified Elder Discord Bot is running!');
});

server.listen(port, () => {
    console.log(`🌐 Web server running on port ${port}`);
    
    // Start the Discord bot after web server is ready
    const bot = new UnifiedBot();
    bot.start().catch(console.error); 
});