// Simple test script to verify bot functionality
require('dotenv').config();

const OpenAI = require('openai');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

async function testBot() {
    console.log('🧪 Testing Discord Mention Bot Components...\n');

    // Test 1: Environment variables
    console.log('1. Testing environment variables...');
    if (!process.env.OPENAI_API_KEY) {
        console.log('❌ OPENAI_API_KEY not found in .env file');
        return;
    }
    if (!process.env.DISCORD_TOKEN) {
        console.log('❌ DISCORD_TOKEN not found in .env file');
        return;
    }
    console.log('✅ Environment variables found\n');

    // Test 2: OpenAI connection
    console.log('2. Testing OpenAI connection...');
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'Say "Hello, bot is working!"' }],
            max_tokens: 50
        });
        
        console.log('✅ OpenAI connection successful');
        console.log(`   Response: ${completion.choices[0].message.content}\n`);
    } catch (error) {
        console.log('❌ OpenAI connection failed:', error.message);
        return;
    }

    // Test 3: Database connection
    console.log('3. Testing database connection...');
    try {
        const db = new sqlite3.Database('./mention_bot.db');
        
        // Test creating tables
        await promisify(db.run.bind(db))(`
            CREATE TABLE IF NOT EXISTS test_table (
                id INTEGER PRIMARY KEY,
                test_column TEXT
            )
        `);
        
        // Test inserting data
        await promisify(db.run.bind(db))(
            'INSERT INTO test_table (test_column) VALUES (?)',
            ['test_value']
        );
        
        // Test reading data
        const rows = await promisify(db.all.bind(db))('SELECT * FROM test_table');
        console.log('✅ Database connection successful');
        console.log(`   Test data: ${rows.length} rows found\n`);
        
        // Clean up test table
        await promisify(db.run.bind(db))('DROP TABLE test_table');
        db.close();
    } catch (error) {
        console.log('❌ Database connection failed:', error.message);
        return;
    }

    // Test 4: Document processing simulation
    console.log('4. Testing document processing...');
    try {
        const testDocument = {
            filename: 'test.txt',
            content: 'This is a test document with information about testing.'
        };
        
        const db = new sqlite3.Database('./mention_bot.db');
        await promisify(db.run.bind(db))(
            'INSERT INTO documents (channel_id, filename, content) VALUES (?, ?, ?)',
            ['test_channel', testDocument.filename, testDocument.content]
        );
        
        const documents = await promisify(db.all.bind(db))(
            'SELECT filename, content FROM documents WHERE channel_id = ?',
            ['test_channel']
        );
        
        console.log('✅ Document processing successful');
        console.log(`   Stored document: ${documents[0].filename}\n`);
        
        // Clean up test data
        await promisify(db.run.bind(db))('DELETE FROM documents WHERE channel_id = ?', ['test_channel']);
        db.close();
    } catch (error) {
        console.log('❌ Document processing failed:', error.message);
        return;
    }

    console.log('🎉 All tests passed! Your bot is ready to run.');
    console.log('\nNext steps:');
    console.log('1. Run: npm run mention');
    console.log('2. Upload documents to Discord');
    console.log('3. Mention the bot with @BotName');
}

testBot().catch(console.error); 