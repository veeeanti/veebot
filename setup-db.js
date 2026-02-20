// Database Setup Script for UC-AIv2
// Simple script to initialize the database schema

import 'dotenv/config';
import { testConnection, initializeDatabase } from './database.js';

console.log('UC-AIv2 Database Setup');
console.log('='.repeat(40));
console.log('');

const DB_TYPE = process.env.DATABASE_TYPE || 'sqlite';

// Check environment configuration
console.log(`Checking configuration for ${DB_TYPE.toUpperCase()}...`);

if (DB_TYPE === 'postgres') {
    const hasDirectUrl = !!process.env.DATABASE_URL;
    const hasIndividualParams = !!process.env.POSTGRES_HOST;

    console.log('DATABASE_URL found:', hasDirectUrl);
    console.log('Individual parameters found:', hasIndividualParams);

    if (!hasDirectUrl && !hasIndividualParams) {
        console.log('No database configuration found in .env');
        console.log('   Please set either DATABASE_URL or individual PostgreSQL parameters');
        process.exit(1);
    }
} else {
    console.log('SQLite Path:', process.env.SQLITE_PATH || './database.sqlite');
}
console.log('');

// Database connection
console.log('Testing database connection...');
try {
    const connected = await testConnection();
    if (connected) {
        console.log('Database connection successful');
        console.log('');
    } else {
        console.log('Database connection failed');
        if (DB_TYPE === 'postgres') {
            console.log('   Please check your DATABASE_URL or connection parameters');
            console.log('   Ensure PostgreSQL server is accessible and credentials are correct');
        } else {
            console.log('   Please ensure better-sqlite3 is correctly installed and the path is writable.');
        }
        console.log('');
        process.exit(1);
    }
} catch (error) {
    console.log('Database connection error:', error.message);
    console.log('');
    process.exit(1);
}

// Schema initialization
console.log('Initializing database schema...');
try {
    const result = await initializeDatabase();
    if (result) {
        console.log('Database schema initialized successfully');
        console.log('');
    } else {
        console.log('Database schema initialization failed');
        const schemaFile = DB_TYPE === 'postgres' ? 'schema.sql' : 'schema-sqlite.sql';
        console.log(`   Check that ${schemaFile} file exists and database permissions are correct`);
        console.log('');
        process.exit(1);
    }
} catch (error) {
    console.log('Schema initialization error:', error.message);
    console.log('');
    process.exit(1);
}

// Success :3
console.log('Database setup completed successfully!');
console.log('');
console.log('Next steps:');
console.log('   Start the bot: npm start');
console.log('');
console.log('Setup complete, Lets get this bread started');

process.exit(0);