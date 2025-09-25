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
        console.log('Full error:', error);
    }
    
    console.log('\n✅ Web search test completed!');
}

testWebSearch();
