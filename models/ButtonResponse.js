import mongoose from 'mongoose';

const buttonResponseSchema = new mongoose.Schema({
    triggerId: { type: String, required: true, unique: true, description: 'Button ID or exact text' },
    responseText: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const ButtonResponse = mongoose.model('ButtonResponse', buttonResponseSchema);

export default ButtonResponse;
