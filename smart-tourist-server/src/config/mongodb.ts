import { MongoClient, Db } from 'mongodb';

if (!process.env.MONGODB_URI) {
    throw new Error ("invalid/missing environment variable MONGODB_URI");
}

const uri = process.env.MONGODB_URI;
const options = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if(process.env.NODE_ENV === 'development'){
    let globalWithMongo = global as typeof global & {
        _mongoClientPromise?: Promise<MongoClient>
    }

    if(!globalWithMongo._mongoClientPromise){
        client = new MongoClient(uri, options);
        globalWithMongo._mongoClientPromise = client.connect();
    }
    clientPromise = globalWithMongo._mongoClientPromise;
}else{
    client = new MongoClient(uri, options);
    clientPromise = client.connect();
}

// Function to get database instance
async function getDb(): Promise<Db> {
    const client = await clientPromise;
    return client.db(); // Uses default database name from connection string
}

module.exports = { getDb };
module.exports.default = clientPromise;