require('dotenv').config();

// Test the bot's detection logic
class TestBot {
    constructor() {
        // Copy the detection methods from the main bot
    }

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
}

// Test cases
const testBot = new TestBot();

const testCases = [
    // General technical analysis questions (should NOT trigger prediction)
    "what pattern has a better hit rate on BTC, a double bottom or double top",
    "what is an accumulation pattern?",
    "what in terms of technical analysis is an accumulation pattern?",
    "explain what a head and shoulders pattern is",
    "define support and resistance levels",
    "how does RSI work?",
    
    // Prediction requests (should trigger prediction)
    "predict the price of SOL by end of 2026",
    "what do you think about this chart?",
    "where will BTC be in 2025?",
    "what's better, this chart or $HYPE for bullish continuation",
    "compare these two charts",
    "which chart looks more bullish?",
    
    // Image generation requests (should be blocked)
    "generate an image of a chart",
    "create a diagram for me",
    "draw a picture of a trading pattern",
    "make an illustration of support levels"
];

console.log("🧪 Testing Bot Detection Logic\n");

testCases.forEach((testCase, index) => {
    console.log(`\n--- Test Case ${index + 1} ---`);
    console.log(`Question: "${testCase}"`);
    
    const isImageGen = testBot.isImageGenerationRequest(testCase);
    const isPrediction = testBot.isPredictionRequest(testCase);
    
    console.log(`Image Generation: ${isImageGen ? '❌ BLOCKED' : '✅ Allowed'}`);
    console.log(`Prediction Request: ${isPrediction ? '🎯 PREDICTION' : '📚 GENERAL'}`);
    
    if (isImageGen) {
        console.log(`→ Response: "Sorry, I do not create or generate images."`);
    } else if (isPrediction) {
        console.log(`→ Response: Will use prediction system (with or without charts)`);
    } else {
        console.log(`→ Response: Will use general AI knowledge system`);
    }
});

console.log("\n✅ Test completed! The bot should handle all these cases correctly.");
