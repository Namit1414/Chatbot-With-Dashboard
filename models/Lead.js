import mongoose from "mongoose";

const LeadSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  name: String,
  age: Number,
  weight: Number,
  height: Number,
  gender: String,
  place: String,
  health_issues: String,
  remarks: String,
  preferred_date: String,
  preferred_time: String,
  completed: { type: Boolean, default: false },
  unreadMessages: { type: Number, default: 0 },
}, { timestamps: true });

export default mongoose.model("Lead", LeadSchema);
