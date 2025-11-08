const express = require("express");
const mongoose = require("mongoose");
const Offer = require("../models/Offer");
const User = require("../models/User");
const cloudinary = require("../config/cloudinary");
const isAuthenticated = require("../middlewares/isAuthenticated");

const router = express.Router();

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const convertToBase64 = (file) => {
  return `data:${file.mimetype};base64,${file.data.toString("base64")}`;
};

const buildProductDetails = ({ brand, size, condition, color, city }) => {
  const out = [];
  if (brand) out.push({ MARQUE: String(brand) });
  if (size) out.push({ TAILLE: String(size) });
  if (condition) out.push({ ÉTAT: String(condition) });
  if (color) out.push({ COULEUR: String(color) });
  if (city) out.push({ EMPLACEMENT: String(city) });
  return out;
};

const normalizePictures = (filesObj) => {
  if (!filesObj) return [];
  const pic = filesObj.picture || filesObj.pictures || filesObj.image;
  if (!pic) return [];
  return Array.isArray(pic) ? pic : [pic];
};

const limitString = (str, max) => {
  if (typeof str !== "string") return "";
  return str.length > max ? str.slice(0, max) : str;
};

const toPrice = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

const uploadOneToCloudinary = async (file, folder) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    const err = new Error("Unsupported image type");
    err.status = 415;
    throw err;
  }

  const convertedToStringFile = convertToBase64(file);

  const up = await cloudinary.uploader.upload(convertedToStringFile, {
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
};

router.post("/offer/publish", isAuthenticated, async (req, res) => {
  try {
    const title = limitString(req.body.title, 50);
    const description = limitString(req.body.description, 500);
    const price = toPrice(req.body.price);

    if (!title || Number.isNaN(price)) {
      return res.status(400).json({
        message:
          "title and price are required (title<=50 chars, 0<=price<=100000).",
      });
    }
    if (price < 0 || price > 100000) {
      return res
        .status(400)
        .json({ message: "price must be between 0 and 100000." });
    }

    const details = buildProductDetails({
      brand: req.body.brand,
      size: req.body.size,
      condition: req.body.condition,
      color: req.body.color,
      city: req.body.city,
    });

    const pictures = normalizePictures(req.files);
    if (pictures.length === 0) {
      return res.status(400).json({
        message: "Atleast one picture should be provided to create an offer.",
      });
    }

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

    const folder = `vinted/offers/${offer._id}`;
    const uploaded = [];

    for (let i = 0; i < pictures.length; i++) {
      const file = pictures[i];
      const image = await uploadOneToCloudinary(file, folder);
      uploaded.push(image);
    }

    const cover = uploaded[0];
    offer.product_image = cover;
    offer.product_images = uploaded;

    await offer.save();

    await offer.populate({
      path: "owner",
      select: "account.username account.avatar",
    });

    return res.status(201).json(offer);
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.message || "Publish failed." });
  }
});

