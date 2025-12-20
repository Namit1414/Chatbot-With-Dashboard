import mongoose from "mongoose";

const flowResponseSchema = new mongoose.Schema({
    phone: { type: String, required: true },
    name: { type: String },
    flowId: { type: String, required: true },
    flowName: { type: String },
    nodeId: { type: String, required: true },
    nodeName: { type: String },
    question: { type: String },
    answer: { type: String },
    timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("FlowResponse", flowResponseSchema);
