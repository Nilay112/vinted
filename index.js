require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const fileUpload = require("express-fileupload");

const userRoutes = require("./routes/user");
const offerRoutes = require("./routes/offer");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());

mongoose.connect(process.env.MONGODB_URI);

app.use(userRoutes);
app.use(offerRoutes);

app.all(/.*/, function (req, res) {
  return res.status(404).json({ message: "Page not found" });
});

app.listen(3000, () => console.log("Server running"));
