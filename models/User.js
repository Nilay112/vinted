const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    account: {
      username: { type: String, required: true, trim: true },
      avatar: { type: Object, default: null }, // reserved for later
    },
    newsletter: { type: Boolean, default: false },
    token: { type: String, required: true },
    hash: { type: String, required: true },
    salt: { type: String, required: true },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

module.exports = User;
