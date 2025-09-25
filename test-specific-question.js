// Test the specific question you're asking
require('dotenv').config();

class TestPrediction {
    isPredictionRequest(question) {
        // Only trigger prediction for very specific prediction requests
        const predictionKeywords = [
            'predict', 'prediction', 'forecast', 'future price', 'price prediction',
            'where will', 'what will', 'price target', 'where do you think',
            'lands by', 'reach by', 'will be', 'price will be',
            'will reach', 'going to be', 'expect', 'projection', 'estimate',
            'think', 'believe', 'guess', 'opinion', 'view'
        ];
        
        const lowerQuestion = question.toLowerCase();
        const hasKeyword = predictionKeywords.some(keyword => lowerQuestion.includes(keyword));
        
        // Also check for specific patterns with price and time
        const hasPricePattern = /\$\d+|\d+\$|price|sol|bitcoin|btc|ethereum|eth/i.test(question);
        const hasTimePattern = /2026|2025|2024|end of|by end|next year|future/i.test(question);
        
        console.log(`🔍 Prediction check: "${question}" -> Keywords: ${hasKeyword}, Price: ${hasPricePattern}, Time: ${hasTimePattern}`);
        
        // Only trigger if it has prediction keywords OR (price pattern AND time pattern)
        return hasKeyword || (hasPricePattern && hasTimePattern);
    }
}

const test = new TestPrediction();

// Test your exact question
const testQuestion = "predict a price based on this chart, where do you think SOL lands by the end of 2026";

console.log("🧪 Testing your exact question:");
console.log(`Question: "${testQuestion}"`);
const result = test.isPredictionRequest(testQuestion);
console.log(`Result: ${result ? '✅ PREDICTION' : '❌ NOT PREDICTION'}`);

// Test individual parts
console.log("\n🔍 Testing individual parts:");
console.log("Contains 'predict':", testQuestion.toLowerCase().includes('predict'));
console.log("Contains 'where do you think':", testQuestion.toLowerCase().includes('where do you think'));
console.log("Contains 'SOL':", testQuestion.toLowerCase().includes('sol'));
console.log("Contains '2026':", testQuestion.toLowerCase().includes('2026'));
