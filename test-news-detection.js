require('dotenv').config();

// Test the bot's news detection logic
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
            'market cap', 'trading volume', '24h change', 'price change',
            'top crypto news', 'crypto news', 'cryptocurrency news', 'news today',
            'what\'s happening', 'market news', 'crypto updates', 'latest developments',
            'developments', 'crypto developments', 'market developments', 'industry news'
        ];
        
        return webSearchKeywords.some(keyword => lowerQuestion.includes(keyword));
    }
}

// Test cases
const testBot = new TestBot();

const testCases = [
    "What is the top crypto news for today?",
    "What are the latest crypto developments?",
    "What happened in crypto today?",
    "What is the current price of Bitcoin?",
    "What is a double bottom pattern?", // Should NOT trigger web search
];

console.log("🧪 Testing News Detection\n");

testCases.forEach((testCase, index) => {
    console.log(`\n--- Test Case ${index + 1} ---`);
    console.log(`Question: "${testCase}"`);
    
    const needsWeb = testBot.needsWebSearch(testCase);
    console.log(`Needs Web Search: ${needsWeb ? '🌐 YES' : '❌ NO'}`);
    
    if (needsWeb) {
        console.log(`✅ This should trigger web search and get current data`);
    } else {
        console.log(`❌ This will use general AI knowledge`);
    }
});

console.log("\n✅ Detection test completed!");
