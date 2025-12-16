import mongoose from "mongoose";

// Advanced flow schema supporting visual flow builder
const advancedFlowSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String },
    trigger: { type: String, required: true }, // Main trigger keyword or 'scheduled'
    triggerType: {
        type: String,
        enum: ['exact', 'contains', 'regex', 'scheduled'],
        default: 'contains'
    },

    // Schedule configuration (for scheduled flows)
    schedule: {
        time: { type: Date }, // When to execute
        repeat: {
            type: String,
            enum: ['once', 'daily', 'weekly', 'monthly'],
            default: 'once'
        },
        lastRun: { type: Date }, // Track last execution
        nextRun: { type: Date }  // Track next scheduled run
    },

    // Recipient Targeting
    recipientConfig: {
        audienceType: {
            type: String,
            enum: ['all', 'tags', 'specific'],
            default: 'all'
        },
        tags: [String],      // If type is 'tags'
        phones: [String]     // If type is 'specific'
    },

    active: { type: Boolean, default: true },

    // Visual flow data
    nodes: [{
        id: { type: String, required: true },
        type: {
            type: String,
            enum: ['start', 'message', 'buttons', 'list', 'image', 'video', 'document', 'delay', 'condition'],
            required: true
        },
        position: {
            x: { type: Number, default: 0 },
            y: { type: Number, default: 0 }
        },
        data: {
            // For message nodes
            text: String,

            // For button nodes
            buttons: [{
                id: String,
                text: String,
                type: { type: String, enum: ['reply', 'url', 'call'] },
                value: String // URL or phone number
            }],

            // For list nodes
            listItems: [{
                id: String,
                title: String,
                description: String
            }],

            // For media nodes
            mediaUrl: String,
            caption: String,
            filename: String, // For document nodes

            // For delay nodes
            delaySeconds: Number,

            // For condition nodes
            condition: String,
            variable: String
        }
    }],

    // Connections between nodes
    connections: [{
        id: { type: String },
        source: { type: String, required: true },
        target: { type: String, required: true },
        label: String // For conditional branches
    }],

    // Analytics
    stats: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        read: { type: Number, default: 0 },
        clicked: { type: Number, default: 0 },
        errors: { type: Number, default: 0 }
    }
}, { timestamps: true });

export default mongoose.model("AdvancedFlow", advancedFlowSchema);
