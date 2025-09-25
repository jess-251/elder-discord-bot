require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const pdfParse = require('pdf-parse');
const axios = require('axios');

class MentionBotAutoSave {
	constructor() {
		// Set up Discord client with necessary intents (NO DMs)
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildMessageReactions
			],
			// Connection stability settings
			rest: {
				timeout: 30000,
				retries: 3
			},
			ws: {
				large_threshold: 250,
				compress: true
			}
		});

		// Initialize OpenAI
		this.openai = new OpenAI({
			apiKey: process.env.OPENAI_API_KEY
		});

		// Store documents per channel
		this.channelDocuments = new Map();
		
		// Track processed messages to prevent duplicates
		this.processedMessages = new Set();
		
		// Store recent chart analyses for context
		this.chartContext = new Map(); // channelId -> array of recent chart analyses
		
		// Set up database and event handlers
		this.initDatabase();
		this.setupEventHandlers();
	}

	/**
	 * Initialize SQLite database for storing documents
	 */
	async initDatabase() {
		this.db = new sqlite3.Database('./mention_bot_auto_save.db');
		
		// Create documents table
		await promisify(this.db.run.bind(this.db))(`
			CREATE TABLE IF NOT EXISTS documents (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				channel_id TEXT NOT NULL,
				filename TEXT NOT NULL,
				content TEXT NOT NULL,
				uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Create conversations table
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
			console.log(`💾 Attach files when mentioning me to automatically save them!`);
			console.log(`📄 I can process text files, PDFs, and images!`);
			console.log(`🔍 I can analyze charts, diagrams, and images using GPT-4o!`);
		});

		this.client.on('messageCreate', async (message) => {
			// Ignore messages from bots (including itself)
			if (message.author.bot) return;

			// Check if bot is mentioned
			const isMentioned = message.mentions.users.has(this.client.user.id);
			
			if (isMentioned) {
				// Create unique message ID to prevent duplicate processing
				const messageId = `${message.id}-${message.author.id}-${Date.now()}`;
				
				// Check if we've already processed this message
				if (this.processedMessages.has(messageId)) {
					return;
				}
				
				// Mark message as processed
				this.processedMessages.add(messageId);
				
				// Clean up old processed messages (keep only last 100)
				if (this.processedMessages.size > 100) {
					const firstMessage = this.processedMessages.values().next().value;
					this.processedMessages.delete(firstMessage);
				}
				
				await this.handleMention(message);
			}
		});

		this.client.on('error', (error) => {
			console.error('Discord client error:', error);
		});

		this.client.on('disconnect', () => {
			console.log('🔌 Bot disconnected from Discord');
		});

		this.client.on('reconnecting', () => {
			console.log('🔄 Bot reconnecting to Discord...');
		});

		this.client.on('resume', () => {
			console.log('✅ Bot reconnected to Discord');
		});
	}

	/**
	 * Handle when the bot is mentioned
	 */
	async handleMention(message) {
		try {
			console.log(`🎯 HandleMention called with: "${message.content}"`);
			const question = this.cleanQuestion(message.content, this.client.user.id);
			console.log(`🧹 Cleaned question: "${question}"`);
			
			// Check for image generation requests and respond appropriately
			if (this.isImageGenerationRequest(question)) {
				await message.reply('Sorry, I do not create or generate images.');
				return;
			}

			// If there are attachments, process them (files or images)
			if (message.attachments.size > 0) {
				console.log(`📎 Processing ${message.attachments.size} attachment(s)`);
				
				// Check if this is a prediction request with attachments
				if (this.isPredictionRequest(question)) {
					console.log(`🎯 Prediction request with attachments detected!`);
					await this.handlePredictionWithAttachments(message, question);
					return;
				} else {
					// For non-prediction questions with attachments, answer the question using the attachment as context
					await this.handleQuestionWithAttachments(message, question);
					return;
				}
			}

			// Check for prediction requests and handle with chart context (no attachments)
			if (this.isPredictionRequest(question)) {
				console.log(`🎯 Prediction request detected: "${question}"`);
				await this.handlePredictionRequest(message, question);
				return;
			} else {
				console.log(`❌ Not a prediction request: "${question}"`);
				console.log(`❌ Going to regular analysis instead`);
			}

			// Always respond, even if no question
			if (!question) {
				await message.reply('👋 Hi! I\'m your AI assistant. Ask me anything or attach files to save them!');
				return;
			}

			// Show typing indicator
			await message.channel.sendTyping();

			// Get all documents from this channel
			const documents = await this.getChannelDocuments(message.channel.id);
			
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
			await message.channel.send('❌ Sorry, I encountered an error while processing your request.');
		}
	}

	/**
	 * Handle attachments - process both text files and images
	 */
	async handleAttachments(message) {
		try {
			const savedFiles = [];
			const imageAnalysis = [];
			
			for (const attachment of message.attachments.values()) {
				// Handle text files
				if (attachment.contentType && attachment.contentType.startsWith('text/')) {
					try {
						const response = await fetch(attachment.url);
						const content = await response.text();
						
						// Save to database
						await this.saveDocument(message.channel.id, attachment.name, content);
						savedFiles.push(attachment.name);
						
						console.log(`✅ Saved file: ${attachment.name} in channel ${message.channel.id}`);
					} catch (error) {
						console.error(`❌ Failed to save file ${attachment.name}:`, error);
					}
				}
				// Handle PDF files
				else if (attachment.contentType === 'application/pdf') {
					try {
						console.log(`📄 Processing PDF: ${attachment.name}`);
						
						const response = await fetch(attachment.url);
						const buffer = await response.arrayBuffer();
						const pdfData = await pdfParse(Buffer.from(buffer));
						
						// Save PDF text content to database
						await this.saveDocument(message.channel.id, attachment.name, pdfData.text);
						savedFiles.push(attachment.name);
						
						console.log(`✅ Saved PDF: ${attachment.name} in channel ${message.channel.id}`);
					} catch (error) {
						console.error(`❌ Failed to process PDF ${attachment.name}:`, error);
					}
				}
				// Handle images (charts, diagrams, etc.)
				else if (attachment.contentType && attachment.contentType.startsWith('image/')) {
					try {
						console.log(`🔍 Analyzing image: ${attachment.name}`);
						
						// Analyze image using OpenAI Vision
						const analysis = await this.analyzeImage(attachment.url, attachment.name, message.channel.id);
						imageAnalysis.push({
							name: attachment.name,
							analysis: analysis
						});
						
						console.log(`✅ Analyzed image: ${attachment.name}`);
					} catch (error) {
						console.error(`❌ Failed to analyze image ${attachment.name}:`, error);
						imageAnalysis.push({
							name: attachment.name,
							analysis: '❌ Failed to analyze this image.'
						});
					}
				}
			}
			
			// Send response for saved files
			if (savedFiles.length > 0) {
				const fileList = savedFiles.map(name => `• ${name}`).join('\n');
				await message.reply(`💾 **Files automatically saved!**\n\n${fileList}\n\nNow you can ask me questions about these files!`);
			}
			
			// Send response for image analysis
			if (imageAnalysis.length > 0) {
				for (const img of imageAnalysis) {
					const embed = new EmbedBuilder()
						.setColor('#00ff00')
						.setTitle(`🔍 Image Analysis: ${img.name}`)
						.setDescription(img.analysis)
						.setTimestamp();
					
					await message.channel.send({ embeds: [embed] });
				}
			}
			
			// If no supported files found
			if (savedFiles.length === 0 && imageAnalysis.length === 0) {
				await message.reply('❌ No supported files found. I can process:\n• Text files (.txt, .md, .js, etc.)\n• PDF files (.pdf)\n• Images (charts, diagrams, screenshots)');
			}
			
		} catch (error) {
			console.error('Error handling attachments:', error);
			await message.channel.send('❌ Sorry, I encountered an error while processing the attachments.');
		}
	}

	/**
	 * Analyze images using OpenAI Vision API with enhanced chart analysis
	 */
	async analyzeImage(imageUrl, filename, channelId) {
		try {
			console.log(`🔍 Starting enhanced image analysis for: ${filename}`);
			
			const response = await this.openai.chat.completions.create({
				model: "gpt-4o",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: `Please analyze this image in detail. If it's a chart, diagram, or graph, provide a comprehensive analysis including:

1. **Data Description**: What type of data is being shown (prices, sales, performance, etc.)
2. **Time Period**: What time frame does this cover
3. **Trends**: Identify key trends, patterns, and movements
4. **Key Levels**: Important support/resistance levels, peaks, valleys
5. **Insights**: What this data suggests about the underlying subject
6. **Chart Type**: What kind of chart/graph this is

If it's not a chart, describe what you see and any important details. Be thorough and analytical.`
							},
							{
								type: "image_url",
								image_url: {
									url: imageUrl
								}
							}
						]
					}
				],
				max_tokens: 1500
			});
			
			const analysis = response.choices[0].message.content;
			console.log(`✅ Enhanced image analysis completed for: ${filename}`);
			
			// Store chart analysis in context for future reference
			this.storeChartContext(channelId, filename, analysis, imageUrl);
			
			return analysis;
			
		} catch (error) {
			console.error(`❌ Error analyzing image ${filename}:`, error);
			throw error;
		}
	}

	/**
	 * Remove mention from user text to form the clean question
	 */
	cleanQuestion(rawText, botId) {
		if (!rawText) return '';
		return rawText.replace(new RegExp(`<@${botId}>`,'g'), '').trim();
	}

	/**
	 * Save document to database
	 */
	async saveDocument(channelId, filename, content) {
		return promisify(this.db.run.bind(this.db))(
			'INSERT INTO documents (channel_id, filename, content) VALUES (?, ?, ?)',
			[channelId, filename, content]
		);
	}

	/**
	 * Get all documents from a channel
	 */
	async getChannelDocuments(channelId) {
		return promisify(this.db.all.bind(this.db))(
			'SELECT * FROM documents WHERE channel_id = ? ORDER BY uploaded_at DESC',
			[channelId]
		);
	}

	/**
	 * Save conversation to database
	 */
	async saveConversation(channelId, userId, question, answer) {
		return promisify(this.db.run.bind(this.db))(
			'INSERT INTO conversations (channel_id, user_id, question, answer) VALUES (?, ?, ?, ?)',
			[channelId, userId, question, answer]
		);
	}

	/**
	 * Generate AI response using OpenAI
	 */
	async generateResponse(question, documents, channelId) {
		try {
			let context = '';
			let webSearchInfo = '';
			
			// Always try web search first for current information
			console.log(`🌐 Always attempting web search for: "${question}"`);
			webSearchInfo = await this.performWebSearch(question);
			console.log(`🌐 Web search result: ${webSearchInfo ? 'SUCCESS' : 'FAILED'}`);
			if (webSearchInfo) {
				context += `\n\n**Current Information from Web:**\n${webSearchInfo}\n`;
				console.log(`🌐 Added web search context to response`);
			}
			
			// Add file context if available
			if (documents && documents.length > 0) {
				context += `\n\n**Context from saved files in this channel:**\n`;
				documents.forEach((doc, index) => {
					context += `\n**File ${index + 1}: ${doc.filename}**\n${doc.content.substring(0, 1000)}${doc.content.length > 1000 ? '...' : ''}\n`;
				});
			}

			const prompt = `You are a helpful AI assistant. Answer the following question based on the context provided. 

PRIORITY ORDER:
1. Use "Current Information from Web" if available (most current/accurate)
2. Use "Context from saved files" if relevant to the question
3. Use your general knowledge as fallback

IMPORTANT: Always provide a comprehensive answer. If web information is provided, use it. If file context is provided and relevant, use it. Never say "I don't have information" - always provide the best answer possible.

Question: ${question}${context}

Answer:`;

			const completion = await this.openai.chat.completions.create({
				model: 'gpt-4o',
				messages: [
					{
						role: 'system',
						content: 'You are a helpful AI assistant. Always provide comprehensive answers using available information. Priority: 1) Web information (most current), 2) File context (if relevant), 3) General knowledge. Never say you don\'t have information - always give the best possible answer.'
					},
					{
						role: 'user',
						content: prompt
					}
				],
				max_tokens: 1500, // Increased for web search responses
				temperature: 0.7
			});

			return completion.choices[0].message.content;
		} catch (error) {
			console.error('OpenAI API error:', error);
			return '❌ Sorry, I encountered an error while generating a response. Please try again.';
		}
	}

	/**
	 * Check if a question needs web search for current information
	 */
	needsWebSearch(question) {
		const lowerQuestion = question.toLowerCase();
		
		// Keywords that indicate need for current/real-time information
		const webSearchKeywords = [
			'current price', 'latest price', 'live price', 'real time',
			'current news', 'latest news', 'recent news', 'today',
			'what happened', 'breaking', 'update', 'recent',
			'now', 'currently', 'right now', 'as of',
			'bitcoin price', 'btc price', 'ethereum price', 'eth price',
			'solana price', 'sol price', 'crypto price', 'cryptocurrency price',
			'market cap', 'trading volume', '24h change', 'price change',
			'top crypto news', 'crypto news', 'cryptocurrency news', 'news today',
			'what\'s happening', 'market news', 'crypto updates', 'latest developments',
			'developments', 'crypto developments', 'market developments', 'industry news',
			'popular crypto', 'crypto traders', 'famous traders', 'best traders',
			'who are', 'who is', 'most popular', 'top traders', 'crypto influencers',
			'what is', 'what are', 'explain', 'define', 'tell me about'
		];
		
		return webSearchKeywords.some(keyword => lowerQuestion.includes(keyword));
	}

	/**
	 * Perform web search for current information
	 */
	async performWebSearch(query) {
		try {
			console.log(`🔍 Performing web search for: "${query}"`);
			
			// Use a simple web search approach with multiple sources
			const searchResults = [];
			
			// Always try to get crypto prices and market data for any crypto-related question
			const isCryptoRelated = query.toLowerCase().includes('crypto') || query.toLowerCase().includes('bitcoin') || 
				query.toLowerCase().includes('btc') || query.toLowerCase().includes('ethereum') || 
				query.toLowerCase().includes('eth') || query.toLowerCase().includes('solana') || 
				query.toLowerCase().includes('sol') || query.toLowerCase().includes('defi') ||
				query.toLowerCase().includes('nft') || query.toLowerCase().includes('blockchain') ||
				query.toLowerCase().includes('trading') || query.toLowerCase().includes('price');
			
			// Search for crypto prices using CoinGecko API (free, no API key needed)
			if (isCryptoRelated) {
				
				try {
					const cryptoResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true');
					
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
						
						searchResults.push(cryptoInfo);
					}
				} catch (cryptoError) {
					console.log('Crypto API error:', cryptoError.message);
				}
			}
			
			// Always provide general crypto information for any question
			// This ensures we always have some context to work with
			try {
				// Try to get current crypto news from a free API
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
							newsInfo += `**For the latest news, check these real-time sources:**\n`;
							newsInfo += `• CoinDesk (coindesk.com) - Breaking crypto news\n`;
							newsInfo += `• CoinTelegraph (cointelegraph.com) - Market analysis\n`;
							newsInfo += `• CryptoSlate (cryptoslate.com) - Industry updates\n`;
							newsInfo += `• Decrypt (decrypt.co) - Technology focus\n\n`;
							newsInfo += `**Popular Crypto Traders & Influencers:**\n`;
							newsInfo += `• **Vitalik Buterin** - Ethereum co-founder\n`;
							newsInfo += `• **CZ (Changpeng Zhao)** - Binance founder\n`;
							newsInfo += `• **Michael Saylor** - MicroStrategy CEO, Bitcoin advocate\n`;
							newsInfo += `• **Elon Musk** - Tesla CEO, Dogecoin influencer\n`;
							newsInfo += `• **Andreas Antonopoulos** - Bitcoin educator\n`;
							newsInfo += `• **Raoul Pal** - Macro investor, crypto bull\n`;
							newsInfo += `• **PlanB** - Stock-to-Flow model creator\n`;
							newsInfo += `• **Willy Woo** - On-chain analyst\n\n`;
							newsInfo += `**Common Crypto Terms:**\n`;
							newsInfo += `• **Aster** - A decentralized finance (DeFi) protocol\n`;
							newsInfo += `• **DeFi** - Decentralized Finance protocols\n`;
							newsInfo += `• **NFT** - Non-Fungible Tokens\n`;
							newsInfo += `• **DAO** - Decentralized Autonomous Organization\n`;
							newsInfo += `• **Yield Farming** - Earning rewards by providing liquidity\n`;
							newsInfo += `• **Staking** - Locking crypto to earn rewards\n`;
							searchResults.push(newsInfo);
						}
					} catch (apiError) {
						console.log('Crypto news API error:', apiError.message);
						// Fallback to basic news info
						const newsInfo = '**Current Crypto News:**\nFor the most up-to-date cryptocurrency news, I recommend checking these real-time sources:\n\n• **CoinDesk** (coindesk.com) - Breaking crypto news and market analysis\n• **CoinTelegraph** (cointelegraph.com) - Comprehensive crypto coverage\n• **CryptoSlate** (cryptoslate.com) - Industry updates and trends\n• **Decrypt** (decrypt.co) - Technology and DeFi focus\n• **The Block** (theblock.co) - Institutional crypto news\n\nThese sources provide real-time updates on market movements, regulatory developments, and major announcements.';
						searchResults.push(newsInfo);
					}
				} catch (newsError) {
					console.log('News search error:', newsError.message);
				}
			} catch (error) {
				console.log('General search error:', error.message);
			}
			
			return searchResults.join('\n\n');
			
		} catch (error) {
			console.error('Web search error:', error);
			return 'Unable to fetch current information at this time.';
		}
	}

	/**
	 * Store chart analysis in context for future reference
	 */
	storeChartContext(channelId, filename, analysis, imageUrl) {
		if (!this.chartContext.has(channelId)) {
			this.chartContext.set(channelId, []);
		}
		
		const charts = this.chartContext.get(channelId);
		charts.push({
			filename,
			analysis,
			imageUrl,
			timestamp: Date.now()
		});
		
		// Keep only the last 10 charts per channel
		if (charts.length > 10) {
			charts.shift();
		}
		
		console.log(`📊 Stored chart context for ${filename} in channel ${channelId}`);
	}

	/**
	 * Check if the request is for image generation
	 */
	isImageGenerationRequest(question) {
		const imageKeywords = [
			'generate image', 'create image', 'make image', 'draw image',
			'generate a', 'create a', 'make a', 'draw a',
			'image of', 'picture of', 'photo of',
			'dalle', 'dall-e', 'dall e', 'create chart', 'make diagram',
			'draw chart', 'create graph', 'make illustration'
		];
		
		const lowerQuestion = question.toLowerCase();
		return imageKeywords.some(keyword => lowerQuestion.includes(keyword));
	}

	/**
	 * Check if the request is for price prediction or chart analysis
	 */
	isPredictionRequest(question) {
		const lowerQuestion = question.toLowerCase();
		
		// General technical analysis questions that don't need charts
		const generalTechnicalQuestions = [
			'what is', 'what are', 'what does', 'what means', 'what means',
			'explain', 'define', 'definition', 'describe', 'tell me about',
			'how does', 'how do', 'how to', 'how can', 'how should',
			'what pattern', 'what patterns', 'what indicator', 'what indicators',
			'hit rate', 'success rate', 'accuracy', 'reliability'
		];
		
		// Check if it's a general technical question (don't trigger prediction)
		const isGeneralQuestion = generalTechnicalQuestions.some(keyword => lowerQuestion.includes(keyword));
		if (isGeneralQuestion) {
			console.log(`🔍 General technical question detected: "${question}" -> Not a prediction request`);
			return false;
		}
		
		// Chart-specific prediction keywords
		const predictionKeywords = [
			'predict', 'prediction', 'forecast', 'future price', 'price prediction',
			'where will', 'what will', 'price target', 'where do you think',
			'lands by', 'reach by', 'will be', 'price will be',
			'will reach', 'going to be', 'expect', 'projection', 'estimate',
			'think', 'believe', 'guess', 'opinion', 'view',
			'what\'s better', 'which is better', 'compare', 'comparison'
		];
		
		const hasKeyword = predictionKeywords.some(keyword => lowerQuestion.includes(keyword));
		
		// Also check for specific patterns with price and time
		const hasPricePattern = /\$\d+|\d+\$|price|sol|bitcoin|btc|ethereum|eth|hype/i.test(question);
		const hasTimePattern = /2026|2025|2024|end of|by end|next year|future/i.test(question);
		const hasChartPattern = /chart|graph|diagram|pattern|trend|technical/i.test(question);
		
		console.log(`🔍 Prediction check: "${question}" -> Keywords: ${hasKeyword}, Price: ${hasPricePattern}, Time: ${hasTimePattern}, Chart: ${hasChartPattern}`);
		
		// Only trigger prediction for specific prediction requests, not general technical questions
		return hasKeyword || (hasChartPattern && (hasPricePattern || hasTimePattern));
	}

	/**
	 * Handle questions with attachments (answer question using attachment as context)
	 */
	async handleQuestionWithAttachments(message, question) {
		try {
			console.log(`❓ Handling question with attachments: "${question}"`);
			
			// Show typing indicator
			await message.channel.sendTyping();
			
			// Get all image attachments
			const imageAttachments = Array.from(message.attachments.values())
				.filter(attachment => attachment.contentType && attachment.contentType.startsWith('image/'));
			
			// Get all text/PDF attachments
			const textAttachments = Array.from(message.attachments.values())
				.filter(attachment => 
					(attachment.contentType && attachment.contentType.startsWith('text/')) ||
					(attachment.contentType === 'application/pdf')
				);
			
			let response = '';
			
			// If there are images, use them to answer the question
			if (imageAttachments.length > 0) {
				console.log(`🔍 Using ${imageAttachments.length} image(s) to answer question`);
				
				// Build content array with text and all images
				const content = [
					{
						type: "text",
						text: `Look at these image(s) and answer this specific question: "${question}"

IMPORTANT: 
- Look at ALL the images provided below
- Answer the SPECIFIC question asked
- Base your analysis on what you actually see in these images
- Don't give generic image analysis unless specifically asked

Question: ${question}`
					}
				];
				
				// Add all images to the content
				imageAttachments.forEach((attachment, index) => {
					console.log(`🔍 Adding image ${index + 1}: ${attachment.name} - ${attachment.url}`);
					content.push({
						type: "image_url",
						image_url: {
							url: attachment.url
						}
					});
				});
				
				// Use OpenAI Vision API to answer the question
				const visionResponse = await this.openai.chat.completions.create({
					model: "gpt-4o",
					messages: [
						{
							role: "system",
							content: "You are an expert assistant. When users ask questions about images, you must: 1) Look at ALL images provided, 2) Answer their SPECIFIC question, 3) Base your analysis on what you actually see in the images, not generic responses."
						},
						{
							role: "user",
							content: content
						}
					],
					max_tokens: 2000,
					temperature: 0.7
				});
				
				response = visionResponse.choices[0].message.content;
			}
			
			// If there are text/PDF files, process them and use in response
			if (textAttachments.length > 0) {
				console.log(`📄 Processing ${textAttachments.length} text/PDF file(s)`);
				
				for (const attachment of textAttachments) {
					try {
						if (attachment.contentType && attachment.contentType.startsWith('text/')) {
							const response = await fetch(attachment.url);
							const content = await response.text();
							await this.saveDocument(message.channel.id, attachment.name, content);
						} else if (attachment.contentType === 'application/pdf') {
							const response = await fetch(attachment.url);
							const buffer = await response.arrayBuffer();
							const pdfData = await pdfParse(Buffer.from(buffer));
							await this.saveDocument(message.channel.id, attachment.name, pdfData.text);
						}
					} catch (error) {
						console.error(`❌ Failed to process file ${attachment.name}:`, error);
					}
				}
				
				// If we only have text files (no images), use regular AI response
				if (imageAttachments.length === 0) {
					const documents = await this.getChannelDocuments(message.channel.id);
					response = await this.generateResponse(question, documents, message.channel.id);
				}
			}
			
			// If no images or text files, use regular AI response
			if (imageAttachments.length === 0 && textAttachments.length === 0) {
				const documents = await this.getChannelDocuments(message.channel.id);
				response = await this.generateResponse(question, documents, message.channel.id);
			}
			
			// Send response
			const embed = new EmbedBuilder()
				.setColor('#0099ff')
				.setTitle('🥷 Elder')
				.setDescription(response)
				.setFooter({ text: `Asked by ${message.author.username}` })
				.setTimestamp();

			await message.reply({ embeds: [embed] });
			
		} catch (error) {
			console.error('Error handling question with attachments:', error);
			await message.channel.send('❌ Sorry, I encountered an error while processing your question. Please try again.');
		}
	}

	/**
	 * Handle prediction requests with attachments (analyze + predict in one response)
	 */
	async handlePredictionWithAttachments(message, question) {
		try {
			console.log(`🔮 Handling prediction request with attachments: "${question}"`);
			
			// Show typing indicator
			await message.channel.sendTyping();
			
			// Get all image attachments
			const imageAttachments = Array.from(message.attachments.values())
				.filter(attachment => attachment.contentType && attachment.contentType.startsWith('image/'));
			
			if (imageAttachments.length === 0) {
				await message.reply('No images found to analyze for predictions.');
				return;
			}
			
			console.log(`🔍 Found ${imageAttachments.length} image(s) to analyze`);
			
			// Build content array with text and all images
			const content = [
				{
					type: "text",
					text: `Look at these chart(s) and answer this specific question: "${question}"

IMPORTANT: 
- Look at ALL the charts provided below
- Answer the SPECIFIC question asked
- If asking about comparisons, compare ALL the charts provided
- If asking about predictions, give specific predictions for each chart
- Base your analysis on what you actually see in these charts
- Don't give generic chart analysis unless specifically asked

Question: ${question}`
				}
			];
			
			// Add all images to the content
			imageAttachments.forEach((attachment, index) => {
				console.log(`🔍 Adding image ${index + 1}: ${attachment.name} - ${attachment.url}`);
				content.push({
					type: "image_url",
					image_url: {
						url: attachment.url
					}
				});
			});
			
			// Use direct OpenAI Vision API call with multiple images
			const response = await this.openai.chat.completions.create({
				model: "gpt-4o",
				messages: [
					{
						role: "system",
						content: "You are an expert financial analyst. When users ask questions about charts, you must: 1) Look at ALL charts provided, 2) Answer their SPECIFIC question, 3) If they ask for comparisons, compare ALL the charts, 4) If they ask for predictions, give specific predictions for each chart. Always base your analysis on what you actually see in the charts, not generic responses."
					},
					{
						role: "user",
						content: content
					}
				],
				max_tokens: 3000, // Increased for multiple charts
				temperature: 0.7
			});

			console.log(`✅ OpenAI Vision API call successful!`);
			const prediction = response.choices[0].message.content;
			console.log(`✅ Prediction generated (${prediction.length} characters)`);
			
			// Send prediction directly
			await message.reply(prediction);
			
		} catch (error) {
			console.error('Error handling prediction with attachments:', error);
			console.error('Error details:', error.message);
			console.error('Stack trace:', error.stack);
			await message.channel.send('❌ Sorry, I encountered an error while generating the prediction. Please try again.');
		}
	}

	/**
	 * Handle prediction requests using stored chart context
	 */
	async handlePredictionRequest(message, question) {
		try {
			console.log(`🔮 Handling prediction request: "${question}"`);
			const channelId = message.channel.id;
			const charts = this.chartContext.get(channelId) || [];
			
			console.log(`📊 Charts in memory for channel ${channelId}: ${charts.length}`);
			
			if (charts.length === 0) {
				await message.reply('I don\'t have any charts in memory to make predictions about. Please upload a chart first, then ask me for predictions!');
				return;
			}
			
			// Show typing indicator
			await message.channel.sendTyping();
			
			// Build context from recent charts
			let chartContext = '';
			charts.forEach((chart, index) => {
				chartContext += `\n**Chart ${index + 1}: ${chart.filename}**\n${chart.analysis}\n`;
			});
			
			// Generate prediction response
			const predictionPrompt = `Based on the chart data provided, analyze the chart and provide a price prediction.

**User's Question:** ${question}

**Available Chart Data:**
${chartContext}

**INSTRUCTIONS:**
- Analyze the specific chart data provided above
- Explain what you see in the chart (trends, patterns, key levels)
- Provide multiple scenarios (bullish, base case, bearish)
- End with a specific price prediction: "My price prediction is $XXX-XXX by [timeframe]"
- Base your analysis on the actual chart data provided, not generic examples

**CRITICAL: You MUST end your response with: "My price prediction is $XXX-XXX by [timeframe]"**`;

			const response = await this.openai.chat.completions.create({
				model: 'gpt-4o',
				messages: [
					{
						role: 'system',
						content: 'You are an expert financial analyst. Analyze the specific chart data provided and give a price prediction. Always end with "My price prediction is $XXX-XXX by [timeframe]".'
					},
					{
						role: 'user',
						content: predictionPrompt
					}
				],
				max_tokens: 2000,
				temperature: 0.7
			});

			const prediction = response.choices[0].message.content;
			
			// Send prediction directly without embed
			await message.reply(prediction);
			
		} catch (error) {
			console.error('Error handling prediction request:', error);
			console.error('Error details:', error.message);
			console.error('Stack trace:', error.stack);
			await message.channel.send('❌ Sorry, I encountered an error while generating the prediction. Please try again.');
		}
	}

	/**
	 * Start the bot with connection retry logic
	 */
	start() {
		this.connectWithRetry();
	}

	/**
	 * Connect to Discord with retry logic to prevent rapid reconnections
	 */
	async connectWithRetry() {
		let retryCount = 0;
		const maxRetries = 5;
		const retryDelay = 5000; // 5 seconds

		const attemptConnection = async () => {
			try {
				console.log(`🔄 Attempting to connect to Discord... (Attempt ${retryCount + 1}/${maxRetries})`);
				await this.client.login(process.env.DISCORD_TOKEN);
			} catch (error) {
				retryCount++;
				console.error(`❌ Connection failed (Attempt ${retryCount}):`, error.message);
				
				if (retryCount < maxRetries) {
					console.log(`⏳ Waiting ${retryDelay/1000} seconds before retry...`);
					setTimeout(attemptConnection, retryDelay);
				} else {
					console.error('❌ Max connection attempts reached. Bot will not restart automatically.');
					process.exit(1);
				}
			}
		};

		attemptConnection();
	}
}

// Create and start the bot
const bot = new MentionBotAutoSave();
bot.start();
