import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;

export async function connectDB() {
  if (!db) {
    await client.connect();
    db = client.db("whatsapp_chatbot");
    console.log("✅ MongoDB connected");
  }
  return db;
}
