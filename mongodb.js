const {MongoClient} = require('mongodb');
const url = 'mongodb://localhost:27017';
const client = new MongoClient(url); 
const databaseName = 'Constitution_App';

async function dbConnection(){
    let result = await client.connect();
    db = result.db(databaseName);
    return collection = db.collection('User_List');
}

module.exports = dbConnection;