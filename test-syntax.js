// Test syntax
class TestBot {
    async performWebSearch(query) {
        try {
            console.log(`🔍 Performing web search for: "${query}"`);
            return 'test';
        } catch (error) {
            console.error('Web search error:', error);
            return 'Unable to fetch current information at this time.';
        }
    }

    storeChartContext(channelId, filename, analysis, imageUrl) {
        console.log('test');
    }
}

console.log('Syntax test passed');
