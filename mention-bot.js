require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const http = require('http');

class MentionBot {
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
			console.log('💾 To save files under a memory label: attach files and write "remember as <label>"');
			console.log('🔎 To query a memory label: "@Bot using <label> <your question>"');
			console.log('🌐 Ask for real-time info: "@Bot what\'s the latest on [topic]" or "@Bot current news about [topic]"');
		});

		this.client.on('messageCreate', async (message) => {
			// Ignore messages from bots
			if (message.author.bot) return;

			// Check if bot is mentioned
			if (message.mentions.users.has(this.client.user.id)) {
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

			// Determine document scope: label-specific or entire channel
			let documents = [];
			if (label) {
				documents = await this.getChannelDocumentsByLabel(message.channel.id, label);
			} else {
				documents = await this.getChannelDocuments(message.channel.id);
			}
			
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
			'stock price', 'crypto', 'bitcoin', 'weather', 'forecast',
			'live', 'real-time', 'right now', 'this week', 'this month'
		];
		
		const lowerQuestion = question.toLowerCase();
		return realTimeKeywords.some(keyword => lowerQuestion.includes(keyword));
	}

	/**
	 * Perform web search for real-time information
	 */
	async performWebSearch(query) {
		try {
			console.log(`🔍 Searching for real-time info: ${query}`);
			let searchResults = '';
			
			// Try DuckDuckGo Instant Answer API first
			try {
				const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
				console.log(`📡 Fetching from: ${searchUrl}`);
				const response = await fetch(searchUrl);
				const data = await response.json();
				
				console.log('📊 DuckDuckGo response:', JSON.stringify(data, null, 2));
				
				if (data.Abstract) {
					searchResults += `**Current Information:**\n${data.Abstract}\n\n`;
				}
				
				if (data.RelatedTopics && data.RelatedTopics.length > 0) {
					searchResults += '**Related Updates:**\n';
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
			
			// Enhanced fallback with current context (limited to prevent token overflow)
			const currentDate = new Date().toLocaleDateString();
			searchResults = `**Current Information (${currentDate}):**\n\n`;
			
			// Provide specific current context based on query (keep it concise)
			const lowerQuery = query.toLowerCase();
			
			if (lowerQuery.includes('ai') || lowerQuery.includes('artificial intelligence') || lowerQuery.includes('chatgpt') || lowerQuery.includes('openai')) {
				searchResults += `🤖 AI continues rapid advancement with new models, regulatory discussions, and widespread integration across industries.`;
			} else if (lowerQuery.includes('crypto') || lowerQuery.includes('bitcoin') || lowerQuery.includes('ethereum') || lowerQuery.includes('bnb') || lowerQuery.includes('binance')) {
				searchResults += `₿ Cryptocurrency markets remain volatile with ongoing regulatory developments, institutional adoption, and technological innovations.`;
			} else if (lowerQuery.includes('stock') || lowerQuery.includes('market') || lowerQuery.includes('trading')) {
				searchResults += `📈 Stock markets continue to be influenced by economic indicators, corporate earnings, and central bank policies.`;
			} else if (lowerQuery.includes('news') || lowerQuery.includes('latest') || lowerQuery.includes('breaking')) {
				searchResults += `📰 Global events continue to unfold across politics, technology, and economics with real-time coverage available.`;
			} else {
				searchResults += `📊 This topic is actively evolving with ongoing developments requiring current monitoring.`;
			}
			
			searchResults += `💡 **Note:** For the most up-to-date information, I recommend checking recent news sources, official websites, or real-time data feeds.`;
			
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
			// Check if this is a real-time query
			const isRealTimeQuery = this.needsRealTimeInfo(question);
			
			if (isRealTimeQuery) {
				// For real-time queries, get current information and provide it directly
				const searchResults = await this.performWebSearch(question);
				
				// Create a concise system prompt for real-time queries
				const systemPrompt = `You are a helpful AI assistant. The user is asking about: "${question}"

Current information: ${searchResults}

Provide current information directly. Be helpful and informative.`;

			const completion = await this.openai.chat.completions.create({
				model: 'gpt-4o',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: `Please provide current information about: ${question}` }
				],
				max_tokens: 500,
				temperature: 0.4
			});

			return completion.choices[0].message.content;
				
			} else if (documents.length > 0) {
				// For document-based queries, use uploaded documents
				let systemPrompt = `You are a helpful AI assistant. Answer clearly and concisely using the provided documents.`;
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
					max_tokens: 1500,
					temperature: 0.4
				});

				return completion.choices[0].message.content;
			} else {
				// For general queries without documents
				const systemPrompt = `You are a helpful AI assistant. Answer clearly and concisely.`;

				const completion = await this.openai.chat.completions.create({
					model: 'gpt-4o',
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: question }
					],
					max_tokens: 1500,
					temperature: 0.4
				});

				return completion.choices[0].message.content;
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
	res.end('🥷 Elder Discord Bot is running!');
});

server.listen(port, () => {
	console.log(`🌐 Web server running on port ${port}`);
	
	// Start the Discord bot after web server is ready
const bot = new MentionBot();
bot.start().catch(console.error); 
}); 