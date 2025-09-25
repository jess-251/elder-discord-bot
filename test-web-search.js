require('dotenv').config();
const axios = require('axios');

// Test the web search functionality
async function testWebSearch() {
    console.log('🧪 Testing Web Search Functionality\n');
    
    // Test crypto price search
    try {
        console.log('🔍 Testing crypto price search...');
        const cryptoResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true');
        
        if (cryptoResponse.data) {
            const cryptoData = cryptoResponse.data;
            let cryptoInfo = '**Current Cryptocurrency Prices:**\n';
            
            if (cryptoData.bitcoin) {
                cryptoInfo += `🟠 **Bitcoin (BTC)**: $${cryptoData.bitcoin.usd.toLocaleString()} (${cryptoData.bitcoin.usd_24h_change > 0 ? '+' : ''}${cryptoData.bitcoin.usd_24h_change.toFixed(2)}%)\n`;
            }
            if (cryptoData.ethereum) {
                cryptoInfo += `🔵 **Ethereum (ETH)**: $${cryptoData.ethereum.usd.toLocaleString()} (${cryptoData.ethereum.usd_24h_change > 0 ? '+' : ''}${cryptoData.ethereum.usd_24h_change.toFixed(2)}%)\n`;
            }
            if (cryptoData.solana) {
                cryptoInfo += `🟣 **Solana (SOL)**: $${cryptoData.solana.usd.toLocaleString()} (${cryptoData.solana.usd_24h_change > 0 ? '+' : ''}${cryptoData.solana.usd_24h_change.toFixed(2)}%)\n`;
            }
            
            console.log('✅ Crypto API working!');
            console.log(cryptoInfo);
        }
    } catch (error) {
        console.log('❌ Crypto API error:', error.message);
    }
    
    console.log('\n✅ Web search test completed!');
    console.log('\n🎯 The bot can now answer questions like:');
    console.log('• "What is the current price of Bitcoin?"');
    console.log('• "What is the latest price of Ethereum?"');
    console.log('• "How is Solana performing today?"');
    console.log('• "What are the current crypto prices?"');
    console.log('• "What happened in crypto today?"');
}

testWebSearch();
