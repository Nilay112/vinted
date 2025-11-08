const express = require("express");
const SHA256 = require("crypto-js/sha256");
const encBase64 = require("crypto-js/enc-base64");
const uid2 = require("uid2");
const User = require("../models/User");
const cloudinary = require("../config/cloudinary");

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

router.post("/user/signup", async (req, res) => {
  try {
    const { username, email, password, newsletter } = req.body;

    if (typeof username !== "string" || username.trim() === "") {
      return res.status(400).json({ message: "Username is required" });
    }
    if (typeof email !== "string" || email.trim() === "") {
      return res.status(400).json({ message: "Email is required" });
    }
    if (typeof password !== "string" || password.length === 0) {
      return res.status(400).json({ message: "Password is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const emailExists = await User.findOne({ email: normalizedEmail });
    if (emailExists) {
      return res.status(409).json({ message: "Email already exists." });
    }

    const salt = uid2(16);

    const hash = SHA256(password + salt).toString(encBase64);
    const token = uid2(64);

    const tempUser = {
      email: normalizedEmail,
      account: { username: username.trim(), avatar: null },
      newsletter: Boolean(newsletter),
      token,
      hash,
      salt,
    };

    const avatarFile = req.files.avatar;

    if (avatarFile) {
      if (!ALLOWED_MIME.has(avatarFile.mimetype)) {
        return res
          .status(415)
          .json({ message: "Unsupported avatar file type" });
      }

      const folder = "vinted/users";

      const convertedToStringFile = convertToBase64(avatarFile);

      const uploadedAvatar = await cloudinary.uploader.upload(
        convertedToStringFile,
        {
          folder,
          use_filename: true,
          unique_filename: false,
          resource_type: "image",
        }
      );

      tempUser.account.avatar = {
        public_id: uploadedAvatar.public_id,
        secure_url: uploadedAvatar.secure_url,
        format: uploadedAvatar.format,
        width: uploadedAvatar.width,
        height: uploadedAvatar.height,
        bytes: uploadedAvatar.bytes,
        version: uploadedAvatar.version,
      };
    }

    const newUser = await User.create(tempUser);

    return res.status(201).json({
      _id: newUser._id,
      token: newUser.token,
      account: newUser.account,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "Email already exists." });
    }
    return res.status(500).json({ message: error.message });
  }
});

router.post("/user/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== "string" || email.trim() === "") {
      return res.status(400).json({ message: "Email is required" });
    }
    if (typeof password !== "string" || password.length === 0) {
      return res.status(400).json({ message: "Password is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(400).json({
        message: "No user found with this email. Please proceed to signup.",
      });
    }

    const calculatedHash = SHA256(password + user.salt).toString(encBase64);

    if (calculatedHash !== user.hash) {
      return res.status(400).json({ message: "Incorrect password." });
    } else {
      return res.status(200).json({
        _id: user._id,
        token: user.token,
        account: user.account,
      });
    }
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
