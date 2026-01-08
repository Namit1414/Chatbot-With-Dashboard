import mongoose from 'mongoose';

const scheduledBulkMessageSchema = new mongoose.Schema({
    message: {
        type: String,
        required: true
    },
    recipients: [{
        type: String,
        required: true
    }],
    scheduledTime: {
        type: Date,
        required: true
    },
    personalize: {
        type: Boolean,
        default: false
    },
    addDelay: {
        type: Boolean,
        default: true
    },
    status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    executedAt: {
        type: Date
    }
});

export default mongoose.model('ScheduledBulkMessage', scheduledBulkMessageSchema);
