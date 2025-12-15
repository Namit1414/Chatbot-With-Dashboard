import mongoose from "mongoose";

const OnboardingSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  step: { type: Number, default: 0 },
  data: { type: Object, default: {} }
});

export default mongoose.model("OnboardingState", OnboardingSchema);
