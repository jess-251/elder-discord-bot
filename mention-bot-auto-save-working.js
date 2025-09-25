require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const axios = require('axios');

class SimpleMentionBot {
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
        this.db = new sqlite3.Database('./simple_bot.db');
        
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
        });

        this.client.on('messageCreate', async (message) => {
            console.log(`📨 Message received: "${message.content}" from ${message.author.username}`);
            
            // Ignore messages from bots
            if (message.author.bot) {
                console.log(`🤖 Ignoring bot message from ${message.author.username}`);
                return;
            }

            // Check if bot is mentioned
            if (message.mentions.users.has(this.client.user.id)) {
                console.log(`🎯 Bot mentioned! Processing: "${message.content}"`);
                await this.handleMention(message);
            } else {
                console.log(`❌ Bot not mentioned in: "${message.content}"`);
            }

            // Handle file uploads for document feeding (anywhere)
            if (message.attachments.size > 0) {
                console.log(`📎 File attachment detected: ${message.attachments.size} files`);
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
                await message.reply('👋 Hi! Ask me anything! I remember all the files you\'ve uploaded across all channels.');
                return;
            }

            // Show typing indicator
            await message.channel.sendTyping();

            // Get all documents globally
            const documents = await this.getAllDocuments();
            
            // Generate response using AI
            const response = await this.generateResponse(question, documents, message.channel.id);
            
            // Save conversation to database
            await this.saveConversation(message.channel.id, message.author.id, question, response);

            // Send response
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('🥷 Elder')
                .setDescription(response)
                .setFooter({ text: `Asked by ${message.author.username}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

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

                // Save to database globally
                saves.push(this.saveDocument(attachment.name, content, message.author.id));
            }

            await Promise.all(saves);

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📄 Document Added')
                .setDescription(`Saved ${message.attachments.size} file(s) to my global memory!`)
                .setFooter({ text: `Uploaded by ${message.author.username} in #${message.channel.name}` })
                .setTimestamp();

            await message.reply({ embeds: [embed] });

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
            let context = '';
            
            // Always try web search first for current information
            console.log(`🌐 Always attempting web search for: "${question}"`);
            const webSearchInfo = await this.performWebSearch(question);
            console.log(`🌐 Web search result: ${webSearchInfo ? 'SUCCESS' : 'FAILED'}`);
            if (webSearchInfo) {
                context += `\n\n**Current Information from Web:**\n${webSearchInfo}\n`;
                console.log(`🌐 Added web search context to response`);
            }
            
            // Add document context if available
            if (documents.length > 0) {
                context += `\n\n**Context from saved files:**\n`;
                documents.forEach((doc, index) => {
                    context += `\n**File ${index + 1}: ${doc.filename}**\n${doc.content.substring(0, 1000)}${doc.content.length > 1000 ? '...' : ''}\n`;
                });
            }

            const systemPrompt = `You are a helpful AI assistant. Answer the following question based on the context provided. 

PRIORITY ORDER:
1. Use "Current Information from Web" if available (most current/accurate)
2. Use "Context from saved files" if relevant to the question
3. Use your general knowledge as fallback

IMPORTANT: Always provide a comprehensive answer. If web information is provided, use it. If file context is provided and relevant, use it. Never say "I don't have information" - always provide the best answer possible.`;

            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Question: ${question}${context}` }
                ],
                max_tokens: 1500,
                temperature: 0.4
            });

            return completion.choices[0].message.content;

        } catch (error) {
            console.error('OpenAI API error:', error);
            throw new Error('Failed to generate response');
        }
    }

    /**
     * Perform web search for current information
     */
    async performWebSearch(query) {
        try {
            console.log(`🔍 Performing web search for: "${query}"`);
            
            const searchResults = [];
            
            // Always try to get crypto prices and market data for any crypto-related question
            const isCryptoRelated = query.toLowerCase().includes('crypto') || query.toLowerCase().includes('bitcoin') || 
                query.toLowerCase().includes('btc') || query.toLowerCase().includes('ethereum') || 
                query.toLowerCase().includes('eth') || query.toLowerCase().includes('solana') || 
                query.toLowerCase().includes('sol') || query.toLowerCase().includes('defi') ||
                query.toLowerCase().includes('nft') || query.toLowerCase().includes('blockchain') ||
                query.toLowerCase().includes('trading') || query.toLowerCase().includes('price') ||
                query.toLowerCase().includes('hyperliquid') || query.toLowerCase().includes('uniswap') ||
                query.toLowerCase().includes('dydx') || query.toLowerCase().includes('gmx') ||
                query.toLowerCase().includes('exchange') || query.toLowerCase().includes('platform') ||
                query.toLowerCase().includes('dex') || query.toLowerCase().includes('perpetual');
            
            // Search for crypto prices using CoinGecko API
            if (isCryptoRelated) {
                try {
                    const cryptoResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true');
                    
                    if (cryptoResponse.data) {
                        const cryptoData = cryptoResponse.data;
                        let cryptoInfo = '**Current Cryptocurrency Prices:**\n';
                        
                        if (cryptoData.bitcoin) {
                            cryptoInfo += `🟠 **Bitcoin (BTC)**: $${cryptoData.bitcoin.usd.toLocaleString()} (${cryptoData.bitcoin.usd_24h_change > 0 ? '+' : ''}${cryptoData.bitcoin.usd_24h_change.toFixed(2)}%)\n`;
                        }
                        if (cryptoData.ethereum) {
                            cryptoInfo += `🔵 **Ethereum (ETH)**: $${cryptoData.ethereum.usd.toLocaleString()} (${cryptoData.ethereum.usd_24h_change > 0 ? '+' : ''}${cryptoData.ethereum.usd_24h_change.toFixed(2)}%)\n`;
                        }
                        if (cryptoData.solana) {
                            cryptoInfo += `🟣 **Solana (SOL)**: $${cryptoData.solana.usd.toLocaleString()} (${cryptoData.solana.usd_24h_change > 0 ? '+' : ''}${cryptoData.solana.usd_24h_change.toFixed(2)}%)\n`;
                        }
                        if (cryptoData.binancecoin) {
                            cryptoInfo += `🟡 **Binance Coin (BNB)**: $${cryptoData.binancecoin.usd.toLocaleString()} (${cryptoData.binancecoin.usd_24h_change > 0 ? '+' : ''}${cryptoData.binancecoin.usd_24h_change.toFixed(2)}%)\n`;
                        }
                        
                        searchResults.push(cryptoInfo);
                    }
                } catch (cryptoError) {
                    console.log('Crypto API error:', cryptoError.message);
                }
            }
            
            // Try to get actual news for specific queries
            if (query.toLowerCase().includes('news') || query.toLowerCase().includes('latest') || 
                query.toLowerCase().includes('update') || query.toLowerCase().includes('aster') || 
                query.toLowerCase().includes('bnb') || query.toLowerCase().includes('binance')) {
                try {
                    // Try to get actual news from CoinGecko news API
                    const newsResponse = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false');
                    if (newsResponse.data) {
                        let newsInfo = '**Latest Crypto Market News & Updates:**\n\n';
                        newsInfo += `**Top Cryptocurrencies by Market Cap:**\n`;
                        newsResponse.data.slice(0, 5).forEach((coin, index) => {
                            const change = coin.price_change_percentage_24h > 0 ? '+' : '';
                            newsInfo += `${index + 1}. **${coin.name} (${coin.symbol.toUpperCase()})**: $${coin.current_price.toLocaleString()} (${change}${coin.price_change_percentage_24h.toFixed(2)}%)\n`;
                        });
                        newsInfo += `\n**Market Status:** ${new Date().toLocaleString()}\n\n`;
                        
                        // Add specific info for Aster and BNB if mentioned
                        if (query.toLowerCase().includes('aster')) {
                            newsInfo += `**About Aster:**\n`;
                            newsInfo += `• Aster is a decentralized finance (DeFi) protocol\n`;
                            newsInfo += `• Provides decentralized financial services on blockchain\n`;
                            newsInfo += `• Involved in lending, borrowing, and other DeFi activities\n`;
                            newsInfo += `• For latest updates, check Aster's official channels\n\n`;
                        }
                        
                        if (query.toLowerCase().includes('bnb') || query.toLowerCase().includes('binance')) {
                            newsInfo += `**About BNB (Binance Coin):**\n`;
                            newsInfo += `• Native cryptocurrency of Binance exchange\n`;
                            newsInfo += `• Founded by Changpeng Zhao (CZ)\n`;
                            newsInfo += `• Used for trading fee discounts on Binance\n`;
                            newsInfo += `• Powers Binance Smart Chain (BSC) ecosystem\n`;
                            newsInfo += `• For latest updates, check Binance official announcements\n\n`;
                        }
                        
                        searchResults.push(newsInfo);
                    }
                } catch (newsError) {
                    console.log('News API error:', newsError.message);
                }
            }
            
            // Always provide general crypto information
            try {
                const newsResponse = await axios.get('https://api.coingecko.com/api/v3/global');
                if (newsResponse.data && newsResponse.data.data) {
                    const globalData = newsResponse.data.data;
                    let newsInfo = '**Current Crypto Market Overview:**\n';
                    newsInfo += `📊 **Total Market Cap**: $${globalData.total_market_cap.usd.toLocaleString()}\n`;
                    newsInfo += `📈 **24h Volume**: $${globalData.total_volume.usd.toLocaleString()}\n`;
                    newsInfo += `🪙 **Active Cryptocurrencies**: ${globalData.active_cryptocurrencies.toLocaleString()}\n`;
                    newsInfo += `📱 **Active Exchanges**: ${globalData.markets.toLocaleString()}\n`;
                    newsInfo += `📉 **Market Cap Change (24h)**: ${globalData.market_cap_change_percentage_24h_usd.toFixed(2)}%\n\n`;
                    newsInfo += `**Popular Crypto Traders & Influencers:**\n`;
                    newsInfo += `• **Vitalik Buterin** - Ethereum co-founder\n`;
                    newsInfo += `• **CZ (Changpeng Zhao)** - Binance founder\n`;
                    newsInfo += `• **Michael Saylor** - MicroStrategy CEO, Bitcoin advocate\n`;
                    newsInfo += `• **Elon Musk** - Tesla CEO, Dogecoin influencer\n`;
                    newsInfo += `• **Andreas Antonopoulos** - Bitcoin educator\n`;
                    newsInfo += `• **Raoul Pal** - Macro investor, crypto bull\n`;
                    newsInfo += `• **PlanB** - Stock-to-Flow model creator\n`;
                    newsInfo += `• **Willy Woo** - On-chain analyst\n\n`;
                    newsInfo += `**Popular Trading Platforms & DeFi Protocols:**\n`;
                    newsInfo += `• **Hyperliquid** - Decentralized perpetual exchange for crypto derivatives\n`;
                    newsInfo += `• **Uniswap** - Leading decentralized exchange (DEX)\n`;
                    newsInfo += `• **dYdX** - Decentralized derivatives trading platform\n`;
                    newsInfo += `• **GMX** - Decentralized spot and perpetual exchange\n`;
                    newsInfo += `• **Gains Network** - Decentralized leveraged trading platform\n`;
                    newsInfo += `• **Aster** - A decentralized finance (DeFi) protocol\n\n`;
                    newsInfo += `**Common Crypto Terms:**\n`;
                    newsInfo += `• **DeFi** - Decentralized Finance protocols\n`;
                    newsInfo += `• **NFT** - Non-Fungible Tokens\n`;
                    newsInfo += `• **DAO** - Decentralized Autonomous Organization\n`;
                    newsInfo += `• **Yield Farming** - Earning rewards by providing liquidity\n`;
                    newsInfo += `• **Staking** - Locking crypto to earn rewards\n`;
                    newsInfo += `• **Perpetuals** - Futures contracts without expiration\n`;
                    newsInfo += `• **DEX** - Decentralized Exchange\n`;
                    searchResults.push(newsInfo);
                }
            } catch (apiError) {
                console.log('Crypto news API error:', apiError.message);
            }
            
            return searchResults.join('\n\n');
            
        } catch (error) {
            console.error('Web search error:', error);
            return 'Unable to fetch current information at this time.';
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
const bot = new SimpleMentionBot();
bot.start().catch(console.error); 