# 🤖 Discord Mention Bot

A smart Discord bot that responds to mentions and can be fed documents for context-aware conversations.

## ✨ Features

### 💬 **Mention-Based Interaction**
- Simply mention the bot with `@BotName` to ask questions
- No need to remember commands - just tag and ask!
- Natural conversation flow

### 📄 **Document Feeding**
- Upload any text-based document to give the bot context
- Bot learns from uploaded documents and uses them to answer questions
- Channel-specific document storage (no cross-contamination)

### 🧠 **AI-Powered Responses**
- Uses OpenAI GPT-4o-mini for intelligent responses
- Context-aware answers based on uploaded documents
- Conversation history tracking

## 🚀 Quick Start

### Prerequisites

- Node.js 16+
- Discord Bot Token
- OpenAI API Key

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment variables:**
Create a `.env` file with:
```bash
DISCORD_TOKEN=your_discord_bot_token
OPENAI_API_KEY=your_openai_api_key
```

3. **Run the mention bot:**
```bash
npm run mention
```

## 💬 How to Use

### **Asking Questions**
Simply mention the bot in any channel:
```
@BotName what is the capital of France?
@BotName how do I fix this error?
@BotName can you explain this concept?
```

### **Feeding Documents**
Upload any text-based file to the channel:
- `.txt` files
- `.md` files  
- `.json` files
- `.log` files
- Any text-based document

The bot will automatically process the file and add it to its knowledge base for that channel.

### **Example Workflow**

1. **Upload a document:**
   - Drag and drop a `README.md` file to the channel
   - Bot confirms: "📄 Document Added: README.md"

2. **Ask questions:**
   - `@BotName what are the main features?`
   - `@BotName how do I install this?`
   - Bot responds with context from the uploaded document

3. **Upload more documents:**
   - Add API documentation, error logs, etc.
   - Bot combines knowledge from all documents

## 🗂️ Database Structure

The bot uses SQLite with two main tables:

### **documents**
- Stores uploaded document content per channel
- Tracks filename and upload timestamp
- Channel-isolated storage

### **conversations**
- Records all Q&A interactions
- Tracks user questions and bot responses
- Useful for analytics and debugging

## ⚙️ Configuration

### **File Limits**
- Maximum file size: 10MB
- Supported formats: Any text-based file
- Automatic UTF-8 encoding detection

### **AI Settings**
- Model: GPT-4o-mini (cost-effective)
- Temperature: 0.7 (balanced creativity/accuracy)
- Max tokens: 1000 (concise responses)

### **Channel Isolation**
- Each Discord channel has its own document collection
- No mixing of contexts between channels
- Perfect for team environments

## 🔧 Commands

The bot doesn't use traditional commands! Instead:

- **Mention the bot** → Ask questions
- **Upload files** → Feed documents
- **That's it!** → Simple and intuitive

## 🚨 Error Handling

### **Graceful Fallbacks**
- If AI fails → Friendly error message
- If file too large → Clear size limit message
- If file format unsupported → Helpful guidance
- If response too long → Auto-splits messages

### **Rate Limiting**
- Built-in OpenAI rate limit handling
- Automatic retry logic
- User-friendly error messages

## 🔐 Security Notes

- Bot only reads uploaded files, never stores permanently
- Database is local SQLite (not cloud-synced)
- Channel isolation prevents data leaks
- OpenAI API calls include only necessary content

## 📊 Monitoring

### **Bot Health**
- Database connection monitoring
- OpenAI API usage tracking
- Error logging and reporting

### **Usage Analytics**
- Track document uploads per channel
- Monitor question frequency
- Identify popular topics

## 🤝 Contributing

### **Improving Responses**
- Upload better documentation
- Provide more context through multiple documents
- Ask follow-up questions to refine responses

### **Best Practices**
- Upload relevant, well-formatted documents
- Use descriptive filenames
- Keep documents focused and organized

## 📈 Roadmap

- [ ] Web dashboard for document management
- [ ] Advanced document parsing (PDF, Word docs)
- [ ] Conversation memory across sessions
- [ ] Export/import document collections
- [ ] Multi-language support
- [ ] Document search functionality

---

**Need Help?** Just mention the bot and ask!

**Found a Bug?** Please report it with example messages and steps to reproduce. 