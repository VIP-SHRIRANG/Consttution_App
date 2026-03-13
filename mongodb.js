require('dotenv').config();   // load env first

const { MongoClient } = require('mongodb');

const url = process.env.MONGODB_URI;
const client = new MongoClient(url);

const databaseName = 'Constitution_App';

async function dbConnection() {
    let result = await client.connect();
    const db = result.db(databaseName);
    return db.collection('User_List');
}

module.exports = dbConnection;