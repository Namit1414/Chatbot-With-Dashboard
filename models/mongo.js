import mongoose from "mongoose";

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) return;

  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName: "chatbot",
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
    });
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    // Log masked URI for debugging if needed (omit sensitive parts)
    const maskedUri = (process.env.MONGODB_URI || "").replace(/\/\/.*@/, "//****:****@");
    console.log(`[Diagnostic] Attempted URI: ${maskedUri}`);
  }

  mongoose.connection.on('error', err => {
    console.error('❌ Mongoose connection event error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ Mongoose disconnected');
  });
}
