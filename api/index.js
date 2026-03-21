const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files
app.use('/public', express.static(path.join(__dirname, '../public')));

// ---------------- DB CONNECTION ----------------
let isConnected = false;

async function connectDB() {
    if (isConnected) return;

    const db = await mongoose.connect(process.env.MONGODB_URI);
    isConnected = db.connections[0].readyState;

    console.log("✅ MongoDB Connected");
}

// ---------------- MODEL ----------------
const UserSchema = new mongoose.Schema({
    mobile: String,
    seller_name: String,
    gst_number: String,
    email: String,
    hwid: String,
    is_verified: { type: Number, default: 1 }, // 1 = active, 0 = blocked
    reg_date: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', UserSchema);

// ---------------- ROUTES ----------------

// Health
app.get('/', (req, res) => {
    res.json({ message: "🚀 API Running" });
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../views/dashboard.html'));
});

// ---------------- VERIFY / LOGIN ----------------
app.post('/api/verify', async (req, res) => {
    await connectDB();

    const { mobile, seller_name, gst_number, email, hwid } = req.body;

    if (!mobile) {
        return res.json({ success: false, message: "Mobile required" });
    }

    let user = await User.findOne({ mobile });

    // Create new user
    if (!user) {
        user = await User.create({
            mobile,
            seller_name,
            gst_number,
            email,
            hwid,
            is_verified: 1
        });
    } else {
        // Update existing user
        user.seller_name = seller_name;
        user.gst_number = gst_number;
        user.email = email;

        // Lock device (optional)
        if (!user.hwid) user.hwid = hwid;

        await user.save();
    }

    // Block check
    if (user.is_verified !== 1) {
        return res.json({ success: false, message: "User Blocked" });
    }

    return res.json({ success: true, data: user });
});

// ---------------- ADMIN APIs ----------------

// Get all users
app.get('/api/admin/users', async (req, res) => {
    await connectDB();
    const users = await User.find().sort({ reg_date: -1 });
    res.json(users);
});

// Block / Unblock user
app.post('/api/admin/update-status', async (req, res) => {
    await connectDB();

    const { mobile, status } = req.body;

    await User.findOneAndUpdate(
        { mobile },
        { is_verified: status }
    );

    res.json({ success: true });
});

// ---------------- EXPORT FOR VERCEL ----------------
module.exports = async (req, res) => {
    await connectDB();
    return app(req, res);
};