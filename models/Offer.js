const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema(
  {
    product_name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 50,
    },
    product_description: {
      type: String,
      trim: true,
      minlength: 1,
      maxlength: 500,
    },
    product_price: { type: Number, required: true, min: 0, max: 100000 },
    product_details: { type: Array },
    product_image: { type: Object, default: null },
    product_images: { type: [Object], default: [] },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

const Offer = mongoose.model("Offer", offerSchema);

module.exports = Offer;
