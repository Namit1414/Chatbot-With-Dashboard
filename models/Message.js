import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  from: { type: String, index: true },
  to: { type: String, index: true },
  text: String,
  messageType: { type: String, default: 'text' },
  timestamp: { type: Date, default: Date.now, index: true }
});

messageSchema.index({ from: 1, to: 1, timestamp: -1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;