router.put("/offer/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid offer id" });
    }

    const offer = await Offer.findById(id);
    if (!offer) return res.status(404).json({ message: "Offer not found" });
    if (String(offer.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // ---- Apply text/price updates
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

    // Optional: update product_details fields if provided
    const maybeDetails = buildProductDetails({
      brand: req.body.brand,
      size: req.body.size,
      condition: req.body.condition,
      color: req.body.color,
      city: req.body.city,
    });
    if (maybeDetails.length) {
      offer.product_details = maybeDetails;
    }

    // ---- Delete selected images (by public_id)
    if (req.body.deleteImages) {
      let deleteList = req.body.deleteImages;
      if (typeof deleteList === "string") {
        try {
          deleteList = JSON.parse(deleteList);
        } catch {
          return res
            .status(400)
            .json({ message: "deleteImages must be a JSON array" });
        }
      }
      if (!Array.isArray(deleteList)) {
        return res
          .status(400)
          .json({ message: "deleteImages must be an array" });
      }

      if (deleteList.length > 0) {
        // Delete from Cloudinary
        await cloudinary.api.delete_resources(deleteList);

        // Remove from DB
        offer.product_images = offer.product_images.filter(
          (img) => !deleteList.includes(img.public_id)
        );

        // If cover was removed, reassign to first remaining or null
        if (
          offer.product_image &&
          deleteList.includes(offer.product_image.public_id)
        ) {
          offer.product_image =
            offer.product_images.length > 0 ? offer.product_images[0] : null;
        }
      }
    }

    // ---- Append new images (if any)
    const pictures = normalizePictures(req.files);
    if (pictures.length) {
      const folder = `vinted/offers/${offer._id}`;
      for (const file of pictures) {
        const imageDoc = await uploadOneToCloudinary(file, folder);
        offer.product_images.push(imageDoc);
        if (!offer.product_image) {
          offer.product_image = imageDoc; // set cover if none
        }
      }
    }

    await offer.save();
    await offer.populate({
      path: "owner",
      select: "account.username account.avatar",
    });

    return res.json(offer);
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.message || "Update failed." });
  }
});

router.delete("/offer/:id", isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid offer id" });
    }

    const offer = await Offer.findById(id);
    if (!offer) return res.status(404).json({ message: "Offer not found" });
    if (String(offer.owner) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Gather public_ids to delete from Cloudinary
    const publicIds = [];
    if (offer.product_image?.public_id)
      publicIds.push(offer.product_image.public_id);
    if (Array.isArray(offer.product_images)) {
      for (const img of offer.product_images) {
        if (img?.public_id) publicIds.push(img.public_id);
      }
    }

    if (publicIds.length) {
      try {
        await cloudinary.api.delete_resources(publicIds);
        await cloudinary.api.delete_folder(`vinted/offers/${offer._id}`);
      } catch (e) {
        console.warn("Cloudinary delete warning:", e.message);
      }
    }

    await Offer.deleteOne({ _id: offer._id });
    return res.json({ message: "Offer deleted." });
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    return res
      .status(status)
      .json({ message: error.message || "Delete failed." });
  }
});

router.get("/offers", async (req, res) => {
  try {
    const {
      title, // String (substring search on product_name)
      priceMin, // Number
      priceMax, // Number
      sort, // "price-asc" | "price-desc"
      page, // Number (1-based)
    } = req.query;

    // Build filters
    const filters = {};
    if (title) {
      filters.product_name = { $regex: title, $options: "i" };
    }

    const min = priceMin !== undefined ? Number(priceMin) : undefined;
    const max = priceMax !== undefined ? Number(priceMax) : undefined;

    if (Number.isFinite(min) || Number.isFinite(max)) {
      filters.product_price = {};
      if (Number.isFinite(min)) filters.product_price.$gte = min;
      if (Number.isFinite(max)) filters.product_price.$lte = max;
    }

    // Sorting
    const sortOption = {};
    if (sort === "price-asc") sortOption.product_price = 1;
    else if (sort === "price-desc") sortOption.product_price = -1;

    // Pagination
    const PAGE_SIZE = 10; // choose your page size
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const skip = (pageNum - 1) * PAGE_SIZE;

    // Count (total matching docs)
    const count = await Offer.countDocuments(filters);

    // Query
    const offers = await Offer.find(filters)
      .sort(sortOption)
      .skip(skip)
      .limit(PAGE_SIZE)
      .populate({ path: "owner", select: "account.username account.avatar" });

    return res.json({ count, offers });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Search failed." });
  }
});

// ⚠️ Place AFTER /offers to avoid conflict with the collection route above
// GET /offers/:id
router.get("/offers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid offer id" });
    }

    const offer = await Offer.findById(id).populate({
      path: "owner",
      select: "account.username account.avatar",
    });

    if (!offer) return res.status(404).json({ message: "Offer not found" });
    return res.json(offer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Fetch failed." });
  }
});

module.exports = router;
