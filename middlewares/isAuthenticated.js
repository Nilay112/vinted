const User = require("../models/User");

const isAuthenticated = async (req, res, next) => {
  try {
    const auth = req.headers.authorization;

    const [bearer, token] = auth.split(" ");

    if (bearer !== "Bearer" || !token) {
      return res
        .status(401)
        .json({ message: "User is unauthorized to perform this action." });
    }

    const user = await User.findOne({ token });
    if (!user) {
      return res
        .status(401)
        .json({ message: "User is unauthorized to perform this action." });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

module.exports = isAuthenticated;
