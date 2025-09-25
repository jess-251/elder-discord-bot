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

// Test the exact question you're asking
const testQuestion = "predict";

console.log("🧪 Testing prediction detection:");
console.log(`Question: "${testQuestion}"`);
const result = test.isPredictionRequest(testQuestion);
console.log(`Result: ${result ? '✅ PREDICTION' : '❌ NOT PREDICTION'}`);
