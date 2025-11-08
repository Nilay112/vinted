// routes/offer.js
const express = require("express");
const mongoose = require("mongoose");
const Offer = require("../models/Offer");
const cloudinary = require("../config/cloudinary");
const isAuthenticated = require("../middlewares/isAuthenticated");

const router = express.Router();

// Allowed mime-types for images
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

// Helpers ----------------------------------------------------
function limitString(str = "", max) {
  if (typeof str !== "string") return "";
  return str.length > max ? str.slice(0, max) : str;
}

function toPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

// Build product_details array according to the spec labels
function buildProductDetails({ brand, size, condition, color, city }) {
  const out = [];
  if (brand) out.push({ MARQUE: String(brand) });
  if (size) out.push({ TAILLE: String(size) });
  if (condition) out.push({ "ÉTAT": String(condition) });
  if (color) out.push({ COULEUR: String(color) });
  if (city) out.push({ EMPLACEMENT: String(city) });
  return out;
}

// Accept one or many files under the key "picture" (or multiple "picture" rows in Postman)
function normalizePictures(filesObj) {
  if (!filesObj) return [];
  const pic = filesObj.picture || filesObj.pictures || filesObj.image;
  if (!pic) return [];
  return Array.isArray(pic) ? pic : [pic];
}

// Upload a single file to Cloudinary folder; returns compact doc
async function uploadOneToCloudinary(file, folder) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    const err = new Error("Unsupported image type");
    err.status = 415;
    throw err;
  }
  const up = await cloudinary.uploader.upload(file.tempFilePath, {
    folder,
    use_filename: true,
    unique_filename: false,
    resource_type: "image",
  });
  return {
    public_id: up.public_id,
    secure_url: up.secure_url,
    format: up.format,
    width: up.width,
    height: up.height,
    bytes: up.bytes,
    version: up.version,
  };
}

// ROUTES -----------------------------------------------------

// POST /offer/publish
// Auth required. Body: form-data with title, description, price, condition, city, brand, size, color, picture (File, one or many)
router.post("/offer/publish", isAuthenticated, async (req, res) => {
  try {
    // Validate basic fields
    const title = limitString(req.body.title, 50);
    const description = limitString(req.body.description, 500);
    const price = toPrice(req.body.price);

    if (!title || Number.isNaN(price)) {
      return res.status(400).json({
        message: "title and price are required (title<=50 chars, 0<=price<=100000).",
      });
    }
    if (price < 0 || price > 100000) {
      return res.status(400).json({ message: "price must be between 0 and 100000." });
    }

    const details = buildProductDetails({
      brand: req.body.brand,
      size: req.body.size,
      condition: req.body.condition,
      color: req.body.color,
      city: req.body.city,
    });

    // 1) Create the offer first to get its _id (for folder naming)
    const offer = await Offer.create({
      product_name: title,
      product_description: description || "",
      product_price: price,
      product_details: details,
      product_image: null,
      product_images: [],
      owner: req.user._id,
    });

    // 2) Upload pictures into /vinted/offers/<offerId>
    const folder = `vinted/offers/${offer._id}`;
    const pictures = normalizePictures(req.files);
    const uploads = [];

    for (let i = 0; i < pictures.length; i++) {
      const file = pictures[i];
      const imageDoc = await uploadOneToCloudinary(file, folder);
      uploads.push(imageDoc);
    }

    // 3) Set cover (product_image) as first uploaded, store all in product_images
    const cover = uploads[0] || null;

    offer.product_image = cover;
    offer.product_images = uploads;

    await offer.save();

    // Populate owner minimal info
    await offer.populate({ path: "owner", select: "account.username account.avatar" });

    return res.status(201).json(offer);
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || "Publish failed." });
  }
});

// PUT /offer/:id
// Auth required. Owner only. Allows updating fields and appending new pictures.
router.put("/offer/:id", isAuthenticated, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid offer id" });
    }
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: "Offer not found" });
    if (String(offer.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Update fields with constraints
    if (req.body.title !== undefined) {
      offer.product_name = limitString(req.body.title, 50);
    }
    if (req.body.description !== undefined) {
      offer.product_description = limitString(req.body.description, 500);
    }
    if (req.body.price !== undefined) {
      const price = toPrice(req.body.price);
      if (Number.isNaN(price) || price < 0 || price > 100000) {
        return res.status(400).json({ message: "Invalid price" });
      }
      offer.product_price = price;
    }

    // Update detail fields if provided
    const updatedDetails = buildProductDetails({
      brand: req.body.brand,
      size: req.body.size,
      condition: req.body.condition,
      color: req.body.color,
      city: req.body.city,
    });
    if (updatedDetails.length) {
      offer.product_details = updatedDetails;
    }

    // Optional: append more pictures
    const pictures = normalizePictures(req.files);
    if (pictures.length) {
      const folder = `vinted/offers/${offer._id}`;
      for (const file of pictures) {
        const imageDoc = await uploadOneToCloudinary(file, folder);
        offer.product_images.push(imageDoc);
        if (!offer.product_image) {
          offer.product_image = imageDoc;
        }
      }
    }

    await offer.save();
    await offer.populate({ path: "owner", select: "account.username account.avatar" });

    return res.json(offer);
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || "Update failed." });
  }
});

// DELETE /offer/:id
// Auth required. Owner only. Deletes DB doc and (optionally) Cloudinary assets.
router.delete("/offer/:id", isAuthenticated, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid offer id" });
    }
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: "Offer not found" });
    if (String(offer.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Optional: delete images from Cloudinary
    const publicIds = [];
    if (offer.product_image?.public_id) publicIds.push(offer.product_image.public_id);
    if (Array.isArray(offer.product_images)) {
      for (const img of offer.product_images) {
        if (img?.public_id) publicIds.push(img.public_id);
      }
    }
    if (publicIds.length) {
      try {
        await cloudinary.api.delete_resources(publicIds);
        // Optional: also try to delete the folder (will only succeed if empty)
        await cloudinary.api.delete_folder(`vinted/offers/${offer._id}`);
      } catch (e) {
        // Non-fatal; folder may not be empty or already gone
        console.warn("Cloudinary delete warning:", e.message);
      }
    }

    await Offer.deleteOne({ _id: offer._id });
    return res.json({ message: "Offer deleted." });
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || "Delete failed." });
  }
});

module.exports = router;
