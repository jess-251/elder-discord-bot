require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

class LogAnalysisBot {
    constructor() {
        // Set up Discord client with the permissions we actually need
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessageReactions
            ]
        });

        // Initialize OpenAI with API key from environment
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Keep track of what each channel is working on to avoid mixing conversations
        this.channelContexts = new Map();
        
        // Set up our database and event handlers
        this.initDatabase();
        this.setupEventHandlers();
        this.registerSlashCommands();
    }

    /**
     * Register all our slash commands with Discord
     * This runs once when the bot starts up
     */
    async registerSlashCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('addknowledge')
                .setDescription('Add new solution to knowledge base using a form'),
        ];

        this.client.once('ready', async () => {
            console.log(`✅ Bot logged in as ${this.client.user.tag}`);
            
            try {
                await this.client.application.commands.set(commands);
                console.log('✅ Slash commands registered');
            } catch (error) {
                console.error('❌ Failed to register slash commands:', error);
            }
        });
    }

    /**
     * Set up our SQLite database with all the tables we need
     * This creates the database file if it doesn't exist
     */
    async initDatabase() {
        this.db = new sqlite3.Database('./knowledge_base.db');
        
        // Convert callback-based database methods to promises for cleaner code
        this.dbRun = promisify(this.db.run.bind(this.db));
        this.dbGet = promisify(this.db.get.bind(this.db));
        this.dbAll = promisify(this.db.all.bind(this.db));

        // Create our main knowledge base table
        await this.dbRun(`
            CREATE TABLE IF NOT EXISTS knowledge_base (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                keywords TEXT NOT NULL,
                solution TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                usage_count INTEGER DEFAULT 0
            )
        `);

        // Track what files we've analyzed for each channel
        await this.dbRun(`
            CREATE TABLE IF NOT EXISTS analysis_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                file_name TEXT NOT NULL,
                analysis_result TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add some default knowledge if this is a fresh install
        await this.addDefaultKnowledge();
    }

    /**
     * Add some useful default solutions to get started
     * Only runs if the database is empty
     */
    async addDefaultKnowledge() {
        const existingRpc = await this.dbGet('SELECT id FROM knowledge_base WHERE category = ?', ['rpc_auth_error']);
        
        if (!existingRpc) {
            await this.addKnowledge('rpc_auth_error', 
                'RPC unauthorized, 401 Unauthorized, switching to backup RPC, authentication failed',
                `**RPC Authentication Error Solution:**

Come try out a cheaper paid RPC. With unlimited quota each month, you can reduce your PNL check duration to as low as 10 seconds or even run 2-5 pools at once! You can choose the $20 or $30 per month plan, ONLY for our decoder NFT holders or farmer subscribers.

**Setup Steps:**
1. Visit SparkNode's website (https://www.sparknode.xyz/) and click on the Dashboard to connect your Discord account
2. After connecting your Discord, navigate to the Wallets section and link the wallet that holds your Decoders
3. Click on the Standard dropdown under "SPARKnode" logo and select Lite (requires 1+ Decoder NFT or active subscription)
4. Go to Billing section and pay for the RPC service ($20-$30/month, crypto payments accepted)
5. Add your Hyonix VPS IP address in the IPs section (restricted to one IP per plan)
6. Use this RPC endpoint: \`https://sol.rpc.sparknode.xyz/\`

**Important Notes:**
- After renewal, they may delete your whitelisted IP - add it back
- During maintenance, pause farmer or switch RPC to avoid confirmation issues`
            );
        }
    }

    /**
     * Set up all our event listeners for commands and interactions
     */
    setupEventHandlers() {
        // Handle regular text commands (the old !command style)
        this.client.on('messageCreate', async (message) => {
            // Ignore messages from other bots
            if (message.author.bot) return;

            // Route to appropriate command handlers
            if (message.content.startsWith('!analyze')) {
                await this.handleAnalyzeCommand(message);
            } else if (message.content.startsWith('!ask')) {
                await this.handleAskCommand(message);
            } else if (message.content.startsWith('!knowledge')) {
                await this.handleKnowledgeSearchCommand(message);
            } else if (message.content.startsWith('!addknowledge')) {
                await this.handleOldAddKnowledgeCommand(message);
            } else if (message.content.startsWith('!clearcontext')) {
                await this.handleClearContextCommand(message);
            } else if (message.content.startsWith('!status')) {
                await this.handleStatusCommand(message);
            } else if (message.content.startsWith('!help')) {
                await this.handleHelpCommand(message);
            }
        });

        // Handle slash commands and modal forms
        this.client.on('interactionCreate', async (interaction) => {
            if (interaction.isChatInputCommand()) {
                if (interaction.commandName === 'addknowledge') {
                    await this.handleSlashAddKnowledge(interaction);
                }
            } else if (interaction.isModalSubmit()) {
                if (interaction.customId === 'knowledge_modal') {
                    await this.handleKnowledgeModal(interaction);
                }
            }
        });
    }

    /**
     * NEW FEATURE: Search knowledge base directly without needing a log file
     * Usage: !knowledge how do I fix RPC errors?
     */
    async handleKnowledgeSearchCommand(message) {
        const question = message.content.replace('!knowledge', '').trim();
        
        if (!question) {
            await message.reply('❌ Please ask a question. Example: `!knowledge how do I fix RPC authentication errors?`');
            return;
        }

        const loadingMsg = await message.reply('🔍 **Searching knowledge base...**');

        try {
            // Search through all our stored solutions
            const relevantSolutions = await this.searchKnowledgeBase(question);

            if (relevantSolutions.length === 0) {
                await loadingMsg.edit(`🤷 **No solutions found for:** "${question}"\n\nTry different keywords or use \`!ask\` after analyzing a log file for more specific help.`);
                return;
            }

            // Use AI to create a smart response combining multiple solutions if needed
            const smartResponse = await this.generateKnowledgeResponse(question, relevantSolutions);

            // Handle long responses by splitting them up
            if (smartResponse.length > 2000) {
                const chunks = this.splitMessage(smartResponse);
                await loadingMsg.edit(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await message.channel.send(chunks[i]);
                }
            } else {
                await loadingMsg.edit(smartResponse);
            }

            // Update usage counts for the solutions we used
            for (const solution of relevantSolutions) {
                await this.dbRun(
                    'UPDATE knowledge_base SET usage_count = usage_count + 1 WHERE id = ?',
                    [solution.id]
                );
            }

        } catch (error) {
            console.error('Knowledge search error:', error);
            await loadingMsg.edit('❌ **Error searching knowledge base:** ' + error.message);
        }
    }

    /**
     * Search through our knowledge base for relevant solutions
     * Returns solutions sorted by relevance
     */
    async searchKnowledgeBase(question) {
        const questionLower = question.toLowerCase();
        const questionWords = questionLower.split(/\s+/).filter(word => word.length > 2);
        
        const allSolutions = await this.dbAll('SELECT * FROM knowledge_base');
        const scoredSolutions = [];

        for (const solution of allSolutions) {
            let score = 0;
            const solutionText = (solution.keywords + ' ' + solution.solution + ' ' + solution.category).toLowerCase();
            
            // Score based on keyword matches
            for (const word of questionWords) {
                if (solutionText.includes(word)) {
                    score += 1;
                }
            }
            
            // Bonus points for category matches
            if (questionLower.includes(solution.category.toLowerCase())) {
                score += 3;
            }
            
            // Bonus for frequently used solutions
            score += solution.usage_count * 0.1;

            if (score > 0) {
                scoredSolutions.push({ ...solution, relevanceScore: score });
            }
        }

        // Return top 3 most relevant solutions
        return scoredSolutions
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, 3);
    }

    /**
     * Generate a smart response using AI to combine multiple knowledge base solutions
     */
    async generateKnowledgeResponse(question, solutions) {
        try {
            const prompt = `A user asked: "${question}"

Here are the most relevant solutions from our knowledge base:

${solutions.map((s, i) => 
    `Solution ${i+1} (Category: ${s.category}, Relevance: ${s.relevanceScore.toFixed(1)}):
Keywords: ${s.keywords}
Solution: ${s.solution}`
).join('\n\n')}

Create a helpful response that:
1. Directly answers their question
2. Uses the most relevant solution(s) 
3. Provides clear, actionable steps
4. Mentions if multiple approaches exist
5. Keeps it under 400 words

Format: Start with "💡 **Answer:** " followed by your response.`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful technical support assistant. Provide clear, actionable answers based on the knowledge base solutions provided. Be concise but thorough.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 600,
                temperature: 0.2
            });

            return response.choices[0].message.content;

        } catch (error) {
            console.error('Failed to generate knowledge response:', error);
            
            // Fallback to simple response if AI fails
            let fallbackResponse = `💡 **Found ${solutions.length} solution(s):**\n\n`;
            
            for (let i = 0; i < solutions.length; i++) {
                const solution = solutions[i];
                fallbackResponse += `**${solution.category.toUpperCase()}:**\n`;
                fallbackResponse += `${solution.solution}\n\n`;
            }
            
            return fallbackResponse;
        }
    }

    /**
     * Show a modal form for adding new knowledge (modern Discord UI)
     */
    async handleSlashAddKnowledge(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('knowledge_modal')
            .setTitle('Add New Solution to Knowledge Base');

        const categoryInput = new TextInputBuilder()
            .setCustomId('category')
            .setLabel('Category (e.g., rpc_error, database_issue)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter a short category name...')
            .setRequired(true)
            .setMaxLength(50);

        const keywordsInput = new TextInputBuilder()
            .setCustomId('keywords')
            .setLabel('Keywords (comma-separated)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('RPC unauthorized, 401 error, authentication failed')
            .setRequired(true)
            .setMaxLength(200);

        const solutionInput = new TextInputBuilder()
            .setCustomId('solution')
            .setLabel('Solution (detailed steps)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('1. First step to fix...\n2. Second step...\n3. Final step...')
            .setRequired(true)
            .setMaxLength(2000);

        const firstActionRow = new ActionRowBuilder().addComponents(categoryInput);
        const secondActionRow = new ActionRowBuilder().addComponents(keywordsInput);
        const thirdActionRow = new ActionRowBuilder().addComponents(solutionInput);

        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

        await interaction.showModal(modal);
    }

    /**
     * Handle the submitted knowledge form
     */
    async handleKnowledgeModal(interaction) {
        const category = interaction.fields.getTextInputValue('category');
        const keywords = interaction.fields.getTextInputValue('keywords');
        const solution = interaction.fields.getTextInputValue('solution');

        try {
            await this.addKnowledge(category, keywords, solution);
            
            const embed = new EmbedBuilder()
                .setTitle('✅ Knowledge Added Successfully!')
                .setColor('#00ff00')
                .addFields(
                    { name: '📂 Category', value: `\`${category}\``, inline: true },
                    { name: '🔍 Keywords', value: keywords, inline: true },
                    { name: '💡 Solution Preview', value: solution.substring(0, 100) + (solution.length > 100 ? '...' : ''), inline: false }
                )
                .setFooter({ text: 'Knowledge base updated' });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (error) {
            console.error('Error adding knowledge:', error);
            await interaction.reply({ 
                content: '❌ **Error adding knowledge:** ' + error.message, 
                ephemeral: true 
            });
        }
    }

    /**
     * Handle the old-style add knowledge command (still supported for convenience)
     */
    async handleOldAddKnowledgeCommand(message) {
        await message.reply(`ℹ️ **Use the new slash command instead!**\n\nType \`/addknowledge\` for an easy form to fill out.\n\n*The old \`!addknowledge\` format still works if you prefer:*\n\`!addknowledge category | keywords | solution\``);
        
        // Still support the old pipe-separated format
        const args = message.content.split('|');
        if (args.length === 4) {
            const [, category, keywords, solution] = args.map(arg => arg.trim());
            try {
                await this.addKnowledge(category, keywords, solution);
                await message.reply(`✅ **Added:** ${category}\n**Keywords:** ${keywords}`);
            } catch (error) {
                await message.reply('❌ **Error adding knowledge:** ' + error.message);
            }
        }
    }

    /**
     * Analyze uploaded log files and provide intelligent feedback
     */
    async handleAnalyzeCommand(message) {
        const loadingMsg = await message.reply('🔍 **Starting analysis...** Please wait while I process the file.');

        try {
            // Make sure they actually uploaded a file
            if (message.attachments.size === 0) {
                await loadingMsg.edit('❌ Please attach a log file to analyze.');
                return;
            }

            const attachment = message.attachments.first();
            const maxSize = 10 * 1024 * 1024; // Don't process files bigger than 10MB
            
            if (attachment.size > maxSize) {
                await loadingMsg.edit('❌ File too large. Maximum size is 10MB.');
                return;
            }

            // Download the file and read its contents
            const response = await fetch(attachment.url);
            const fileContent = await response.text();
            const fileHash = crypto.createHash('md5').update(fileContent).digest('hex');

            await loadingMsg.edit('🔍 **File downloaded. Analyzing content...**');

            // Let GPT-4 analyze what's wrong with the logs
            const analysis = await this.analyzeWithGPT(fileContent, attachment.name);

            // Store what we found so the user can ask follow-up questions
            this.channelContexts.set(message.channel.id, {
                fileContent,
                fileName: attachment.name,
                analysis,
                timestamp: Date.now()
            });

            console.log(`✅ Context stored for channel ${message.channel.id}: ${attachment.name}`);

            // Look for solutions in our knowledge base
            const solutions = await this.findRelevantSolutions(analysis.issues);

            // Create a smart response combining the analysis with our solutions
            let responseText;
            if (solutions.length > 0) {
                await loadingMsg.edit('🔍 **Generating smart response...**');
                responseText = await this.generateSmartResponse(analysis, solutions, attachment.name);
            } else {
                responseText = `📊 **Analysis:** \`${attachment.name}\`\n`;
                responseText += `**Summary:** ${analysis.summary}\n`;
                
                if (analysis.issues.length > 0) {
                    responseText += `**Issues:** ${analysis.issues.join(' • ')}\n`;
                }

                responseText += `**No solutions found.** Use \`!ask <question>\` for specific help or \`!knowledge <question>\` to search all solutions.\n`;
                responseText += `\n**Commands:** \`!ask <question>\` • \`!knowledge <question>\` • \`!clearcontext\``;
            }

            // Keep a record of what we analyzed
            await this.dbRun(
                'INSERT INTO analysis_history (channel_id, file_hash, file_name, analysis_result) VALUES (?, ?, ?, ?)',
                [message.channel.id, fileHash, attachment.name, responseText]
            );

            // Split long messages so Discord doesn't reject them
            if (responseText.length > 2000) {
                const chunks = this.splitMessage(responseText);
                await loadingMsg.edit(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await message.channel.send(chunks[i]);
                }
            } else {
                await loadingMsg.edit(responseText);
            }

        } catch (error) {
            console.error('Analysis error:', error);
            await loadingMsg.edit('❌ **Error during analysis:** ' + error.message);
        }
    }

    /**
     * Generate a smart response that combines log analysis with knowledge base solutions
     */
    async generateSmartResponse(analysis, solutions, fileName) {
        try {
            const prompt = `You are analyzing a log file and found relevant solutions. Create a compact, actionable response.

Log Analysis Results:
- File: ${fileName}
- Summary: ${analysis.summary}
- Issues: ${analysis.issues.join(', ')}

Available Solutions:
${solutions.map((s, i) => `${i+1}. Category: ${s.category}\nKeywords: ${s.keywords}\nSolution: ${s.solution}`).join('\n\n')}

Create a response with this EXACT format:

📊 **Analysis:** \`[filename]\`
**Problem:** [1-2 sentence description of the main issue]
**Solution:** [3-4 key steps to fix it - be specific but concise]
**Full Details:** Use \`!ask solution\` for complete instructions

**Commands:** \`!ask <question>\` • \`!knowledge <question>\` • \`!clearcontext\`

Keep it under 300 words. Focus on the most critical issue and most relevant solution.`;

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a technical support expert. Provide concise, actionable summaries. Follow the exact format requested. Be direct and specific.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 400,
                temperature: 0.1
            });

            return response.choices[0].message.content;

        } catch (error) {
            console.error('❌ Smart response generation failed:', error);
            
            // If AI fails, create a basic response instead
            let responseText = `📊 **Analysis:** \`${fileName}\`\n`;
            responseText += `**Summary:** ${analysis.summary}\n`;
            
            if (analysis.issues.length > 0) {
                responseText += `**Issues:** ${analysis.issues.join(' • ')}\n`;
            }

            if (solutions.length > 0) {
                responseText += `**Solutions found!** Use \`!ask solution\` for details.\n`;
            }

            responseText += `\n**Commands:** \`!ask <question>\` • \`!knowledge <question>\` • \`!clearcontext\``;
            
            return responseText;
        }
    }

    /**
     * Use GPT to analyze log file contents and extract key issues
     */
    async analyzeWithGPT(content, filename) {
        const prompt = `Analyze this log file and extract key information.

File: ${filename}
Content:
${content}

Respond in JSON format only (no markdown formatting):
{
    "summary": "Brief description of what's happening in the logs",
    "issues": ["specific error 1", "specific error 2"],
    "severity": "low|medium|high",
    "keywords": ["key terms for solution matching"]
}

Focus on actual errors, failures, and problems. Be specific about what's failing.`;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert log analyst. Always respond with valid JSON only - no markdown code blocks, no extra text, just pure JSON.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: 1000,
            temperature: 0.1
        });

        try {
            let jsonContent = response.choices[0].message.content.trim();
            
            // Clean up any markdown formatting that GPT might add
            if (jsonContent.startsWith('```json')) {
                jsonContent = jsonContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
            } else if (jsonContent.startsWith('```')) {
                jsonContent = jsonContent.replace(/```\s*/, '').replace(/\s*```$/, '');
            }
            
            return JSON.parse(jsonContent);
        } catch (e) {
            console.error('Failed to parse GPT response:', response.choices[0].message.content);
            
            // Return a safe fallback if JSON parsing fails
            return {
                summary: "Log analysis failed, but file was processed",
                issues: ["Unable to parse log structure", "Analysis error occurred"],
                severity: "medium",
                keywords: ["error", "analysis", "failed"]
            };
        }
    }

    /**
     * Search our knowledge base for solutions that match the detected issues
     */
    async findRelevantSolutions(issues) {
        if (!issues || issues.length === 0) return [];

        const solutions = [];
        const keywords = issues.join(' ').toLowerCase();

        const knowledgeEntries = await this.dbAll('SELECT * FROM knowledge_base');
        
        for (const entry of knowledgeEntries) {
            const entryKeywords = entry.keywords.toLowerCase().split(',');
            const hasMatch = entryKeywords.some(keyword => 
                keywords.includes(keyword.trim())
            );
            
            if (hasMatch) {
                solutions.push(entry);
                // Track which solutions are actually useful
                await this.dbRun(
                    'UPDATE knowledge_base SET usage_count = usage_count + 1 WHERE id = ?',
                    [entry.id]
                );
            }
        }

        // Return most-used solutions first
        return solutions.sort((a, b) => b.usage_count - a.usage_count);
    }

    /**
     * Handle follow-up questions about analyzed log files
     */
    async handleAskCommand(message) {
        const context = this.channelContexts.get(message.channel.id);
        
        console.log(`Ask command in channel ${message.channel.id}`);
        console.log(`Available contexts:`, Array.from(this.channelContexts.keys()));
        console.log(`Context found:`, !!context);
        
        if (!context) {
            await message.reply('❌ No file context found. Please analyze a file first using `!analyze`, or use `!knowledge <question>` to search all solutions.');
            return;
        }

        const question = message.content.replace('!ask', '').trim();
        if (!question) {
            await message.reply('❌ Please provide a question. Example: `!ask why is the RPC failing?`');
            return;
        }

        const loadingMsg = await message.reply('🤔 **Thinking...**');

        try {
            // Check if they're asking for solutions specifically
            const solutions = await this.findRelevantSolutions(context.analysis.issues);
            const isAboutSolution = question.toLowerCase().includes('solution') || 
                                  question.toLowerCase().includes('fix') || 
                                  question.toLowerCase().includes('solve') ||
                                  question.toLowerCase().includes('how');

            let prompt;
            if (isAboutSolution && solutions.length > 0) {
                prompt = `The user is asking about solutions for the log file issues.

Log file: ${context.fileName}
Issues found: ${context.analysis.issues.join(', ')}
User question: ${question}

Available solutions:
${solutions.map(s => `**${s.category.toUpperCase()}:**\n${s.solution}`).join('\n\n')}

Provide the most relevant complete solution with all details and steps. Be thorough and include all important information.`;
            } else {
                prompt = `Answer the user's question based on the log file content.

Log file: ${context.fileName}
Log content: ${context.fileContent.substring(0, 3000)}...
Analysis: ${context.analysis.summary}
Issues: ${context.analysis.issues.join(', ')}

User question: ${question}

Answer based only on the log content. If referencing specific errors, mention timestamps or line context. Be concise but helpful.`;
            }

            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a log analysis assistant. Always cite specific parts of logs when answering. Be helpful and accurate.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 1200,
                temperature: 0.1
            });

            let answer = response.choices[0].message.content;
            answer = `**Q:** ${question}\n**A:** ${answer}`;

            // Handle long responses
            if (answer.length > 2000) {
                const chunks = this.splitMessage(answer);
                await loadingMsg.edit(chunks[0]);
                for (let i = 1; i < chunks.length; i++) {
                    await message.channel.send(chunks[i]);
                }
            } else {
                await loadingMsg.edit(answer);
            }

        } catch (error) {
            console.error('Ask command error:', error);
            await loadingMsg.edit('❌ **Error processing question:** ' + error.message);
        }
    }

    /**
     * Add new knowledge to our database
     */
    async addKnowledge(category, keywords, solution) {
        await this.dbRun(
            'INSERT INTO knowledge_base (category, keywords, solution) VALUES (?, ?, ?)',
            [category, keywords, solution]
        );
    }

    /**
     * Show what context is currently active in this channel
     */
    async handleStatusCommand(message) {
        const context = this.channelContexts.get(message.channel.id);
        if (context) {
            const age = Math.floor((Date.now() - context.timestamp) / 1000 / 60); // minutes ago
            await message.reply(`✅ **Context:** \`${context.fileName}\` (${age}m ago)\n**Ask away!** Use \`!ask <question>\` or \`!knowledge <question>\``);
        } else {
            await message.reply(`❌ **No context** - Upload file with \`!analyze\` first, or use \`!knowledge <question>\` to search all solutions`);
        }
    }

    /**
     * Clear the current channel's context so we can start fresh
     */
    async handleClearContextCommand(message) {
        const hadContext = this.channelContexts.has(message.channel.id);
        this.channelContexts.delete(message.channel.id);
        console.log(`Context cleared for channel ${message.channel.id}, had context: ${hadContext}`);
        await message.reply('✅ **Context cleared** - ready for new file.');
    }

    /**
     * Show help information with all available commands
     */
    async handleHelpCommand(message) {
        const embed = new EmbedBuilder()
            .setTitle('📋 Log Analysis Bot')
            .setColor('#0099ff')
            .addFields(
                {
                    name: '🔍 !analyze',
                    value: 'Upload file + use command to analyze logs',
                    inline: true
                },
                {
                    name: '❓ !ask <question>',
                    value: 'Ask about analyzed file content',
                    inline: true
                },
                {
                    name: '💡 !knowledge <question>',
                    value: 'Search knowledge base directly (NEW!)',
                    inline: true
                },
                {
                    name: '📚 /addknowledge',
                    value: 'Easy form to add new solutions',
                    inline: true
                },
                {
                    name: '🧹 !clearcontext',
                    value: 'Clear channel context',
                    inline: true
                },
                {
                    name: '📊 !status',
                    value: 'Check current context status',
                    inline: true
                },
                {
                    name: 'ℹ️ Notes',
                    value: '• Channel isolation • 10MB limit • 1hr timeout\n• **NEW:** Use `!knowledge` to search without logs!',
                    inline: false
                }
            );
 
        await message.reply({ embeds: [embed] });
    }
 
    /**
     * Split long messages into chunks that Discord can handle
     * Discord has a 2000 character limit per message
     */
    splitMessage(text, limit = 2000) {
        if (text.length <= limit) return [text];
        
        const chunks = [];
        let current = '';
        const lines = text.split('\n');
        
        for (const line of lines) {
            if ((current + line + '\n').length > limit) {
                if (current) chunks.push(current.trim());
                current = line + '\n';
            } else {
                current += line + '\n';
            }
        }
        
        if (current) chunks.push(current.trim());
        return chunks;
    }
 
    /**
     * Clean up old contexts to prevent memory leaks
     * Runs automatically every 30 minutes
     */
    cleanupOldContexts() {
        const oneHour = 60 * 60 * 1000;
        const now = Date.now();
        
        for (const [channelId, context] of this.channelContexts.entries()) {
            if (now - context.timestamp > oneHour) {
                this.channelContexts.delete(channelId);
                console.log(`🧹 Cleaned up old context for channel ${channelId}`);
            }
        }
    }
 
    /**
     * Start the bot and set up automatic cleanup
     */
    start() {
        // Clean up old contexts every 30 minutes to keep memory usage reasonable
        setInterval(() => this.cleanupOldContexts(), 30 * 60 * 1000);
        
        this.client.login(process.env.DISCORD_TOKEN);
    }
 }
 
 // Create and start the bot
 const bot = new LogAnalysisBot();
 bot.start();
 
 module.exports = LogAnalysisBot;