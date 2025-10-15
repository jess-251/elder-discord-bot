require('dotenv').config();

const { Client, GatewayIntentBits, Partials, EmbedBuilder, AttachmentBuilder, ChannelType } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const http = require('http');
const admin = require('firebase-admin');

class MentionBot {
	constructor() {
		// Set up Discord client with necessary intents and partials for DMs
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.DirectMessages
			],
			partials: [
				Partials.Channel, // Required for DM support
				Partials.Message
			]
		});

		// Initialize OpenAI
		this.openai = new OpenAI({
			apiKey: process.env.OPENAI_API_KEY
		});

		// Initialize Firebase Admin for trading signals notifications
		try {
			const serviceAccount = require('./service-account-key.json');
			admin.initializeApp({
				credential: admin.credential.cert(serviceAccount)
			});
			this.firestore = admin.firestore();
			console.log('✅ Firebase Admin initialized');
		} catch (error) {
			console.error('⚠️  Firebase Admin initialization failed:', error.message);
			this.firestore = null;
		}

		// Store documents per channel
		this.channelDocuments = new Map();
		
		// Set up database and event handlers
		this.initDatabase();
		this.setupEventHandlers();
		this.setupNotificationListener();
	}

	/**
	 * Initialize SQLite database for storing documents and conversation history
	 */
	async initDatabase() {
		this.db = new sqlite3.Database('./mention_bot.db');
		
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
		this.client.on('ready', () => {
			console.log(`✅ Bot logged in as ${this.client.user.tag}`);
			console.log(`🤖 Mention me with @${this.client.user.username} to ask questions!`);
			console.log(`💬 Or DM me directly for private conversations!`);
			console.log('💾 To save files under a memory label: attach files and write "remember as <label>"');
			console.log('🔎 To query a memory label: "@Bot using <label> <your question>"');
			console.log('🌐 Ask for real-time info: "@Bot what\'s the latest on [topic]" or "@Bot current news about [topic]"');
		});

		this.client.on('messageCreate', async (message) => {
			// Debug: Log all messages
			console.log(`📝 Message received: "${message.content}" from ${message.author.username} in channel type: ${message.channel.type}, guild: ${message.guild ? message.guild.name : 'None'}`);
			
			// Ignore messages from bots
			if (message.author.bot) {
				console.log('🤖 Ignoring bot message');
				return;
			}

			// Handle DMs (Direct Messages) - Multiple detection methods
			const isDM = message.channel.type === ChannelType.DM || 
						message.channel.type === 1 || 
						!message.guild ||
						message.channel.type === 'DM';
			
			if (isDM) {
				console.log('📨 DM detected! Processing...');
				await this.handleDM(message);
				return;
			}

			// Check if bot is mentioned in guild channels
			if (message.mentions.users.has(this.client.user.id)) {
				console.log('👋 Mention detected in guild channel');
				await this.handleMention(message);
			}
		});

		this.client.on('error', (error) => {
			console.error('Discord client error:', error);
		});
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
				await message.reply('👋 Mention me with a question, or attach files and say "remember as <label>". To query a label, say "using <label> <question>". For real-time info, ask "what\'s the latest on [topic]" or "current news about [topic]".');
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

	// Check for recent trading signals notification
	let notificationContext = '';
	if (this.firestore) {
		try {
			const notifDoc = await this.firestore.collection('sentNotifications').doc(message.author.id).get();
			if (notifDoc.exists) {
				const notifData = notifDoc.data();
				const notifTime = notifData.timestamp?.toDate?.() || new Date(0);
				const timeSince = Date.now() - notifTime.getTime();
				const minutesAgo = Math.floor(timeSince / 60000);
				
				if (timeSince < 3600000) { // Within last hour
					notificationContext = `\n\n🔔 IMPORTANT - RECENT NOTIFICATION (${minutesAgo} min ago):\nYou recently sent this user a trading signals update:\n${notifData.changes.join('\n')}\n\nIf they ask about "this", "the update", or "explain this", they mean the notification above.`;
				}
			}
		} catch (error) {
			console.error('Error fetching notification:', error);
		}
	}

	// Only get documents if user is asking to use a specific label
	let documents = [];
	if (label) {
		// User is asking to use a specific memory label
		documents = await this.getChannelDocumentsByLabel(message.channel.id, label);
	}
	// If no label specified, don't load any documents - just do web search
	
	// Generate response using AI
	const response = await this.generateResponse(question, documents, message.channel.id, label, notificationContext);
		
		// Save conversation to database
		await this.saveConversation(message.channel.id, message.author.id, label ? `[${label}] ${question}` : question, response);

		// Split response into chunks if needed (Discord embed limit is 4096 chars)
		const chunks = this.splitIntoEmbedChunks(response);
		
		// Send first chunk as reply
		const firstEmbed = new EmbedBuilder()
			.setColor('#0099ff')
			.setTitle('🥷 Elder')
			.setDescription(chunks[0])
			.setFooter({ text: `Asked by ${message.author.username}${label ? ` • using ${label}` : ''}${chunks.length > 1 ? ` • Part 1/${chunks.length}` : ''}` })
			.setTimestamp();

		await message.reply({ embeds: [firstEmbed] });

		// Send remaining chunks as follow-up messages
		for (let i = 1; i < chunks.length; i++) {
			const followUpEmbed = new EmbedBuilder()
				.setColor('#0099ff')
				.setDescription(chunks[i])
				.setFooter({ text: `Part ${i + 1}/${chunks.length}` });
			
			await message.channel.send({ embeds: [followUpEmbed] });
		}

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
				try {
					await message.reply('✅ DM working! Bot is responding to your direct message.');
					console.log('✅ Successfully sent DM response');
				} catch (error) {
					console.error('❌ Failed to send DM response:', error);
					// Try sending a regular message instead
					try {
						await message.channel.send('✅ DM working! Bot is responding to your direct message.');
					} catch (sendError) {
						console.error('❌ Failed to send message to DM channel:', sendError);
					}
				}
				return;
			}
			
			const label = this.parseLabel(message.content);
			const question = this.cleanQuestion(message.content, this.client.user.id);
			
			if (!question && message.attachments.size === 0) {
				await message.reply('👋 Hi! You can ask me questions directly here, or attach files and say "remember as <label>". To query a label, say "using <label> <question>". For real-time info, ask "what\'s the latest on [topic]" or "current news about [topic]".');
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

	// Check for recent trading signals notification
	let notificationContext = '';
	if (this.firestore) {
		try {
			const notifDoc = await this.firestore.collection('sentNotifications').doc(message.author.id).get();
			if (notifDoc.exists) {
				const notifData = notifDoc.data();
				const notifTime = notifData.timestamp?.toDate?.() || new Date(0);
				const timeSince = Date.now() - notifTime.getTime();
				const minutesAgo = Math.floor(timeSince / 60000);
				
				if (timeSince < 3600000) { // Within last hour
					notificationContext = `\n\n🔔 IMPORTANT - RECENT NOTIFICATION (${minutesAgo} min ago):\nYou recently sent this user a trading signals update:\n${notifData.changes.join('\n')}\n\nIf they ask about "this", "the update", or "explain this", they mean the notification above.`;
				}
			}
		} catch (error) {
			console.error('Error fetching notification:', error);
		}
	}

	// Only get documents if user is asking to use a specific label
	let documents = [];
	if (label) {
		// User is asking to use a specific memory label
		documents = await this.getChannelDocumentsByLabel(message.channel.id, label);
	}
	// If no label specified, don't load any documents - just do web search
	
	// Generate response using AI
	const response = await this.generateResponse(question, documents, message.channel.id, label, notificationContext);
		
		// Save conversation to database
		await this.saveConversation(message.channel.id, message.author.id, label ? `[${label}] ${question}` : question, response);

		// Split response into chunks if needed (Discord embed limit is 4096 chars)
		const chunks = this.splitIntoEmbedChunks(response);
		
		// Send first chunk as reply
		const firstEmbed = new EmbedBuilder()
			.setColor('#0099ff')
			.setTitle('🥷 Elder')
			.setDescription(chunks[0])
			.setFooter({ text: `Asked by ${message.author.username}${label ? ` • using ${label}` : ''}${chunks.length > 1 ? ` • Part 1/${chunks.length}` : ''}` })
			.setTimestamp();

		await message.reply({ embeds: [firstEmbed] });

		// Send remaining chunks as follow-up messages
		for (let i = 1; i < chunks.length; i++) {
			const followUpEmbed = new EmbedBuilder()
				.setColor('#0099ff')
				.setDescription(chunks[i])
				.setFooter({ text: `Part ${i + 1}/${chunks.length}` });
			
			await message.channel.send({ embeds: [followUpEmbed] });
		}

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
	 * Perform web search for real-time information using Tavily API
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
			
			// Use Tavily API for web search
			if (process.env.TAVILY_API_KEY) {
				try {
					console.log('🔎 Using Tavily API for search...');
					const tavilyResponse = await fetch('https://api.tavily.com/search', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json'
						},
						body: JSON.stringify({
							api_key: process.env.TAVILY_API_KEY,
							query: query,
							search_depth: 'advanced',  // Changed to advanced for deeper search
							include_answer: true,
							include_images: false,
							include_raw_content: false,
							max_results: 10,  // Increased to get more sources
							include_domains: [],
							exclude_domains: []
						})
					});
					
					const tavilyData = await tavilyResponse.json();
					console.log('📊 Tavily API response received:', JSON.stringify(tavilyData).substring(0, 500));
					
					// Build comprehensive search results
					let detailedResults = '';
					
					if (tavilyData.results && tavilyData.results.length > 0) {
						// Include ALL content from search results for the AI to analyze
						detailedResults += '**📚 Detailed Information from Web Sources:**\n\n';
						tavilyData.results.forEach((result, index) => {
							detailedResults += `**Source ${index + 1}: ${result.title}**\n`;
							detailedResults += `${result.content}\n`;
							detailedResults += `URL: ${result.url}\n\n`;
						});
						detailedResults += `---\n\n`;
					}
					
					if (tavilyData.answer) {
						detailedResults += `**AI Summary:**\n${tavilyData.answer}\n\n`;
					}
					
					if (detailedResults.trim()) {
						searchResults = detailedResults + `*Data gathered from ${tavilyData.results?.length || 0} web sources - ${new Date().toLocaleString()}*`;
						console.log('✅ Tavily advanced search successful with', tavilyData.results?.length, 'sources');
						return searchResults;
					}
				} catch (tavilyError) {
					console.log('❌ Tavily API search failed:', tavilyError.message);
					// Continue to fallback
				}
			} else {
				console.log('⚠️  TAVILY_API_KEY not set, skipping Tavily search');
			}
			
			// Try DuckDuckGo Instant Answer API as backup
			try {
				const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
				console.log(`📡 Trying DuckDuckGo fallback...`);
				const response = await fetch(searchUrl);
				const data = await response.json();
				
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
					console.log('✅ Found search results from DuckDuckGo');
					return searchResults;
				}
			} catch (ddgError) {
				console.log('❌ DuckDuckGo search failed:', ddgError.message);
			}
			
			// Final fallback - be honest about limitations
			console.log('⚠️  All search methods failed, returning limitation notice');
			return `**⚠️ Search Unavailable:**\n\nI wasn't able to retrieve current information about "${query}" at this time. This could be because:\n\n• The Tavily API key is not configured (required for web search)\n• The topic is very recent or specialized\n• Search services are temporarily unavailable\n\n**To enable real-time web search:**\n1. Get a free API key from https://tavily.com\n2. Add it to your .env file as TAVILY_API_KEY\n\n**For now, please:**\n• Check recent news sources directly\n• Try rephrasing your question\n• Ask about topics I can help with from my training data\n\n*Last updated: ${new Date().toLocaleString()}*`;
			
		} catch (error) {
			console.error('❌ Web search error:', error);
			return `I encountered an error while searching for current information about "${query}". Please try again or check recent news sources directly.`;
		}
	}

	/**
	 * Generate AI response using OpenAI
	 */
	async generateResponse(question, documents, channelId, label, notificationContext = '') {
		try {
			if (documents.length > 0) {
				// For document-based queries, use uploaded documents
				let systemPrompt = `You are a helpful AI assistant. Answer clearly and concisely using the provided documents.${notificationContext}`;
				let contextInfo = `\n\nYou have access to the following ${label ? `memory set \"${label}\"` : 'documents'} for context. Quote relevant excerpts and be precise.\n\n`;
				
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
			const systemPrompt = `You are Elder, a highly knowledgeable AI assistant with access to live web search results.${notificationContext} The user is asking: "${question}"

=== LIVE WEB SEARCH RESULTS ===
${searchResults}
=== END SEARCH RESULTS ===

CRITICAL INSTRUCTIONS FOR SYNTHESIS:
1. **READ AND ANALYZE ALL SOURCES ABOVE** - Don't just skim, deeply analyze every piece of information
2. **EXTRACT SPECIFIC DETAILS** - Pull out exact facts, numbers, dates, names, events, and context
3. **STRUCTURE YOUR ANSWER** - Create clear sections addressing each part of the user's question
4. **BE COMPREHENSIVE** - Combine information from multiple sources to give a complete picture
5. **QUOTE KEY INFORMATION** - When sources provide important details, reference or quote them
6. **SHOW YOUR WORK** - Demonstrate you've read the sources by using specific information from them
7. **DO NOT BE VAGUE** - Instead of "faced challenges," say WHAT challenges and WHEN
8. **DO NOT SAY** "search results don't provide details" unless info is truly absent across ALL sources
9. **IF INFO IS LIMITED** - Say what you DO know, then acknowledge what's unclear
10. **INCLUDE CONTEXT** - Provide background, implications, and related information

Format: Use clear headers, bullet points, and organize by topic. Make it easy to read and informative.
Goal: Provide a thorough, detailed answer that shows deep analysis of all available sources.`;

			const completion = await this.openai.chat.completions.create({
				model: 'gpt-4o',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: question }
				],
				max_tokens: 2000,  // Increased for more detailed responses
				temperature: 0.3   // Lower for more factual, focused responses
			});

			const response = completion.choices[0].message.content;
			return this.truncateToCharacterLimit(response, 3500);  // Increased character limit
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
	 * Split long text into chunks that fit in Discord embeds (max 4096 chars per embed description)
	 */
	splitIntoEmbedChunks(text, maxLength = 4000) {
		if (text.length <= maxLength) {
			return [text];
		}

		const chunks = [];
		let remaining = text;

		while (remaining.length > 0) {
			if (remaining.length <= maxLength) {
				chunks.push(remaining);
				break;
			}

			// Find a good break point (sentence or paragraph)
			let breakPoint = maxLength;
			const substring = remaining.substring(0, maxLength);
			
			// Try to break at paragraph
			const lastParagraph = substring.lastIndexOf('\n\n');
			if (lastParagraph > maxLength * 0.5) {
				breakPoint = lastParagraph + 2;
			} else {
				// Try to break at sentence
				const lastSentence = Math.max(
					substring.lastIndexOf('. '),
					substring.lastIndexOf('! '),
					substring.lastIndexOf('? ')
				);
				if (lastSentence > maxLength * 0.5) {
					breakPoint = lastSentence + 2;
				} else {
					// Break at word boundary
					const lastSpace = substring.lastIndexOf(' ');
					if (lastSpace > maxLength * 0.7) {
						breakPoint = lastSpace + 1;
					}
				}
			}

			chunks.push(remaining.substring(0, breakPoint));
			remaining = remaining.substring(breakPoint);
		}

		return chunks;
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
	 * Set up Firestore listener for trading signals notifications
	 */
	setupNotificationListener() {
		if (!this.firestore) {
			console.log('⚠️  Firestore not initialized, notifications disabled');
			return;
		}

		console.log('👂 Listening for trading signals notifications...');
		
		this.firestore.collection('notifications').onSnapshot(async (snapshot) => {
			snapshot.docChanges().forEach(async (change) => {
				if (change.type === 'added') {
					const notification = change.doc.data();
					
					if (notification.type === 'signal_update' && !notification.sent) {
						console.log('🔔 New signal update notification received');
						await this.sendNotificationsToUsers(notification);
						
						// Delete the notification after sending
						await this.firestore.collection('notifications').doc(change.doc.id).delete();
						console.log('🗑️  Notification deleted:', change.doc.id);
					}
				}
			});
		}, (error) => {
			console.error('❌ Firestore listener error:', error);
		});
	}

	/**
	 * Send trading signals notifications to all users with Discord IDs
	 */
	async sendNotificationsToUsers(notification) {
		try {
			// Get all users with Discord IDs
			const usersSnapshot = await this.firestore.collection('users').get();
			
			const changes = notification.changes || [];
			const updatedBy = notification.updatedBy || 'Admin';
			
			// Create embed message
			const embed = new EmbedBuilder()
				.setTitle('🔔 Trading Signals Updated')
				.setDescription(changes.length > 0 ? changes.join('\n') : 'Signals have been updated')
				.setColor(0x3447ff)
				.setTimestamp()
				.setFooter({ text: `Updated by ${updatedBy}` });
			
			let sentCount = 0;
			let failedCount = 0;
			
			// Send DM to each user with Discord ID
			for (const userDoc of usersSnapshot.docs) {
				const userData = userDoc.data();
				
				if (userData.discordId) {
					try {
						const user = await this.client.users.fetch(userData.discordId);
						await user.send({ embeds: [embed] });
						
						// Store notification in Firestore for "explain this" feature
						await this.firestore.collection('sentNotifications').doc(userData.discordId).set({
							changes: changes,
							timestamp: admin.firestore.FieldValue.serverTimestamp(),
							updatedBy: updatedBy
						});
						
						sentCount++;
						console.log(`✅ Sent notification to ${userDoc.id}`);
					} catch (error) {
						failedCount++;
						console.error(`❌ Failed to send to ${userDoc.id}:`, error.message);
					}
					
					// Rate limit protection (1 message per second)
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}
			
			console.log(`\n📊 Notification Summary:`);
			console.log(`   ✅ Sent: ${sentCount}`);
			console.log(`   ❌ Failed: ${failedCount}\n`);
			
		} catch (error) {
			console.error('❌ Error sending notifications:', error);
		}
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
	res.end('🥷 Elder Discord Bot is running!');
});

server.listen(port, () => {
	console.log(`🌐 Web server running on port ${port}`);
	
	// Start the Discord bot after web server is ready
const bot = new MentionBot();
bot.start().catch(console.error); 
}); 