require('dotenv').config();

// Test the bot's detection logic
class TestBot {
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
            'market cap', 'trading volume', '24h change', 'price change'
        ];
        
        return webSearchKeywords.some(keyword => lowerQuestion.includes(keyword));
    }
}

// Test cases
const testBot = new TestBot();

const testCases = [
    "What is the current price of Bitcoin?",
    "What is the latest price of Ethereum?",
    "How is Solana performing today?",
    "What are the current crypto prices?",
    "What happened in crypto today?",
    "What is Bitcoin's current price?",
    "Show me the latest Bitcoin price",
    "What is a double bottom pattern?", // Should NOT trigger web search
    "Explain RSI indicators" // Should NOT trigger web search
];

console.log("🧪 Testing Web Search Detection\n");

testCases.forEach((testCase, index) => {
    console.log(`\n--- Test Case ${index + 1} ---`);
    console.log(`Question: "${testCase}"`);
    
    const needsWeb = testBot.needsWebSearch(testCase);
    console.log(`Needs Web Search: ${needsWeb ? '🌐 YES' : '❌ NO'}`);
});

console.log("\n✅ Detection test completed!");
