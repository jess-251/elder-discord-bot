// Test the prediction detection function
require('dotenv').config();

class TestPrediction {
    isPredictionRequest(question) {
        const predictionKeywords = [
            'predict', 'prediction', 'forecast', 'future', 'what will', 'where will',
            'price prediction', 'future price', 'next', 'tomorrow', 'next week',
            'next month', 'trend', 'direction', 'going up', 'going down',
            'compare', 'comparison', 'vs', 'versus', 'difference between',
            'end of', 'by end of', 'price target', 'where do you think',
            'lands by', 'reach by', 'will be', 'price will be',
            'where do you think', 'what do you think', 'think the price',
            'price will be', 'will reach', 'going to be', 'expect',
            'projection', 'estimate', 'target', 'level'
        ];
        
        const lowerQuestion = question.toLowerCase();
        const hasKeyword = predictionKeywords.some(keyword => lowerQuestion.includes(keyword));
        
        // Also check for specific patterns
        const hasPricePattern = /\$\d+|\d+\$|price|sol|bitcoin|btc|ethereum|eth/i.test(question);
        const hasTimePattern = /2026|2025|2024|end of|by end|next year|future/i.test(question);
        
        console.log(`🔍 Prediction check: "${question}" -> Keywords: ${hasKeyword}, Price: ${hasPricePattern}, Time: ${hasTimePattern}`);
        
        return hasKeyword || (hasPricePattern && hasTimePattern);
    }
}

const test = new TestPrediction();

// Test various questions
const testQuestions = [
    "if you had to predict a price based on this chart, where do you think SOL lands by the end of 2026?",
    "where do you think SOL will be by end of 2026?",
    "what do you think the price will be?",
    "predict the price",
    "where will SOL be in 2026?",
    "what's your prediction for SOL price?",
    "analyze this chart",
    "what does this chart show?"
];

console.log("🧪 Testing prediction detection:\n");

testQuestions.forEach((question, index) => {
    const result = test.isPredictionRequest(question);
    console.log(`${index + 1}. "${question}"`);
    console.log(`   Result: ${result ? '✅ PREDICTION' : '❌ NOT PREDICTION'}\n`);
});
