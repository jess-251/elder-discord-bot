# 🤖 Discord Log Analysis Bot

A smart Discord bot that analyzes log files, provides intelligent troubleshooting, and maintains a growing knowledge base of solutions.

## ✨ Features

### 📊 **Log Analysis**

- Upload any log file and get instant AI-powered analysis
- Automatically detects errors, warnings, and issues
- Provides smart solutions based on detected problems
- Channel-specific contexts (no cross-contamination)

### 💡 **Knowledge Base Search**

- Ask questions directly without uploading logs
- Searches through all stored solutions intelligently
- AI-powered responses combining multiple solutions
- Self-improving through usage tracking

### 🛠️ **Solution Management**

- Easy-to-use forms for adding new solutions
- Automatic relevance scoring and ranking
- Track which solutions are most helpful
- Community-driven knowledge growth

## 🚀 Quick Start

### Prerequisites

- Node.js 16+
- Discord Bot Token
- OpenAI API Key

### Installation

1. **Clone and install dependencies:**

```bash
cd discord-ai
npm install
```

2. **Set up environment variables:**

```bash
# Create .env file
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
```

3. **Run the bot:**

```bash
node run start
```

## 📋 Commands

### 🔍 **Analysis Commands**

| Command           | Description               | Example                        |
| ----------------- | ------------------------- | ------------------------------ |
| `!analyze`        | Analyze uploaded log file | Upload file + `!analyze`       |
| `!ask <question>` | Ask about analyzed file   | `!ask why is the RPC failing?` |

### 💡 **Knowledge Commands**

| Command                 | Description             | Example                             |
| ----------------------- | ----------------------- | ----------------------------------- |
| `!knowledge <question>` | Search knowledge base   | `!knowledge how to fix RPC errors?` |
| `/addknowledge`         | Add new solution (form) | `/addknowledge`                     |

### 🛠️ **Utility Commands**

| Command         | Description           |
| --------------- | --------------------- |
| `!status`       | Check current context |
| `!clearcontext` | Clear channel context |
| `!help`         | Show all commands     |

## 💬 Usage Examples

### **Scenario 1: Log Analysis**

```
1. Upload your error.log file
2. Type: !analyze
3. Bot analyzes and shows issues + solutions
4. Ask follow-ups: !ask how do I fix this?
```

### **Scenario 2: Quick Questions**

```
1. Type: !knowledge RPC authentication errors
2. Get instant solutions from knowledge base
3. No file upload needed!
```

### **Scenario 3: Adding Knowledge**

```
1. Type: /addknowledge
2. Fill out the form:
   - Category: database_error
   - Keywords: connection timeout, SQL failed
   - Solution: 1. Check connection string...
3. Knowledge base grows for everyone!
```

## 🧠 How It Works

### **Smart Analysis Process**

1. **File Upload** → Bot downloads and reads log content
2. **AI Analysis** → GPT-4 identifies issues and errors
3. **Solution Matching** → Searches knowledge base for relevant fixes
4. **Smart Response** → Combines analysis with known solutions

### **Knowledge Base Intelligence**

- **Relevance Scoring:** Matches keywords, categories, and context
- **Usage Tracking:** Popular solutions rank higher
- **AI Enhancement:** GPT-4 creates coherent responses from multiple solutions
- **Self-Learning:** Gets smarter as more people use it

## 🗂️ Database Structure

The bot uses SQLite with two main tables:

### **knowledge_base**

- Stores solutions with categories, keywords, and step-by-step fixes
- Tracks usage count for popularity-based ranking
- Community-contributed and self-improving

### **analysis_history**

- Keeps record of analyzed files per channel
- Enables context-aware follow-up questions
- Prevents duplicate analysis of same files

## ⚙️ Configuration

### **File Limits**

- Maximum file size: 10MB
- Supported formats: .log, .txt, .json, and more
- Auto-cleanup: Contexts expire after 1 hour

### **AI Settings**

- Model: GPT-4o-mini for cost-effective analysis
- Temperature: 0.1 for consistent, factual responses
- Max tokens: Optimized for detailed but concise answers

### **Channel Isolation**

- Each Discord channel has its own context
- No mixing of conversations or file analysis
- Perfect for team environments

## 🔧 Default Knowledge

The bot comes pre-loaded with solutions for:

- **RPC Authentication Errors** (Solana/Web3)
- **Common Connection Issues**
- **Authentication Failures**

Add your own solutions using `/addknowledge`!

## 🚨 Error Handling

### **Graceful Fallbacks**

- If AI analysis fails → Returns basic file info
- If JSON parsing fails → Uses fallback analysis
- If knowledge search fails → Shows manual search suggestions
- If responses are too long → Auto-splits messages

### **Rate Limiting**

- Built-in OpenAI rate limit handling
- Automatic retry logic for transient failures
- User-friendly error messages

## 🤝 Contributing

### **Adding Knowledge**

The easiest way to improve the bot is by adding solutions:

1. Use `/addknowledge` command
2. Fill out category, keywords, and detailed solution
3. Your solution helps everyone in the server!

### **Best Practices for Solutions**

- **Category:** Short, descriptive (e.g., `rpc_error`, `database_timeout`)
- **Keywords:** Comma-separated terms people might search for
- **Solution:** Step-by-step instructions with clear formatting

## 📊 Monitoring

### **Bot Health**

- Context cleanup every 30 minutes
- Database connection monitoring
- OpenAI API usage tracking

### **Usage Analytics**

- Track which solutions are most helpful
- Monitor analysis success rates
- Identify knowledge gaps

## 🔐 Security Notes

- Bot only reads uploaded files, never stores file contents permanently
- Knowledge base is local SQLite (not cloud-synced)
- OpenAI API calls include only necessary log excerpts
- Channel isolation prevents data leaks between teams

## 📈 Roadmap

- [ ] Web dashboard for knowledge management
- [ ] Advanced log parsing for specific formats
- [ ] Integration with popular logging platforms
- [ ] Export/import knowledge base functionality
- [ ] Multi-language support

---

**Need Help?** Use `!help` in any channel or check the issues tab!

**Found a Bug?** Please report it with example logs and steps to reproduce.
