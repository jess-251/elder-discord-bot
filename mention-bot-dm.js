require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

class MentionBotDM {
	constructor() {
		// Set up Discord client with necessary intents INCLUDING Direct Messages
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.GuildMessageReactions,
				GatewayIntentBits.DirectMessages,  // Add this for DM support
				GatewayIntentBits.DirectMessageReactions  // Add this for DM reactions
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
		this.db = new sqlite3.Database('./mention_bot_dm.db');
		
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
			console.log(`💬 I can also respond to Direct Messages!`);
			console.log('💾 To save files under a memory label: attach files and write "remember as <label>"');
			console.log('🔎 To query a memory label: "@Bot using <label> <your question>"');
		});

		this.client.on('messageCreate', async (message) => {
			// Ignore messages from bots (including itself)
			if (message.author.bot) return;

			// Check if bot is mentioned OR if it's a DM from a user (not itself)
			const isMentioned = message.mentions.users.has(this.client.user.id);
			const isDM = message.channel.type === 1; // DM channel type (1=DM)
			
			if ((isMentioned || isDM) && message.author.id !== this.client.user.id) {
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
	 * Handle when the bot is mentioned or DM'd
	 */
	async handleMention(message) {
		try {
			const label = this.parseLabel(message.content);
			const question = this.cleanQuestion(message.content, this.client.user.id);
			const isDM = message.channel.type === 1;
			
			if (!question && message.attachments.size === 0) {
				const response = isDM ? 
					'👋 Hi! I\'m your AI assistant. Ask me anything, or upload files and say "remember as <label>" to save them for future reference.' :
					'👋 Mention me with a question, or attach files and say "remember as <label>". To query a label, say "using <label> <question>".';
				await message.reply(response);
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
				.setTitle('🤖 AI Assistant')
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

				try {
					// Download and read file content
					const response = await fetch(attachment.url);
					const buffer = await response.arrayBuffer();
					const content = new TextDecoder().decode(buffer);
					
					// Save to database
					await this.saveDocument(message.channel.id, attachment.name, content, label);
					saves.push(attachment.name);
					
				} catch (error) {
					console.error(`Error processing file ${attachment.name}:`, error);
					await message.reply(`❌ Failed to process file: ${attachment.name}`);
				}
			}

			if (saves.length > 0) {
				const labelText = label ? ` under label "${label}"` : '';
				await message.reply(`✅ Saved ${saves.length} file(s)${labelText}: ${saves.join(', ')}`);
			}

		} catch (error) {
			console.error('Error handling file upload:', error);
			await message.reply('❌ Sorry, I encountered an error while processing your files.');
		}
	}

	/**
	 * Save document to database
	 */
	async saveDocument(channelId, filename, content, label = null) {
		await promisify(this.db.run.bind(this.db))(
			'INSERT INTO documents (channel_id, filename, content, label) VALUES (?, ?, ?, ?)',
			[channelId, filename, content, label]
		);
	}

	/**
	 * Get all documents for a channel
	 */
	async getChannelDocuments(channelId) {
		return await promisify(this.db.all.bind(this.db))(
			'SELECT * FROM documents WHERE channel_id = ? ORDER BY uploaded_at DESC',
			[channelId]
		);
	}

	/**
	 * Get documents for a channel by label
	 */
	async getChannelDocumentsByLabel(channelId, label) {
		return await promisify(this.db.all.bind(this.db))(
			'SELECT * FROM documents WHERE channel_id = ? AND label = ? ORDER BY uploaded_at DESC',
			[channelId, label]
		);
	}

	/**
	 * Save conversation to database
	 */
	async saveConversation(channelId, userId, question, answer) {
		await promisify(this.db.run.bind(this.db))(
			'INSERT INTO conversations (channel_id, user_id, question, answer) VALUES (?, ?, ?, ?)',
			[channelId, userId, question, answer]
		);
	}

	/**
	 * Generate AI response using OpenAI
	 */
	async generateResponse(question, documents, channelId, label = null) {
		try {
			// Build context from documents
			let context = '';
			if (documents.length > 0) {
				context = '\n\nRelevant documents:\n' + documents.map(doc => 
					`--- ${doc.filename}${doc.label ? ` (${doc.label})` : ''} ---\n${doc.content.substring(0, 2000)}...`
				).join('\n\n');
			}

			const prompt = `You are a helpful AI assistant. Answer the user's question based on the provided context and your knowledge.

${context}

User question: ${question}

Please provide a helpful, accurate, and concise response. If the context doesn't contain relevant information, use your general knowledge to help.`;

			const completion = await this.openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'system',
						content: 'You are a helpful AI assistant that answers questions based on provided context and general knowledge.'
					},
					{
						role: 'user',
						content: prompt
					}
				],
				max_tokens: 1000,
				temperature: 0.7
			});

			return completion.choices[0].message.content;

		} catch (error) {
			console.error('Error generating response:', error);
			return '❌ Sorry, I encountered an error while generating a response. Please try again.';
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

// Start the bot
const bot = new MentionBotDM();
bot.start();
