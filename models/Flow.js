import mongoose from "mongoose";

const flowSchema = new mongoose.Schema({
    trigger: { type: String, required: true }, // Keywords like "hi", "price"
    response: { type: String, required: true }, // The bot's reply
    type: { type: String, default: "text" }, // "text", "image", "interactive"
    active: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model("Flow", flowSchema);
