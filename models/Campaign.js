import mongoose from 'mongoose';

const campaignSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['template', 'text'],
        required: true
    },
    content: String,
    templateName: String,
    totalRecipients: {
        type: Number,
        default: 0
    },
    sentCount: {
        type: Number,
        default: 0
    },
    deliveredCount: {
        type: Number,
        default: 0
    },
    readCount: {
        type: Number,
        default: 0
    },
    failedCount: {
        type: Number,
        default: 0
    },
    repliedCount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['sending', 'completed', 'failed'],
        default: 'sending'
    },
    messages: [{
        recipient: String,
        messageId: String,
        status: {
            type: String,
            enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
            default: 'pending'
        },
        replied: {
            type: Boolean,
            default: false
        },
        error: String
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model('Campaign', campaignSchema);
