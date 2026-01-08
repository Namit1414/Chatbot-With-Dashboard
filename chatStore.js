import { connectDB } from "./db.js";

export async function saveMessage(phone, from, text) {
  const db = await connectDB();
  await db.collection("messages").insertOne({
    phone,
    from,
    text,
    time: Date.now()
  });
}

export async function getConversations() {
  const db = await connectDB();

  const latest = await db.collection("messages").aggregate([
    { $sort: { time: -1 } },
    {
      $group: {
        _id: "$phone",
        lastMessage: { $first: "$$ROOT" }
      }
    }
  ]).toArray();

  return latest.map(c => ({
    phone: c._id,
    lastMessage: c.lastMessage
  }));
}

export async function getMessages(phone) {
  const db = await connectDB();
  return db.collection("messages")
    .find({ phone })
    .sort({ time: 1 })
    .toArray();
}
